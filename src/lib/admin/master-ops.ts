import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { revalidateTag } from "next/cache";

import { getDb } from "@/db";
import { auditQuietly } from "@/lib/audit";
import type { MasterResource } from "@/lib/admin/master-registry";
import { isForeignKeyViolation } from "@/lib/db-errors";

/**
 * The write operations the master routes share — the single-row route
 * and the bulk route both call these, so a rule enforced here (delete
 * only when unused; audit every change) is enforced in both places by
 * construction.
 *
 * Next.js forbids a route file from exporting anything but handlers,
 * which is why this is a module of its own rather than a corner of the
 * route.
 */

/**
 * Drop whatever public cache this table feeds, if it feeds one.
 *
 * The tag is named by the resource rather than by the route, so the
 * route stays generic: it drops what the registry declares, and a
 * resource that feeds nothing public declares nothing. Without this an
 * edited FAQ would sit behind the five-minute cache and the person who
 * saved it would reasonably conclude it had not worked.
 *
 * Quiet on failure. Outside a request Next can revalidate, this throws,
 * and a stale cache is not worth failing a save over.
 */
export function dropPublicCache(resource: MasterResource): void {
  if (!resource.publicTag) return;
  try {
    revalidateTag(resource.publicTag);
  } catch (error) {
    console.error("[master] public cache not dropped", {
      table: resource.table,
      tag: resource.publicTag,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** `code`, `sort_order` … always from the registry, never from a body. */
export function identifier(value: string): SQL {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    // Unreachable from a request; a guard against a future typo in the
    // registry becoming an injection rather than a crash.
    throw new Error(`Refusing to use '${value}' as an identifier`);
  }
  return sql.raw(value);
}

/** `select count(*) …` per dependent, as one scalar subquery each. */
export function dependentCounts(resource: MasterResource, idColumn: SQL): SQL[] {
  return resource.dependents.map(
    (d) => sql`(select count(*) from wms.${identifier(d.table)} dep
                 where dep.${identifier(d.column)} = ${idColumn})`,
  );
}

type ActorLite = {
  session: { userId: number; email: string; firstName: string; lastName: string };
};

/** "3 cities, 2 warehouses" — or "" when nothing points at the row. */
export async function inUseSummary(resource: MasterResource, id: number): Promise<string> {
  if (resource.dependents.length === 0) return "";
  const counts = await getDb().execute<Record<string, number>>(sql`
    select ${sql.join(
      dependentCounts(resource, sql`${id}`).map((c, i) => sql`${c}::int as c${sql.raw(String(i))}`),
      sql`, `,
    )}
  `);
  return resource.dependents
    .map((d, i) => `${counts[0]?.[`c${i}`] ?? 0} ${d.noun}`)
    .filter((s) => !s.startsWith("0 "))
    .join(", ");
}

export type RowOutcome =
  | { id: number; ok: true }
  | { id: number; ok: false; reason: "not_found" | "in_use"; detail?: string };

/**
 * Delete one row, or say precisely why not.
 *
 * Refused while anything points at it — the database would refuse too
 * (every FK is NO ACTION), but its message names a constraint and this
 * one names the records. The FK check is also kept, for the race where
 * a dependent appears between the count and the delete.
 */
export async function deleteOne(
  resource: MasterResource,
  id: number,
  actor: ActorLite,
  meta: { requestId: string; ip: string | null; userAgent: string | null },
): Promise<RowOutcome> {
  const before = await getDb().execute<Record<string, unknown>>(sql`
    select * from wms.${identifier(resource.table)} where id = ${id} and deleted_at is null
  `);
  if (before.length === 0) return { id, ok: false, reason: "not_found" };

  const inUse = await inUseSummary(resource, id);
  if (inUse) return { id, ok: false, reason: "in_use", detail: inUse };

  /**
   * A financial record is never erased.
   *
   * Every other master table hard-deletes a row nothing points at,
   * because a country nobody references is a typo. An expense is not:
   * it leaves the lists and the totals, and it is still there at year
   * end for anybody asking what a figure was made of.
   */
  if (resource.softDeleteOnly) {
    await getDb().execute(sql`
      update wms.${identifier(resource.table)}
         set deleted_at = now(), deleted_by = ${actor.session.userId},
             ${
               // Not every table has `is_active`: transporter and vehicle
               // carry the `record_status` enum instead, and naming a
               // column that is not there is a 500 on the delete button.
               resource.statusColumn
                 ? sql`${identifier(resource.statusColumn.column)} = ${resource.statusColumn.inactiveValue}`
                 : sql`is_active = false`
             }
       where id = ${id} and deleted_at is null
    `);
  } else {
    try {
      await getDb().execute(sql`
        delete from wms.${identifier(resource.table)} where id = ${id}
      `);
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        return { id, ok: false, reason: "in_use", detail: "records that were just created" };
      }
      throw error;
    }
  }

  const snapshot: Record<string, unknown> = {};
  for (const field of resource.fields) snapshot[field.key] = before[0]![field.column] ?? null;
  if (resource.parent) snapshot[resource.parent.key] = before[0]![resource.parent.column] ?? null;
  snapshot.isActive = resource.statusColumn
    ? before[0]![resource.statusColumn.column] === resource.statusColumn.activeValue
    : before[0]!.is_active;

  await auditQuietly({
    action: `${resource.permission}.deleted`,
    operation: "DELETE",
    entityType: resource.permission,
    entityId: String(id),
    entityLabel: String(before[0]!.name ?? before[0]!.code ?? ""),
    // The schema insists a DELETE row says why; "not in use" is the
    // only reason this code path ever deletes.
    reason: resource.softDeleteOnly
      ? "Removed from the books; the row is kept for the audit trail"
      : "Deleted from the master screen; nothing referenced the row",
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    before: snapshot,
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
  return { id, ok: true };
}

/**
 * Switch a row on or off. Switching off a row that is in use is allowed
 * (existing references keep working; the row leaves the pickers) but
 * reported, so a bulk caller can say "deactivated 5, 2 of them in use".
 */
export async function setActive(
  resource: MasterResource,
  id: number,
  isActive: boolean,
  actor: ActorLite,
  meta: { requestId: string; ip: string | null; userAgent: string | null },
): Promise<RowOutcome & { wasInUse?: string }> {
  // The label for the audit row is the first field of the resource —
  // a code where there is one, the name otherwise.
  const labelColumn = identifier(resource.fields[0]!.column);
  const rows = await getDb().execute<{ id: number; was: boolean; label: string | null }>(sql`
    update wms.${identifier(resource.table)} m
       set is_active = ${isActive}, updated_by = ${actor.session.userId}
      from (select id, is_active as was, ${labelColumn}::text as label
              from wms.${identifier(resource.table)} where id = ${id} and deleted_at is null) o
     where m.id = o.id
    returning m.id, o.was, o.label
  `);
  if (rows.length === 0) return { id, ok: false, reason: "not_found" };

  const wasInUse = !isActive ? await inUseSummary(resource, id) : "";

  if (rows[0]!.was !== isActive) {
    await auditQuietly({
      action: `${resource.permission}.updated`,
      operation: "UPDATE",
      entityType: resource.permission,
      entityId: String(id),
      entityLabel: rows[0]!.label ?? "",
      actorUserId: actor.session.userId,
      actorEmail: actor.session.email,
      actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
      before: { isActive: rows[0]!.was },
      after: { isActive },
      ip: meta.ip,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    });
  }
  return { id, ok: true, ...(wasInUse ? { wasInUse } : {}) };
}

