import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db";

/**
 * Writing to `wms.audit_log`.
 *
 * Two rules, and both are about what the log is *for*.
 *
 * 1. **Denials are logged.** `result = 'DENIED'` rows are the whole
 *    point — the successful actions can never tell you who *tried*. A
 *    log of only what worked answers "what happened" and cannot answer
 *    "was anyone probing us", which is the question you ask after an
 *    incident.
 *
 * 2. **The actor is captured, not inferred.** A table trigger cannot see
 *    who is acting without a `SET LOCAL` that someone eventually forgets,
 *    and an audit row with a null actor is worthless. So the row is
 *    written from the handler, where the actor is known.
 *
 * Auth events are the awkward case: a failed login has no session, so
 * there is often no actor id — only a submitted identifier. That is
 * recorded in `metadata` rather than left blank, because "somebody tried
 * this email 400 times" is exactly the pattern worth seeing.
 */

export type AuditOperation =
  | "INSERT" | "UPDATE" | "DELETE" | "RESTORE"
  | "LOGIN" | "LOGOUT" | "DENY" | "EXPORT" | "APPROVE" | "REJECT";

export type AuditResult = "SUCCESS" | "DENIED" | "FAILED";

export type AuditEntry = {
  action: string;
  operation: AuditOperation;
  entityType: string;
  entityId: string;
  entityLabel?: string | null;

  actorUserId?: number | null;
  actorName?: string | null;
  actorEmail?: string | null;
  actorPath?: string | null;

  result?: AuditResult;
  /** Required by the schema when result is DENIED or operation is DELETE. */
  reason?: string | null;
  errorCode?: string | null;

  before?: unknown;
  after?: unknown;

  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  source?: "WEB" | "MOBILE" | "API" | "JOB" | "SYSTEM" | "MIGRATION";
  durationMs?: number | null;
  /** Anything that helps answer a question later. Never a secret. */
  metadata?: Record<string, unknown>;
};

/**
 * Values that must never reach the log, whatever a caller passes.
 *
 * An audit trail is the one table most likely to be exported, shipped to
 * a SIEM, or handed to an auditor — so a password that leaks into
 * `metadata` leaks further than almost anywhere else in the system.
 */
const REDACT = /^(password|newPassword|confirmPassword|otp|code|token|secret|pepper|apiKey)$/i;

function scrub(input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = REDACT.test(key) ? "[redacted]" : value;
  }
  return out;
}

/**
 * `actor_path` deliberately carries no cast.
 *
 * It used to say `::ltree`, and that one word meant every audit write in
 * this application failed. `ltree` is installed into the `extensions`
 * schema — Supabase's convention, and the reason 00_extensions.sql puts
 * it there — which is not on the connection's search_path, so the cast
 * resolved to nothing and Postgres answered `type "ltree" does not
 * exist`. Because `auditQuietly` swallows failures by design, the only
 * symptom was an audit table that stayed empty: sign-ins, approvals and
 * denials all reported success and recorded nothing.
 *
 * Without the cast the parameter is untyped and Postgres infers it from
 * the target column, which is the ltree it was always meant to be. That
 * also survives the extension being moved again. `::citext` elsewhere is
 * fine for the opposite reason — citext lives in `public`.
 */
const json = (value: unknown): SQL =>
  value === undefined || value === null
    ? sql`null`
    : sql`${JSON.stringify(value)}::jsonb`;

/**
 * Append one row.
 *
 * Call it inside the same transaction as the change it describes, so a
 * rolled-back write cannot leave an audit row claiming it happened. The
 * `diff` is computed by the database's own `jsonb_diff`, so the log and
 * a manual query agree on what "changed" means.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  const result = entry.result ?? "SUCCESS";

  // The schema enforces both of these; failing here gives the caller a
  // useful message instead of a constraint violation from three frames
  // deeper.
  if (result === "DENIED" && !entry.reason) {
    throw new Error(`audit: a DENIED entry needs a reason (action '${entry.action}')`);
  }
  if (entry.operation === "DELETE" && !entry.reason) {
    throw new Error(`audit: a DELETE entry needs a reason (action '${entry.action}')`);
  }

  const before = json(entry.before);
  const after = json(entry.after);

  await getDb().execute(sql`
    insert into wms.audit_log
      (actor_user_id, actor_name, actor_email, actor_path,
       action, operation, entity_type, entity_id, entity_label,
       before, after, diff, changed_keys,
       request_id, correlation_id, ip, user_agent, source,
       result, reason, error_code, duration_ms, metadata)
    values (
      ${entry.actorUserId ?? null}, ${entry.actorName ?? null},
      ${entry.actorEmail ?? null}, ${entry.actorPath ?? null},
      ${entry.action}, ${entry.operation}::wms.audit_operation,
      ${entry.entityType}, ${entry.entityId}, ${entry.entityLabel ?? null},
      ${before}, ${after},
      wms.jsonb_diff(coalesce(${before}, '{}'::jsonb), coalesce(${after}, '{}'::jsonb)),
      (select coalesce(array_agg(k), '{}')
         from jsonb_object_keys(
                wms.jsonb_diff(coalesce(${before}, '{}'::jsonb),
                               coalesce(${after}, '{}'::jsonb))) k),
      ${entry.requestId ?? null}, ${entry.correlationId ?? null},
      ${entry.ip ?? null}::inet, ${entry.userAgent ?? null},
      ${entry.source ?? "WEB"},
      ${result}::wms.audit_result, ${entry.reason ?? null}, ${entry.errorCode ?? null},
      ${entry.durationMs ?? null},
      ${JSON.stringify(scrub(entry.metadata))}::jsonb
    )
  `);
}

/**
 * Log without ever throwing.
 *
 * For the paths where the audit row is not the point of the request. A
 * failed insert here must not turn a successful login into a 500 — but
 * it must be visible, so it goes to stderr rather than being swallowed.
 */
export async function auditQuietly(entry: AuditEntry): Promise<void> {
  try {
    await audit(entry);
  } catch (error) {
    console.error("[audit] failed to write an audit row", {
      action: entry.action,
      result: entry.result,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
