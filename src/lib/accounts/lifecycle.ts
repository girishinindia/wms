import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { auditQuietly } from "@/lib/audit";
import type { Actor } from "@/lib/auth/guard";
import { revokeAllSessions } from "@/lib/auth/session";

/**
 * One life-cycle for the three things that are really one person or one
 * company seen from three tables:
 *
 *   users (the login)  ⇄  importer (the company)  ⇄  sales_agent (the profile)
 *
 * Deactivate, reactivate and delete start from any of the three and reach
 * the other two, so a suspended importer cannot keep signing in, a deleted
 * agent has no live login, and a deleted importer does not leave a company
 * row behind — which is exactly what happened when the first batch of
 * users was removed and six orphan importers stayed in the list.
 *
 * All soft. Rows keep their ids and history under `deleted_at`; the
 * partial unique indexes on users, importer and sales_agent are on
 * `deleted_at is null`, so a re-registration with the same email or
 * mobile does not collide with a deleted row.
 *
 * Every function here takes the actor and writes the audit rows itself.
 * Callers do the permission check; this module does the consequences.
 */

export type Meta = { requestId: string; ip: string | null; userAgent: string | null };
type Kind = "SUSPEND" | "REACTIVATE" | "DELETE";

const label = (actor: Actor) => `${actor.session.firstName} ${actor.session.lastName}`.trim();

async function audit(
  actor: Actor,
  meta: Meta,
  entry: {
    action: string;
    operation: "UPDATE" | "DELETE";
    entityType: string;
    entityId: number;
    entityLabel: string;
    reason: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await auditQuietly({
    action: entry.action,
    operation: entry.operation,
    entityType: entry.entityType,
    entityId: String(entry.entityId),
    entityLabel: entry.entityLabel,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: label(actor),
    reason: entry.reason,
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
    metadata: entry.metadata ?? {},
  });
}

// ── users ─────────────────────────────────────────────────────────

/** Change one login's status. No cascade — the cascades call this. */
async function setUserRow(userId: number, kind: Kind, actor: Actor, reason: string | null) {
  if (kind === "DELETE") {
    await getDb().execute(sql`
      update wms.users
         set deleted_at = now(), deleted_by = ${actor.session.userId},
             status = 'CLOSED', updated_by = ${actor.session.userId}
       where id = ${userId} and deleted_at is null
    `);
    await revokeAllSessions(userId, `deleted: ${reason ?? "no reason"}`);
    return;
  }
  const suspend = kind === "SUSPEND";
  await getDb().execute(sql`
    update wms.users
       set status              = ${suspend ? "SUSPENDED" : "ACTIVE"}::wms.record_status,
           deactivation_reason = ${suspend ? reason : null},
           deactivated_by      = ${suspend ? actor.session.userId : null},
           deactivated_at      = ${suspend ? sql`now()` : sql`null`},
           updated_by          = ${actor.session.userId}
     where id = ${userId} and deleted_at is null
       ${suspend ? sql`` : sql`and status = 'SUSPENDED'`}
  `);
  if (suspend) await revokeAllSessions(userId, `suspended: ${reason ?? "no reason"}`);
}

/**
 * The importer-domain bindings a user carries. IMPORTER → the company is
 * theirs; SALES_AGENT → a profile row points at them.
 */
async function bindingsOf(userId: number) {
  const roles = await getDb().execute<{ role: string; importer_id: number | null }>(sql`
    select role::text as role, importer_id from wms.user_role_assignment
     where user_id = ${userId} and revoked_at is null
  `);
  const agent = await getDb().execute<{ id: number; first_name: string; last_name: string }>(sql`
    select id, first_name, last_name from wms.sales_agent
     where user_id = ${userId} and deleted_at is null
  `);
  const importerId = roles.find((r) => r.role === "IMPORTER" && r.importer_id !== null)?.importer_id ?? null;
  return { importerId: importerId === null ? null : Number(importerId), agent: agent[0] ?? null };
}

/**
 * From the user: suspend / reactivate / delete the login, then whatever
 * it owns — the company (and its agents) for an IMPORTER, the profile
 * for a SALES_AGENT.
 */
export async function applyToUser(
  userId: number,
  kind: Kind,
  actor: Actor,
  meta: Meta,
  reason: string | null,
  /** Set when called from the importer/agent side, so we do not bounce back. */
  cascade = true,
): Promise<{ importerId: number | null; agentId: number | null }> {
  const user = await getDb().execute<{ email: string }>(sql`
    select email::text as email from wms.users where id = ${userId} and deleted_at is null
  `);
  const email = user[0]?.email ?? String(userId);
  await setUserRow(userId, kind, actor, reason);
  await audit(actor, meta, {
    action: kind === "DELETE" ? "user.deleted" : kind === "SUSPEND" ? "user.deactivated" : "user.reactivated",
    operation: kind === "DELETE" ? "DELETE" : "UPDATE",
    entityType: "user",
    entityId: userId,
    entityLabel: email,
    reason,
  });

  const { importerId, agent } = await bindingsOf(userId);
  if (cascade && importerId !== null) {
    await applyToImporter(importerId, kind, actor, meta, reason ?? `Company account ${email} ${verb(kind)}`, false);
  }
  if (cascade && agent) {
    await applyToAgent(agent.id, kind, actor, meta, reason ?? `Login ${email} ${verb(kind)}`, false);
  }
  return { importerId, agentId: agent?.id ?? null };
}

const verb = (kind: Kind) =>
  kind === "DELETE" ? "was deleted" : kind === "SUSPEND" ? "was deactivated" : "was reactivated";

// ── importer ──────────────────────────────────────────────────────

/**
 * From the company: SUSPENDED / back to where it was / deleted — and every
 * login bound to it (the IMPORTER owner and every SALES_AGENT) plus every
 * agent profile follow.
 *
 * "Back to where it was" on reactivate: ACTIVE if the company had been
 * verified, otherwise PENDING — a suspension must not quietly verify a
 * company that never was.
 */
export async function applyToImporter(
  importerId: number,
  kind: Kind,
  actor: Actor,
  meta: Meta,
  reason: string | null,
  cascade = true,
): Promise<void> {
  const rows = await getDb().execute<{ company_name: string; status: string; kyc_status: string }>(sql`
    select company_name, status::text as status, kyc_status from wms.importer
     where id = ${importerId} and deleted_at is null
  `);
  const imp = rows[0];
  if (!imp) return;

  if (kind === "DELETE") {
    await getDb().execute(sql`
      update wms.importer set deleted_at = now(), deleted_by = ${actor.session.userId},
             updated_by = ${actor.session.userId}
       where id = ${importerId} and deleted_at is null
    `);
  } else if (kind === "SUSPEND") {
    // `importer_complete_before_active` lets an incomplete row exist only
    // while PENDING, so a not-yet-verified company cannot be marked
    // SUSPENDED — it stays PENDING, and with its owner's login suspended
    // it is frozen all the same. A verified company is marked.
    await getDb().execute(sql`
      update wms.importer set status = 'SUSPENDED', updated_by = ${actor.session.userId}
       where id = ${importerId} and deleted_at is null and status = 'ACTIVE'
    `);
  } else {
    const back = imp.kyc_status === "VERIFIED" ? "ACTIVE" : "PENDING";
    await getDb().execute(sql`
      update wms.importer set status = ${back}::wms.record_status, updated_by = ${actor.session.userId}
       where id = ${importerId} and deleted_at is null and status = 'SUSPENDED'
    `);
  }
  await audit(actor, meta, {
    action: kind === "DELETE" ? "importer.deleted" : kind === "SUSPEND" ? "importer.suspended" : "importer.reactivated",
    operation: kind === "DELETE" ? "DELETE" : "UPDATE",
    entityType: "importer",
    entityId: importerId,
    entityLabel: imp.company_name,
    reason,
    metadata: { from: imp.status },
  });

  // Agents of this company (profiles + their logins) always follow, even
  // when the call came from the owner's login — the owner's suspension
  // takes the whole company with it.
  const agents = await getDb().execute<{ id: number }>(sql`
    select id from wms.sales_agent where importer_id = ${importerId} and deleted_at is null
  `);
  for (const a of agents) {
    await applyToAgent(Number(a.id), kind, actor, meta, `Company ${imp.company_name} ${verb(kind)}`, true);
  }
  // Every login bound to this importer that is not an agent (the owner
  // and any future importer-domain staff). Agents' logins were handled
  // above; the owner is skipped when the call came from the owner.
  if (cascade) {
    const users = await getDb().execute<{ user_id: number }>(sql`
      select distinct ura.user_id from wms.user_role_assignment ura
        join wms.users u on u.id = ura.user_id and u.deleted_at is null
       where ura.importer_id = ${importerId} and ura.revoked_at is null
         and ura.role = 'IMPORTER'
    `);
    for (const u of users) {
      await applyToUser(Number(u.user_id), kind, actor, meta, `Company ${imp.company_name} ${verb(kind)}`, false);
    }
  }
}

// ── sales agent ───────────────────────────────────────────────────

/** From the profile: the row and, when it has one, the login. */
export async function applyToAgent(
  agentId: number,
  kind: Kind,
  actor: Actor,
  meta: Meta,
  reason: string | null,
  cascadeToLogin = true,
): Promise<void> {
  const rows = await getDb().execute<{ user_id: number | null; first_name: string; last_name: string }>(sql`
    select user_id, first_name, last_name from wms.sales_agent where id = ${agentId} and deleted_at is null
  `);
  const a = rows[0];
  if (!a) return;
  if (kind === "DELETE") {
    await getDb().execute(sql`
      update wms.sales_agent set deleted_at = now(), deleted_by = ${actor.session.userId},
             is_active = false, updated_by = ${actor.session.userId}
       where id = ${agentId} and deleted_at is null
    `);
  } else {
    const on = kind === "REACTIVATE";
    await getDb().execute(sql`
      update wms.sales_agent set is_active = ${on}, status = ${on ? "ACTIVE" : "SUSPENDED"}::wms.record_status,
             updated_by = ${actor.session.userId}
       where id = ${agentId} and deleted_at is null
    `);
  }
  await audit(actor, meta, {
    action: kind === "DELETE" ? "sales_agent.deleted" : kind === "SUSPEND" ? "sales_agent.deactivated" : "sales_agent.reactivated",
    operation: kind === "DELETE" ? "DELETE" : "UPDATE",
    entityType: "sales_agent",
    entityId: agentId,
    entityLabel: `${a.first_name} ${a.last_name}`,
    reason,
  });
  if (cascadeToLogin && a.user_id) {
    await applyToUser(Number(a.user_id), kind, actor, meta, reason, false);
  }
}
