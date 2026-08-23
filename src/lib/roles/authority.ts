import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import type { Actor } from "@/lib/auth/guard";

/**
 * Who may change what a role means, and who may make an exception for
 * one person.
 *
 * Two rules, and neither is a preference:
 *
 *   1. You cannot give what you do not hold. Granting `expense.create`
 *      at ALL requires holding it at ALL — otherwise the screen is a
 *      privilege-escalation ladder with a nice table on it.
 *
 *   2. You cannot edit sideways or upwards. A role at or above your own
 *      level is not yours to redefine, and a protected role is nobody's.
 *
 * Rule 1 is the one that matters. Rule 2 is what stops two people at the
 * same level quietly rewriting each other.
 */

/** ALL 3 · WAREHOUSE 2 · OWN 1 — the same order `wms.access_rank` uses. */
export const SCOPES = ["OWN", "WAREHOUSE", "ALL"] as const;
export type Scope = (typeof SCOPES)[number];

export function scopeRank(scope: string): number {
  return scope === "ALL" ? 3 : scope === "WAREHOUSE" ? 2 : scope === "OWN" ? 1 : 0;
}

export type Refusal = { ok: false; reason: string };

/**
 * The highest role level this caller holds.
 *
 * Their own ceiling for rule 2. Somebody with no role at all gets 0 and
 * may edit nothing, which is the right answer rather than an error.
 */
export async function actorLevel(actor: Actor): Promise<number> {
  const held = [...new Set(actor.roles.map((r) => r.role))];
  if (held.length === 0) return 0;
  const [row] = await getDb().execute<{ level: number }>(sql`
    select coalesce(max(level), 0)::int as level
      from wms.role
     where key in (${sql.join(
       held.map((r) => sql`${r}::wms.role_key`),
       sql`, `,
     )})
  `);
  return Number(row?.level ?? 0);
}

export type EditableRole = {
  key: string;
  name: string;
  domain: string;
  level: number;
  description: string | null;
  grants: number;
  holders: number;
  /** Present when this role is visible but not editable, and why. */
  lockedReason: string | null;
};

/**
 * Every role, with whether this caller may edit it and why not.
 *
 * Locked roles are listed rather than hidden: "why can I not see
 * Warehouse Admin here" is a worse question than "why is it greyed
 * out", and the answer to the second one is on screen.
 */
export async function rolesFor(actor: Actor): Promise<EditableRole[]> {
  const mine = await actorLevel(actor);

  const rows = await getDb().execute<{
    key: string;
    name: string;
    domain: string;
    level: number;
    description: string | null;
    is_protected: boolean;
    grants: number;
    holders: number;
  }>(sql`
    select r.key::text as key, r.name, r.domain::text as domain, r.level,
           r.description, r.is_protected,
           (select count(*)::int from wms.role_permission rp where rp.role = r.key) as grants,
           (select count(distinct ura.user_id)::int
              from wms.user_role_assignment ura
             where ura.role = r.key and ura.revoked_at is null) as holders
      from wms.role r
     order by r.level desc, r.name
  `);

  return rows.map((r) => ({
    key: r.key,
    name: r.name,
    domain: r.domain,
    level: Number(r.level),
    description: r.description,
    grants: Number(r.grants),
    holders: Number(r.holders),
    lockedReason: lockReason(r.is_protected, Number(r.level), mine),
  }));
}

function lockReason(protectedRole: boolean, level: number, mine: number): string | null {
  if (protectedRole) {
    return "Protected. Super Admin must always be able to put rights back, and the customer-facing roles decide what every importer and sales agent can do.";
  }
  if (level >= mine) {
    return "That role sits at or above your own level, so it is not yours to redefine.";
  }
  return null;
}

/** May this caller edit this role's permission set? */
export async function mayEditRole(actor: Actor, key: string): Promise<true | Refusal> {
  const mine = await actorLevel(actor);
  const [row] = await getDb().execute<{ level: number; is_protected: boolean }>(sql`
    select level, is_protected from wms.role where key::text = ${key}
  `);
  if (!row) return { ok: false, reason: "No such role" };
  const locked = lockReason(row.is_protected, Number(row.level), mine);
  return locked === null ? true : { ok: false, reason: locked };
}

/**
 * Rule 1, in one function.
 *
 * Note it reads the CALLER's effective permissions, not their roles —
 * so a permission they hold only through an ALLOW override still counts,
 * and one taken away by a DENY does not. That is the honest reading of
 * "what you hold".
 */
export function mayGrant(actor: Actor, permission: string, scope: string): true | Refusal {
  const held = actor.permissions.find((p) => p.permission === permission);
  if (!held) {
    return {
      ok: false,
      reason: `You do not hold ${permission} yourself, so you cannot give it to anybody.`,
    };
  }
  if (scopeRank(scope) > scopeRank(held.scope)) {
    return {
      ok: false,
      reason: `You hold ${permission} at ${held.scope}, so you cannot grant it at ${scope}.`,
    };
  }
  return true;
}

/**
 * The natural scope for a role's domain.
 *
 * A platform role's grants are usually ALL, a warehouse role's are
 * usually WAREHOUSE, an importer's are OWN. Only a default for a newly
 * ticked box — the row's own scope control overrides it.
 */
export function defaultScopeFor(domain: string): Scope {
  return domain === "WAREHOUSE" ? "WAREHOUSE" : domain === "IMPORTER" ? "OWN" : "ALL";
}
