import "server-only";

import { Redis } from "@upstash/redis";

import { cacheEnv } from "@/lib/env";

/**
 * Upstash Redis, as a cache and nothing more.
 *
 * Every helper here swallows failure: a missing env, a network blip or a
 * bad token turns into a cache miss, never into an error the request
 * sees. Postgres stays the source of truth; Redis only saves the round
 * trips. That is also why nothing is ever stored here that cannot be
 * rebuilt from the database in one query.
 *
 * One client per process (Upstash is HTTP; there is no connection to
 * pool), keys prefixed per environment so dev, staging and prod can share
 * one database without ever reading each other's rows.
 */

let client: Redis | null | undefined;

export function redis(): Redis | null {
  if (client !== undefined) return client;
  const env = cacheEnv();
  if (!env.CACHE_ENABLED || !env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    client = null;
    return client;
  }
  client = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
    // A cache that takes longer than the query it saves is worse than no
    // cache. Upstash answers in tens of ms; 1.5 s means something is wrong.
    retry: { retries: 1, backoff: () => 100 },
  });
  return client;
}

export function key(...parts: (string | number)[]): string {
  return `${cacheEnv().REDIS_KEY_PREFIX}${parts.join(":")}`;
}

/** Bounded wait: a slow cache must fall through, not stall the page. */
function withTimeout<T>(p: Promise<T>, ms = 1500): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
}

export async function cacheGet<T>(k: string): Promise<T | null> {
  const r = redis();
  if (!r) return null;
  const v = await withTimeout(r.get<T>(k));
  return (v ?? null) as T | null;
}

export async function cacheMGet<T>(keys: string[]): Promise<(T | null)[]> {
  const r = redis();
  if (!r || keys.length === 0) return keys.map(() => null);
  const v = await withTimeout(r.mget<(T | null)[]>(...keys));
  return v ?? keys.map(() => null);
}

export async function cacheSet(k: string, value: unknown, ttlSeconds: number): Promise<void> {
  const r = redis();
  if (!r) return;
  await withTimeout(r.set(k, value, { ex: Math.max(1, Math.floor(ttlSeconds)) }));
}

export async function cacheDel(...keys: string[]): Promise<void> {
  const r = redis();
  if (!r || keys.length === 0) return;
  await withTimeout(r.del(...keys));
}

/** Atomic counter, used for per-user versions. Returns the new value. */
export async function cacheIncr(k: string): Promise<number | null> {
  const r = redis();
  if (!r) return null;
  return withTimeout(r.incr(k));
}

/** Is the cache actually on? For health and for tests. */
export function cacheActive(): boolean {
  return redis() !== null;
}
