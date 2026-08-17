import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as relations from "./relations";
import * as schema from "./schema";

/**
 * Every table lives in the `wms` schema, and `pgSchema("wms")` makes
 * Drizzle emit `"wms"."users"` on every query. The connection's
 * search_path is therefore left alone deliberately: setting it as a
 * startup parameter is one more thing the transaction pooler has to
 * carry per backend connection, for no gain.
 *
 * The consequence: raw `sql` fragments must qualify their own names.
 * `sql`select * from wms.user_ancestors(${id})`` works; the same line
 * without the prefix will not.
 */
const fullSchema = { ...schema, ...relations };

/**
 * Drizzle client, shared by every server-side caller.
 *
 * `server-only` above is the guard: if this module is ever pulled into a
 * client component the build fails, instead of DATABASE_URL quietly
 * ending up in a browser bundle.
 *
 * Connecting is deferred to the first query rather than done at import.
 * `next build` imports every route module to read its config, so an
 * eager connection turns a missing env var into a failed build instead
 * of a 503 you can actually read.
 */

type Client = ReturnType<typeof postgres>;

type Db = PostgresJsDatabase<typeof fullSchema>;

/**
 * The pool is a module-level singleton, and in development it also hangs
 * off globalThis.
 *
 * Both parts matter, for different reasons:
 *
 *   - Module scope alone is not enough in DEV, because Next re-evaluates
 *     modules on every edit and each evaluation would open a new pool.
 *   - globalThis alone is not enough in PRODUCTION. An earlier version of
 *     this file assigned the global only when NODE_ENV !== "production",
 *     so `getSql()` built a brand-new postgres client on EVERY call once
 *     deployed. It surfaced as "sorry, too many clients already" under an
 *     end-to-end run — not at boot, and never in dev, which is exactly
 *     the kind of bug that reaches production.
 */
const globalForDb = globalThis as unknown as {
  __wmsSql?: Client;
  __wmsDb?: Db;
};

let sqlSingleton: Client | undefined;
let dbSingleton: Db | undefined;

/** How long a connection may sit unused before the driver closes it. */
const IDLE_SECONDS = 20;

/**
 * Anything unused for longer than the driver's own idle window is treated
 * as untrustworthy — see `getSql`. A little past IDLE_SECONDS, because a
 * healthy process would have closed the connection itself by then; if it
 * is still here, the process was not running.
 */
const STALE_MS = (IDLE_SECONDS + 5) * 1000;

/** When the pool was last handed to a caller. Frozen along with the rest
 *  of the process, which is the point: the gap it shows after a thaw is
 *  the length of the freeze. */
let lastTouched = 0;

function createClient(): Client {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Next.js reads .env.local and .env — it " +
        "does not read .env.example."
    );
  }

  /**
   * `prepare: false` is mandatory on the Supavisor transaction pooler.
   * Each statement can land on a different backend connection, so a
   * prepared statement created on one is missing on the next — which
   * surfaces later as a random "prepared statement does not exist".
   *
   * `max` was 1, on the reasoning that a serverless instance handles one
   * request at a time so a bigger pool only burns pooler slots. The first
   * half of that is true; the conclusion was not. A single request is not
   * a single query — Next renders the layout and the page CONCURRENTLY,
   * and each one authorises independently, so an admin screen opens with
   * several queries genuinely in flight at once. At `max: 1` they take
   * turns, and the tab sits there loading for as long as the queue is.
   *
   * Three is chosen to cover that fan-out and nothing more. It is not a
   * throughput knob: raise it and the cost lands on Supavisor's slots,
   * which are shared with everything else on this project.
   */
  // Supabase always needs TLS. The only reason to turn it off is a
  // plaintext Postgres running on your own machine.
  const ssl = process.env.DATABASE_SSL === "disable" ? false : "require";

  return postgres(url, {
    max: Number(process.env.DATABASE_MAX_CONNECTIONS ?? 3),
    prepare: false,
    ssl,
    connect_timeout: 10,
    idle_timeout: IDLE_SECONDS,
    /**
     * Retire every connection after five minutes regardless of use, so
     * nothing lives long enough to carry stale state between many
     * requests. Reconnecting through the pooler is ~50ms and rare.
     */
    max_lifetime: 5 * 60,
    /**
     * int8 (bigint) arrives as a STRING by default, because 2^63 does not
     * fit a JS number. Every primary key in this schema is
     * `bigint generated always as identity`, so without this every id in
     * every API response is a string — which contradicts the OpenAPI
     * document (`z.number().int()`) and makes `id === 5` quietly false.
     *
     * Parsed to a number, with a guard: identity columns start at 1 and
     * would need 9 quadrillion rows to reach MAX_SAFE_INTEGER, so the
     * throw is unreachable in practice and precise if it ever is not.
     */
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (value: number | bigint) => value.toString(),
        parse: (value: string) => {
          const n = Number(value);
          if (!Number.isSafeInteger(n)) {
            throw new Error(
              `bigint ${value} exceeds Number.MAX_SAFE_INTEGER; this column ` +
                `needs { mode: "bigint" } in schema.ts`,
            );
          }
          return n;
        },
      },
    },
  });
}

/**
 * Never hand out a connection that lived through a freeze.
 *
 * This is the fix for "I click a menu item and it keeps processing", and
 * it is worth being precise about, because the database's own log is
 * what pointed here. Seven times in one morning Postgres cancelled the
 * session lookup — a query that takes 0.1ms — after waiting the full
 * two-minute `statement_timeout`, each time in state `PARSE`: it had the
 * first half of the statement and never received the second. Nothing was
 * locked (`log_lock_waits` is on and logged nothing). The client had
 * simply stopped talking to it mid-statement.
 *
 * With `prepare: false` — mandatory on the pooler — the driver sends
 * every parameterised query in two steps: Parse+Describe, wait for the
 * server, then Bind+Execute. Between those steps a serverless instance
 * can be frozen (its request was abandoned because the user clicked the
 * next menu item; the platform paused the process) and the connection is
 * left dangling with the server waiting on it. When the instance thaws
 * for the next click, the pool hands that same connection out, the new
 * query queues behind the half-sent one, and the tab loads for as long
 * as it takes the server to give up — up to two minutes.
 *
 * The driver's own idle timer would have closed the connection, but the
 * timer was frozen too. So the check has to be on wall-clock time, which
 * survives a freeze because it is not ours: if the pool has not been
 * touched for longer than its idle window, the process was asleep, and
 * everything it was holding is thrown away and rebuilt. Costs one
 * ~50ms reconnect on the first query after a pause. Costs nothing on a
 * busy instance, where the gap never opens.
 *
 * `end()` on the old client waits for in-flight work up to its timeout
 * before destroying the sockets, so a request that raced the rotation
 * still completes; the reference it holds keeps its client alive.
 */
function rotateIfStale(): void {
  const now = Date.now();
  const stale = lastTouched !== 0 && now - lastTouched > STALE_MS;
  lastTouched = now;
  if (!stale) return;

  const old = sqlSingleton ?? globalForDb.__wmsSql;
  sqlSingleton = undefined;
  dbSingleton = undefined;
  globalForDb.__wmsSql = undefined;
  globalForDb.__wmsDb = undefined;

  if (old) {
    // Errors here are about the connection we have already stopped
    // trusting; nothing upstream can act on them.
    old.end({ timeout: 5 }).catch(() => undefined);
  }
}

export function getSql(): Client {
  rotateIfStale();
  sqlSingleton ??= globalForDb.__wmsSql ?? createClient();
  // Survive hot reload in dev; harmless in production, where the module
  // is evaluated once.
  globalForDb.__wmsSql = sqlSingleton;
  return sqlSingleton;
}

export function getDb(): Db {
  rotateIfStale();
  dbSingleton ??= globalForDb.__wmsDb ?? drizzle(getSql(), { schema: fullSchema });
  globalForDb.__wmsDb = dbSingleton;
  return dbSingleton;
}
