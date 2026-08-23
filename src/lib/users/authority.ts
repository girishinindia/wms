import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import type { Actor } from "@/lib/auth/guard";

/**
 * Who may give whom which role, and for which warehouse.
 *
 * The rulebook is `wms.role_creation_rule`, which already existed and
 * already said most of this. Nothing here re-states it as an `if`
 * ladder: this module reads the table and answers questions about it.
 * Adding a role tomorrow is a row, not a deploy.
 *
 * The two things the table cannot say on its own, and this module can:
 *
 *   1. SAME_WAREHOUSE means "one of the caller's OWN warehouses", which
 *      needs the caller's assignments, not just their role.
 *   2. An IMPORTER or SALES_AGENT assignment is immutable — the
 *      database refuses to change or remove one, for anybody including
 *      a super admin. The UI must not offer what will always fail.
 */

/** The two roles nobody may add, change or take away. `role.is_immutable`
 *  is the authority; this is the same fact where the UI can see it. */
export const IMMUTABLE_ROLES = ["IMPORTER", "SALES_AGENT"] as const;

export function isImmutableRole(role: string): boolean {
  return (IMMUTABLE_ROLES as readonly string[]).includes(role);
}

export type CreatableRole = {
  role: string;
  /** PLATFORM · WAREHOUSE · IMPORTER — decides which id the assignment
   *  needs, and therefore what the form must ask for. */
  domain: string;
  label: string;
  /** ANY · SAME_WAREHOUSE · SAME_IMPORTER · SELF_REGISTER */
  scope: string;
};

/** The caller's own live warehouses, from their own assignments. This is
 *  what makes "a warehouse admin may manage several sites" work with no
 *  new column: two assignments, two warehouses. */
export function actorWarehouseIds(actor: Actor): number[] {
  return [
    ...new Set(
      actor.roles
        .filter((r) => r.warehouseId !== null)
        .map((r) => r.warehouseId as number),
    ),
  ];
}

/**
 * Every role this caller may hand out, with the scope that applies.
 *
 * A super admin's rows come back at ANY; a warehouse admin's at
 * SAME_WAREHOUSE. Somebody holding both roles gets the widest of the
 * two, because being a warehouse admin as well cannot take authority
 * away from a super admin.
 */
export async function creatableRoles(actor: Actor): Promise<CreatableRole[]> {
  const held = [...new Set(actor.roles.map((r) => r.role))];
  if (held.length === 0) return [];

  /**
   * `in (...)`, not `= any($1)`.
   *
   * postgres.js expands a JavaScript array into a parameter LIST rather
   * than binding one array value, so `any(${held})` becomes
   * `any($1, $2)` and the statement will not even parse. The roles route
   * learned this the hard way; each role is still a bound parameter.
   */
  const heldList = sql.join(
    held.map((r) => sql`${r}::wms.role_key`),
    sql`, `,
  );

  const rows = await getDb().execute<{
    target_role: string;
    domain: string;
    name: string;
    scope: string;
  }>(sql`
    select rcr.target_role::text as target_role,
           r.domain::text as domain,
           r.name,
           -- ANY beats SAME_WAREHOUSE when the caller holds both paths.
           (array_agg(rcr.scope::text
                      order by case rcr.scope::text when 'ANY' then 0 else 1 end))[1] as scope
      from wms.role_creation_rule rcr
      join wms.role r on r.key = rcr.target_role
     where rcr.actor_role in (${heldList})
       and rcr.scope <> 'SELF_REGISTER'
     group by rcr.target_role, r.domain, r.name, r.level
     order by r.level desc, r.name
  `);

  return rows
    // Belt and braces: no rule grants these today, and if one ever did
    // the database would still refuse the assignment.
    .filter((r) => !isImmutableRole(r.target_role))
    .map((r) => ({
      role: r.target_role,
      domain: r.domain,
      label: r.name,
      scope: r.scope,
    }));
}

/**
 * A refusal, and which KIND of refusal it is.
 *
 * The distinction is not cosmetic. "Choose a warehouse" is a form that
 * is not filled in yet — 422, highlight the field, let them carry on.
 * "That warehouse is not yours" is an authorisation decision — 403, and
 * it belongs in the audit log next to every other refused attempt.
 * Collapsing the two loses the second one entirely.
 */
export type AuthorityRefusal = {
  ok: false;
  reason: string;
  field?: string;
  kind: "FORBIDDEN" | "VALIDATION_FAILED";
};
export type AuthorityGrant = { ok: true; domain: string; warehouseId: number | null };

/**
 * May this caller give this role, here?
 *
 * Answers the whole question in one place so the create route and the
 * assign route cannot drift: they call this, and the UI is built from
 * `creatableRoles`, which reads the same table.
 */
export async function mayAssign(
  actor: Actor,
  role: string,
  warehouseId: number | null,
): Promise<AuthorityGrant | AuthorityRefusal> {
  if (isImmutableRole(role)) {
    return {
      ok: false,
      kind: "FORBIDDEN",
      field: "role",
      reason:
        "Importer and Sales Agent roles cannot be assigned or changed by anyone — they are bound to the company record for good.",
    };
  }

  const allowed = await creatableRoles(actor);
  const rule = allowed.find((r) => r.role === role);
  if (!rule) {
    return { ok: false, kind: "FORBIDDEN", field: "role", reason: "You cannot assign that role." };
  }

  if (rule.domain === "WAREHOUSE") {
    if (warehouseId === null) {
      // The only one of these that is a form problem rather than an
      // authorisation one: nothing was chosen yet.
      return {
        ok: false,
        kind: "VALIDATION_FAILED",
        field: "warehouseId",
        reason: "Choose a warehouse for this role.",
      };
    }
    /**
     * The line that keeps one branch out of another's staff. A warehouse
     * admin's rule comes back as SAME_WAREHOUSE, and "same" is measured
     * against their own live assignments — not against anything in the
     * request.
     */
    if (rule.scope === "SAME_WAREHOUSE" && !actorWarehouseIds(actor).includes(warehouseId)) {
      return {
        ok: false,
        kind: "FORBIDDEN",
        field: "warehouseId",
        reason: "You can only do this for a warehouse you are assigned to.",
      };
    }
    return { ok: true, domain: "WAREHOUSE", warehouseId };
  }

  /**
   * An importer-domain role belongs to a company, not to staff, and is
   * granted by the importer flow that already exists. Both of them are
   * immutable today so this line is unreachable — it is here so that
   * making one mutable tomorrow fails as a sentence rather than as a
   * CHECK violation surfacing from the database as a 500.
   */
  if (rule.domain === "IMPORTER") {
    return {
      ok: false,
      kind: "FORBIDDEN",
      field: "role",
      reason: "That role belongs to an importer's own account and is not granted from here.",
    };
  }

  // PLATFORM roles take no warehouse; sending one is a sign the caller
  // is guessing, and the CHECK on the table would refuse it anyway.
  return { ok: true, domain: rule.domain, warehouseId: null };
}

/**
 * May this caller touch this user's roles at all?
 *
 * Nobody, super admin included, may touch an importer's or a sales
 * agent's account: those roles are bound to the company record for
 * life. Beyond that, a super admin may touch anyone; a warehouse admin
 * may only touch somebody whose every live assignment sits inside their
 * own sites — so a shared user who also works at another branch is off
 * limits, rather than half-editable.
 *
 * Answered from the target's assignments rather than from who created
 * them: a person's reach is what they hold today, not who typed their
 * name in first.
 */
export async function mayManageUser(
  actor: Actor,
  targetUserId: number,
): Promise<true | AuthorityRefusal> {
  if (actor.session.userId === targetUserId) {
    return { ok: false, kind: "FORBIDDEN", reason: "You cannot change your own roles." };
  }

  const rows = await getDb().execute<{ role: string; warehouse_id: number | null }>(sql`
    select role::text as role, warehouse_id
      from wms.user_role_assignment
     where user_id = ${targetUserId} and revoked_at is null
  `);

  /**
   * This one applies to everybody.
   *
   * `ura_protect_immutable` already refuses to change or remove such an
   * assignment, for any caller. What it cannot refuse is ADDING a
   * second role beside it — the trigger fires on UPDATE and DELETE
   * only. Stacking a warehouse role onto an importer's login is exactly
   * "changing the role of an importer" by another route, so it is
   * refused here.
   */
  if (rows.some((r) => isImmutableRole(r.role))) {
    return {
      ok: false,
      kind: "FORBIDDEN",
      reason: "That account belongs to an importer or a sales agent, and its roles are fixed.",
    };
  }

  return withinReach(actor, "role.assign", rows, "change its roles");
}

/**
 * Is this account one the caller may act on at all?
 *
 * Separate from `mayManageUser`, and the separation is the point. That
 * function answers a question about ROLES, and its importer rule binds
 * everybody — a super admin may not stack a role onto an importer's
 * login. This one answers a question about REACH: a super admin holding
 * the permission at ALL may suspend, rename or delete anyone, importers
 * included, exactly as they could before; a warehouse admin may only do
 * it to somebody whose every live assignment sits inside their sites.
 *
 * It exists because `requirePermission` cannot ask it. A WAREHOUSE-scoped
 * grant with no warehouse named on the request is let through — correct
 * for a list or a create, and wide open for "suspend user 151", where
 * the warehouse is a property of the TARGET rather than of the request.
 * Every route that changes somebody else's login has to narrow it here.
 */
export async function mayActOnUser(
  actor: Actor,
  targetUserId: number,
  permission: string,
  verb = "do that",
): Promise<true | AuthorityRefusal> {
  const grant = actor.permissions.find((p) => p.permission === permission);
  if (grant?.scope === "ALL") return true;

  const rows = await getDb().execute<{ role: string; warehouse_id: number | null }>(sql`
    select role::text as role, warehouse_id
      from wms.user_role_assignment
     where user_id = ${targetUserId} and revoked_at is null
  `);
  return withinReach(actor, permission, rows, verb);
}

/** The warehouse-admin half, shared so the two callers cannot drift. */
function withinReach(
  actor: Actor,
  permission: string,
  rows: { role: string; warehouse_id: number | null }[],
  verb: string,
): true | AuthorityRefusal {
  const grant = actor.permissions.find((p) => p.permission === permission);
  if (grant?.scope === "ALL") return true;

  const mine = actorWarehouseIds(actor);
  if (mine.length === 0) {
    return { ok: false, kind: "FORBIDDEN", reason: "You are not assigned to a warehouse." };
  }
  /**
   * A user with no live assignment at all is refused rather than
   * allowed. It reads as the cautious way round: an account whose roles
   * have all been revoked belongs to whoever holds the platform, not to
   * whichever branch manager happens to open it.
   */
  const outside = rows.filter((r) => r.warehouse_id === null || !mine.includes(r.warehouse_id));
  if (rows.length === 0 || outside.length > 0) {
    return {
      ok: false,
      kind: "FORBIDDEN",
      reason: `That account is not one of yours, so you cannot ${verb}.`,
    };
  }
  return true;
}
