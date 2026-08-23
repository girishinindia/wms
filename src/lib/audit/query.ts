import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db";
import { finishList, type ListQuery, type ListState } from "@/lib/admin/listing";

/**
 * Reading `wms.audit_log`.
 *
 * The table is RANGE-partitioned by month and append-only, and it only
 * ever grows. That shapes every decision here:
 *
 *   1. **Every query is bounded by a time window.** Not a nicety — an
 *      unbounded `where action = …` reads every partition that has ever
 *      existed, and the plan gets worse every month the system runs.
 *      The window is what lets Postgres prune to one or two partitions
 *      before it looks at anything else.
 *
 *   2. **Only `occurred_at` is sortable.** Every index on this table is
 *      `(something, occurred_at DESC)`. Sorting by actor or action would
 *      throw the index away and sequential-scan the pruned set, which is
 *      the slowest thing this screen could possibly do while looking
 *      like a harmless click on a column header.
 *
 *   3. **`before`, `after` and `diff` are not in the list query.** They
 *      carry contact details, GSTIN and PAN. The list is a summary; one
 *      row's payload is fetched on demand when somebody opens it.
 */

/** How far back the screen looks. The default is 30 days: long enough
 *  to answer "what happened last week", short enough to touch one or
 *  two partitions. */
export const PERIODS = {
  "24h": { label: "Last 24 hours", hours: 24 },
  "7d": { label: "Last 7 days", hours: 24 * 7 },
  "30d": { label: "Last 30 days", hours: 24 * 30 },
  "90d": { label: "Last 90 days", hours: 24 * 90 },
} as const;

export type PeriodKey = keyof typeof PERIODS;
export const DEFAULT_PERIOD: PeriodKey = "30d";

export function isPeriod(value: string): value is PeriodKey {
  return Object.hasOwn(PERIODS, value);
}

export const RESULTS = ["SUCCESS", "DENIED", "FAILED"] as const;

/** The one sortable column, for the reason in note 2 above. */
export const AUDIT_SORTABLE = ["occurred_at"] as const;

export const AUDIT_FILTER_KEYS = ["period", "action", "entity", "result", "actor"] as const;

export type AuditRow = {
  id: string;
  occurredAt: string;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  operation: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  result: string;
  reason: string | null;
  /** Whether this row has a payload worth opening. */
  hasDetail: boolean;
};

export type AuditFacets = {
  actions: string[];
  entityTypes: string[];
};

/**
 * The window, as SQL.
 *
 * `now() - interval` rather than a timestamp computed in JS: the
 * comparison then happens in the database's clock and time zone, which
 * is the same clock `occurred_at` was written by. Two clocks is how a
 * row that just landed fails to appear in "last 24 hours".
 */
function windowFor(period: PeriodKey): SQL {
  const hours = PERIODS[period].hours;
  return sql`a.occurred_at >= now() - ${`${hours} hours`}::interval`;
}

function conditions(query: ListQuery, period: PeriodKey): SQL {
  const parts: SQL[] = [windowFor(period)];

  if (query.extra.action) parts.push(sql`a.action = ${query.extra.action}`);
  if (query.extra.entity) parts.push(sql`a.entity_type = ${query.extra.entity}`);
  if (query.extra.result && (RESULTS as readonly string[]).includes(query.extra.result)) {
    parts.push(sql`a.result = ${query.extra.result}::wms.audit_result`);
  }
  if (query.extra.actor) parts.push(sql`a.actor_email = ${query.extra.actor}::citext`);

  /**
   * Free text, INSIDE the window and never instead of it.
   *
   * Deliberately not searching `before`/`after`: a substring match
   * against those would let somebody fish for a phone number they are
   * not allowed to read, one guess at a time, and get a yes/no answer
   * from the row count. It searches what the list already shows.
   */
  if (query.q) {
    const like = `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    parts.push(sql`(
         a.actor_email::text ilike ${like}
      or a.actor_name ilike ${like}
      or a.action ilike ${like}
      or a.entity_type ilike ${like}
      or a.entity_id ilike ${like}
      or a.entity_label ilike ${like}
      or a.reason ilike ${like}
    )`);
  }

  return sql.join(parts, sql` and `);
}

export async function readAuditPage(
  query: ListQuery,
  period: PeriodKey,
): Promise<{ rows: AuditRow[]; list: ListState }> {
  const where = conditions(query, period);

  // Sequential, never Promise.all — see src/db/index.ts on pipelining.
  const [{ total }] = await getDb().execute<{ total: number }>(sql`
    select count(*)::int as total from wms.audit_log a where ${where}
  `);

  const list = finishList(query, Number(total), AUDIT_SORTABLE);
  const offset = (list.page - 1) * list.size;

  const rows = await getDb().execute<{
    id: string;
    occurred_at: string;
    actor_name: string | null;
    actor_email: string | null;
    action: string;
    operation: string;
    entity_type: string;
    entity_id: string;
    entity_label: string | null;
    result: string;
    reason: string | null;
    has_detail: boolean;
  }>(sql`
    select a.id::text as id,
           a.occurred_at::text as occurred_at,
           a.actor_name,
           a.actor_email::text as actor_email,
           a.action,
           a.operation::text as operation,
           a.entity_type,
           a.entity_id,
           a.entity_label,
           a.result::text as result,
           a.reason,
           -- The payload itself stays out of the list; this is only
           -- whether the eye icon is worth drawing.
           (a.before is not null or a.after is not null) as has_detail
      from wms.audit_log a
     where ${where}
     order by a.occurred_at ${sql.raw(list.dir === "asc" ? "asc" : "desc")}, a.id desc
     limit ${list.size} offset ${offset}
  `);

  return {
    rows: rows.map((r) => ({
      id: String(r.id),
      occurredAt: r.occurred_at,
      actorName: r.actor_name,
      actorEmail: r.actor_email,
      action: r.action,
      operation: r.operation,
      entityType: r.entity_type,
      entityId: r.entity_id,
      entityLabel: r.entity_label,
      result: r.result,
      reason: r.reason,
      hasDetail: Boolean(r.has_detail),
    })),
    list,
  };
}

/**
 * What to put in the two dropdowns.
 *
 * Read from the same window the list uses, so the menu offers what is
 * actually in view — a 68-entry list of every action the system has ever
 * recorded is a worse control than a short list of what happened this
 * month, and the long one invites you to pick something that returns
 * nothing.
 */
export async function readAuditFacets(period: PeriodKey): Promise<AuditFacets> {
  const window = windowFor(period);

  const actions = await getDb().execute<{ action: string }>(sql`
    select distinct a.action from wms.audit_log a where ${window} order by a.action
  `);
  const entities = await getDb().execute<{ entity_type: string }>(sql`
    select distinct a.entity_type from wms.audit_log a where ${window} order by a.entity_type
  `);

  return {
    actions: actions.map((r) => r.action),
    entityTypes: entities.map((r) => r.entity_type),
  };
}

export type AuditDetail = {
  id: string;
  occurredAt: string;
  actorName: string | null;
  actorEmail: string | null;
  actorRoles: string[];
  action: string;
  operation: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  result: string;
  reason: string | null;
  errorCode: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  correlationId: string | null;
  source: string;
  durationMs: number | null;
  changedKeys: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

/**
 * One row, in full.
 *
 * Fetched only when somebody opens it, because this is where the
 * contact details live. The window is not applied — an id is already as
 * narrow as a query gets, and the partition is found by the planner
 * from the primary key.
 */
export async function readAuditEntry(id: string): Promise<AuditDetail | null> {
  if (!/^\d{1,19}$/.test(id)) return null;

  const [row] = await getDb().execute<{
    id: string;
    occurred_at: string;
    actor_name: string | null;
    actor_email: string | null;
    actor_roles: string[] | null;
    action: string;
    operation: string;
    entity_type: string;
    entity_id: string;
    entity_label: string | null;
    result: string;
    reason: string | null;
    error_code: string | null;
    ip: string | null;
    user_agent: string | null;
    request_id: string | null;
    correlation_id: string | null;
    source: string;
    duration_ms: number | null;
    changed_keys: string[] | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }>(sql`
    select a.id::text as id, a.occurred_at::text as occurred_at,
           a.actor_name, a.actor_email::text as actor_email,
           a.actor_roles::text[] as actor_roles,
           a.action, a.operation::text as operation,
           a.entity_type, a.entity_id, a.entity_label,
           a.result::text as result, a.reason, a.error_code,
           a.ip::text as ip, a.user_agent, a.request_id, a.correlation_id,
           a.source, a.duration_ms, a.changed_keys,
           a.before, a.after
      from wms.audit_log a
     where a.id = ${id}::bigint
     limit 1
  `);

  if (!row) return null;

  return {
    id: String(row.id),
    occurredAt: row.occurred_at,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    actorRoles: row.actor_roles ?? [],
    action: row.action,
    operation: row.operation,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityLabel: row.entity_label,
    result: row.result,
    reason: row.reason,
    errorCode: row.error_code,
    ip: row.ip,
    userAgent: row.user_agent,
    requestId: row.request_id,
    correlationId: row.correlation_id,
    source: row.source,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    changedKeys: row.changed_keys ?? [],
    before: row.before,
    after: row.after,
  };
}
