import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

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

// Next's dev server re-evaluates modules on every edit. Without a global
// the pool is recreated on each hot reload until the pooler stops
// accepting new connections.
const globalForDb = globalThis as unknown as {
  __wmsSql?: Client;
  __wmsDb?: PostgresJsDatabase;
};

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
  });
}

export function getSql(): Client {
  const client = globalForDb.__wmsSql ?? createClient();
  if (process.env.NODE_ENV !== "production") globalForDb.__wmsSql = client;
  return client;
}

export function getDb(): PostgresJsDatabase {
  const instance = globalForDb.__wmsDb ?? drizzle(getSql());
  if (process.env.NODE_ENV !== "production") globalForDb.__wmsDb = instance;
  return instance;
}
