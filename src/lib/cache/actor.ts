import "server-only";

import { cacheEnv } from "@/lib/env";
import { hashToken } from "@/lib/auth/tokens";
import type { EffectivePermission, RoleBinding } from "@/lib/auth/account";
import type { ResolvedSession } from "@/lib/auth/session";

import { cacheDel, cacheGet, cacheSet, key, redis } from "./redis";

/**
 * The actor — session, roles, permissions — cached per session token.
 *
 * This is the hot path: every admin page and every API call resolved
 * three Postgres round trips before doing any work of its own, and with
 * a 3-connection pooler budget that queue is where "keeps processing"
 * came from. A hit here is one Redis read instead.
 *
 * Invalidation is by USER, not by key: the actor keys a user currently
 * has are recorded in a per-user set, and `invalidateUser` deletes them
 * all. Every place that changes what an actor may do — role assign or
 * revoke, status change, delete, password reset, logout, company
 * suspension — calls it, so a change takes effect on the very next
 * request. The TTL is only the backstop for a change made by hand in SQL.
 *
 * Security note: the cache key is the token's SHA-256, never the token;
 * a dump of Redis cannot be replayed as a cookie.
 */

export type CachedActor = {
  session: ResolvedSession;
  roles: RoleBinding[];
  permissions: EffectivePermission[];
  /** Unix ms, for diagnostics. */
  at: number;
};

const actorKey = (token: string) => key("actor", hashToken(token));
const userSetKey = (userId: number) => key("uactors", userId);

export async function getCachedActor(token: string): Promise<CachedActor | null> {
  return cacheGet<CachedActor>(actorKey(token));
}

export async function putCachedActor(token: string, actor: CachedActor): Promise<void> {
  const r = redis();
  if (!r) return;
  const ttl = cacheEnv().CACHE_ACTOR_TTL;
  const k = actorKey(token);
  try {
    await Promise.all([
      cacheSet(k, actor, ttl),
      r.sadd(userSetKey(actor.session.userId), k),
      // The set outlives the keys it names by a little, so a late
      // invalidation still finds them; it is tiny either way.
      r.expire(userSetKey(actor.session.userId), ttl * 4),
    ]);
  } catch {
    /* cache only */
  }
}

/** Drop one session's cached actor — logout. */
export async function dropCachedActor(token: string): Promise<void> {
  await cacheDel(actorKey(token));
}

/** Drop every cached actor of a user — anything that changes their rights. */
export async function invalidateUser(userId: number): Promise<void> {
  const r = redis();
  if (!r) return;
  try {
    const set = userSetKey(userId);
    const members = await r.smembers<string[]>(set);
    await cacheDel(...members, set);
  } catch {
    /* cache only */
  }
}

/** Several users at once — an importer's people when the company changes. */
export async function invalidateUsers(userIds: number[]): Promise<void> {
  await Promise.all([...new Set(userIds)].map((id) => invalidateUser(id)));
}
