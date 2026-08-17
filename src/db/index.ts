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
   * `max` stays at 1 on serverless: every function instance is its own
   * process, so a larger pool per instance only burns pooler slots.
   */
  // Supabase always needs TLS. The only reason to turn it off is a
  // plaintext Postgres running on your own machine.
  const ssl = process.env.DATABASE_SSL === "disable" ? false : "require";

  return postgres(url, {
    max: Number(process.env.DATABASE_MAX_CONNECTIONS ?? 1),
    prepare: false,
    ssl,
    connect_timeout: 10,
    idle_timeout: 20,
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

export function getSql(): Client {
  sqlSingleton ??= globalForDb.__wmsSql ?? createClient();
  // Survive hot reload in dev; harmless in production, where the module
  // is evaluated once.
  globalForDb.__wmsSql = sqlSingleton;
  return sqlSingleton;
}

export function getDb(): Db {
  dbSingleton ??= globalForDb.__wmsDb ?? drizzle(getSql(), { schema: fullSchema });
  globalForDb.__wmsDb = dbSingleton;
  return dbSingleton;
}
