import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { auditQuietly } from "@/lib/audit";
import type { Actor } from "@/lib/auth/guard";
import { invalidateUsers } from "@/lib/cache/actor";
import { mayEditRole, mayGrant, scopeRank, SCOPES } from "@/lib/roles/authority";

/**
 * Reading and rewriting one role's permission set.
 *
 * The screen sends a DIFF, not the whole matrix. 156 permissions posted
 * as a complete set means two people saving a minute apart silently undo
 * each other's work; a diff of "these three changed" leaves the other
 * 153 alone whoever else touched them.
 */

export class RoleError extends Error {
  constructor(
    readonly kind: "VALIDATION_FAILED" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT",
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "RoleError";
  }
}

export type PermissionRow = {
  key: string;
  resource: string;
  action: string;
  module: string;
  isDangerous: boolean;
  description: string | null;
  /** The scope this role holds it at, or null when it does not. */
  scope: string | null;
  /** Whether the CALLER could give it — rule 1, resolved on the server
   *  so a box the API would refuse is never offered. */
  grantable: boolean;
  /** The widest scope the caller could give it at. */
  maxScope: string | null;
};

export type RoleMatrix = {
  key: string;
  name: string;
  domain: string;
  level: number;
  description: string | null;
  holders: number;
  editable: boolean;
  lockedReason: string | null;
  permissions: PermissionRow[];
};

export async function readMatrix(actor: Actor, key: string): Promise<RoleMatrix | null> {
  const [role] = await getDb().execute<{
    key: string;
    name: string;
    domain: string;
    level: number;
    description: string | null;
  }>(sql`
    select key::text as key, name, domain::text as domain, level, description
      from wms.role where key::text = ${key}
  `);
  if (!role) return null;

  const [{ holders }] = await getDb().execute<{ holders: number }>(sql`
    select count(distinct user_id)::int as holders
      from wms.user_role_assignment
     where role::text = ${key} and revoked_at is null
  `);

  const rows = await getDb().execute<{
    key: string;
    resource: string;
    action: string;
    module: string;
    is_dangerous: boolean;
    description: string | null;
    scope: string | null;
  }>(sql`
    select p.key, p.resource, p.action, p.module, p.is_dangerous, p.description,
           rp.scope::text as scope
      from wms.permission p
      left join wms.role_permission rp
        on rp.permission = p.key and rp.role::text = ${key}
     order by p.module, p.resource, p.action
  `);

  const verdict = await mayEditRole(actor, key);

  return {
    key: role.key,
    name: role.name,
    domain: role.domain,
    level: Number(role.level),
    description: role.description,
    holders: Number(holders),
    editable: verdict === true,
    lockedReason: verdict === true ? null : verdict.reason,
    permissions: rows.map((r) => {
      const allowed = mayGrant(actor, r.key, "OWN");
      const held = actor.permissions.find((p) => p.permission === r.key);
      return {
        key: r.key,
        resource: r.resource,
        action: r.action,
        module: r.module,
        isDangerous: r.is_dangerous,
        description: r.description,
        scope: r.scope,
        grantable: allowed === true,
        maxScope: held?.scope ?? null,
      };
    }),
  };
}

/** One line of the diff: a permission set to a scope, or removed. */
export type MatrixChange = { permission: string; scope: string | null };

export type MatrixResult = { added: number; changed: number; removed: number; holders: number };

/**
 * Apply a diff, or refuse the whole thing.
 *
 * All-or-nothing on purpose: a half-applied permission change is a role
 * that means something nobody chose. Every line is checked before any
 * line is written.
 */
export async function applyMatrix(
  actor: Actor,
  key: string,
  changes: MatrixChange[],
  reason: string,
  meta: { requestId: string; ip: string | null; userAgent: string | null },
): Promise<MatrixResult> {
  const verdict = await mayEditRole(actor, key);
  if (verdict !== true) throw new RoleError("FORBIDDEN", verdict.reason);
  if (changes.length === 0) throw new RoleError("VALIDATION_FAILED", "Nothing to change");

  // ── Check every line first ──────────────────────────────────────
  const known = await getDb().execute<{ key: string }>(sql`
    select key from wms.permission
     where key in (${sql.join(
       changes.map((c) => sql`${c.permission}`),
       sql`, `,
     )})
  `);
  const exists = new Set(known.map((r) => r.key));

  for (const change of changes) {
    if (!exists.has(change.permission)) {
      throw new RoleError("VALIDATION_FAILED", `No such permission: ${change.permission}`);
    }
    // A removal needs no authority beyond editing the role: taking
    // something away can never be an escalation.
    if (change.scope === null) continue;

    if (!(SCOPES as readonly string[]).includes(change.scope)) {
      throw new RoleError("VALIDATION_FAILED", `Not a scope: ${change.scope}`);
    }
    const allowed = mayGrant(actor, change.permission, change.scope);
    if (allowed !== true) {
      throw new RoleError("FORBIDDEN", allowed.reason, { [change.permission]: "Beyond your own" });
    }
  }

  const before = await getDb().execute<{ permission: string; scope: string }>(sql`
    select permission, scope::text as scope from wms.role_permission
     where role::text = ${key}
       and permission in (${sql.join(
         changes.map((c) => sql`${c.permission}`),
         sql`, `,
       )})
  `);
  const had = new Map(before.map((r) => [r.permission, r.scope]));

  /**
   * The last line of defence against emptying a role.
   *
   * A role with no way into the admin area is not an error anybody
   * sees — the holders just find a blank sidebar and no explanation.
   * Counted after the diff is applied in memory, before it is written.
   */
  const [{ total }] = await getDb().execute<{ total: number }>(sql`
    select count(*)::int as total from wms.role_permission where role::text = ${key}
  `);
  const removing = changes.filter((c) => c.scope === null && had.has(c.permission)).length;
  const adding = changes.filter((c) => c.scope !== null && !had.has(c.permission)).length;
  if (Number(total) - removing + adding === 0) {
    throw new RoleError(
      "CONFLICT",
      "That would leave the role with no permissions at all. Its holders would see an empty screen with no explanation — take the role away from them instead.",
    );
  }

  // ── Write ───────────────────────────────────────────────────────
  const toSet = changes.filter((c) => c.scope !== null);
  const toDrop = changes.filter((c) => c.scope === null);

  if (toSet.length > 0) {
    await getDb().execute(sql`
      insert into wms.role_permission (role, permission, scope)
      values ${sql.join(
        toSet.map((c) => sql`(${key}::wms.role_key, ${c.permission}, ${c.scope}::wms.access_scope)`),
        sql`, `,
      )}
      on conflict (role, permission) do update set scope = excluded.scope
    `);
  }
  if (toDrop.length > 0) {
    await getDb().execute(sql`
      delete from wms.role_permission
       where role::text = ${key}
         and permission in (${sql.join(
           toDrop.map((c) => sql`${c.permission}`),
           sql`, `,
         )})
    `);
  }

  /**
   * Everybody holding the role, out of the cache.
   *
   * The actor cache is keyed per session and invalidated per USER, so a
   * change to a role has to fan out to its holders by hand. Miss this
   * and the change appears to do nothing for up to the TTL — which
   * reads as "the screen is broken", and the next thing that happens is
   * somebody clicks save again.
   */
  const holders = await getDb().execute<{ user_id: number }>(sql`
    select distinct user_id from wms.user_role_assignment
     where role::text = ${key} and revoked_at is null
  `);
  await invalidateUsers(holders.map((h) => Number(h.user_id)));

  const result: MatrixResult = {
    added: adding,
    changed: changes.filter((c) => c.scope !== null && had.has(c.permission) && had.get(c.permission) !== c.scope).length,
    removed: removing,
    holders: holders.length,
  };

  await auditQuietly({
    action: "role.permissions_updated",
    operation: "UPDATE",
    entityType: "role",
    entityId: key,
    entityLabel: key,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    reason,
    // Both sides, narrowed to what this request touched — a diff that
    // says every column changed says nothing.
    before: Object.fromEntries(changes.map((c) => [c.permission, had.get(c.permission) ?? null])),
    after: Object.fromEntries(changes.map((c) => [c.permission, c.scope])),
    metadata: { holders: result.holders },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });

  return result;
}

// ── Per-user exceptions ───────────────────────────────────────────

export type Override = {
  id: number;
  permission: string;
  effect: "ALLOW" | "DENY";
  scope: string | null;
  reason: string;
  expiresAt: string | null;
  createdAt: string;
  grantedBy: string | null;
};

export async function listOverrides(userId: number): Promise<Override[]> {
  const rows = await getDb().execute<{
    id: number;
    permission: string;
    effect: string;
    scope: string | null;
    reason: string;
    expires_at: string | null;
    created_at: string;
    granted_by_name: string | null;
  }>(sql`
    select po.id, po.permission, po.effect, po.scope::text as scope, po.reason,
           po.expires_at, po.created_at,
           trim(g.first_name || ' ' || g.last_name) as granted_by_name
      from wms.permission_override po
      left join wms.users g on g.id = po.granted_by
     where po.user_id = ${userId} and po.revoked_at is null
       and (po.expires_at is null or po.expires_at > now())
     order by po.effect, po.permission
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    permission: r.permission,
    effect: r.effect as "ALLOW" | "DENY",
    scope: r.scope,
    reason: r.reason,
    expiresAt: r.expires_at ? String(r.expires_at) : null,
    createdAt: String(r.created_at),
    grantedBy: r.granted_by_name,
  }));
}

/**
 * Make one exception for one person.
 *
 * An ALLOW is bounded by rule 1 — you cannot hand out what you do not
 * hold, at a scope you do not hold it at. A DENY needs no such check:
 * taking something away is never an escalation, and the person who can
 * manage the account can already remove the role entirely.
 */
export async function addOverride(
  actor: Actor,
  userId: number,
  input: {
    permission: string;
    effect: "ALLOW" | "DENY";
    scope?: string | null;
    reason: string;
    expiresAt?: string | null;
  },
  meta: { requestId: string; ip: string | null; userAgent: string | null },
): Promise<void> {
  const [permission] = await getDb().execute<{ key: string }>(sql`
    select key from wms.permission where key = ${input.permission}
  `);
  if (!permission) throw new RoleError("VALIDATION_FAILED", "No such permission");

  if (input.effect === "ALLOW") {
    const scope = input.scope ?? "";
    if (!(SCOPES as readonly string[]).includes(scope)) {
      throw new RoleError("VALIDATION_FAILED", "Choose how wide the allowance goes", {
        scope: "Required",
      });
    }
    const allowed = mayGrant(actor, input.permission, scope);
    if (allowed !== true) throw new RoleError("FORBIDDEN", allowed.reason);
  }

  if (input.effect === "DENY") {
    // Denying something they do not have is a no-op that will confuse
    // whoever reads the list later.
    const [held] = await getDb().execute<{ scope: string }>(sql`
      select scope::text as scope from wms.user_effective_permission
       where user_id = ${userId} and permission = ${input.permission}
    `);
    if (!held) {
      throw new RoleError(
        "VALIDATION_FAILED",
        "That account does not have that permission, so there is nothing to take away.",
      );
    }
  }

  await getDb().execute(sql`
    insert into wms.permission_override
      (user_id, permission, effect, scope, reason, expires_at, granted_by)
    values (${userId}, ${input.permission}, ${input.effect},
            ${input.effect === "ALLOW" ? sql`${input.scope}::wms.access_scope` : sql`null`},
            ${input.reason.trim()},
            ${input.expiresAt ? sql`${input.expiresAt}::date + interval '1 day'` : sql`null`},
            ${actor.session.userId})
    on conflict (user_id, permission) where revoked_at is null
    do update set effect = excluded.effect,
                  scope = excluded.scope,
                  reason = excluded.reason,
                  expires_at = excluded.expires_at,
                  granted_by = excluded.granted_by
  `);

  await invalidateUsers([userId]);

  await auditQuietly({
    action: `permission.${input.effect.toLowerCase()}`,
    operation: "INSERT",
    entityType: "permission_override",
    entityId: String(userId),
    entityLabel: `${input.permission} ${input.effect}`,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    reason: input.reason,
    after: { userId, ...input },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
}

/** Lift an exception. The row stays, revoked, so the history reads. */
export async function liftOverride(
  actor: Actor,
  userId: number,
  overrideId: number,
  meta: { requestId: string; ip: string | null; userAgent: string | null },
): Promise<void> {
  const rows = await getDb().execute<{ permission: string; effect: string }>(sql`
    update wms.permission_override
       set revoked_at = now()
     where id = ${overrideId} and user_id = ${userId} and revoked_at is null
    returning permission, effect
  `);
  if (rows.length === 0) throw new RoleError("NOT_FOUND", "That exception is not active");

  await invalidateUsers([userId]);

  await auditQuietly({
    action: "permission.override_lifted",
    operation: "UPDATE",
    entityType: "permission_override",
    entityId: String(overrideId),
    entityLabel: `${rows[0]!.permission} ${rows[0]!.effect}`,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    reason: "Lifted from the user screen",
    before: rows[0],
    after: { revoked: true },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
}

export { scopeRank };
