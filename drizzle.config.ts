import { config } from "dotenv";
config({ path: [".env.local", ".env"] });
import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration.
 *
 * `schema.ts` is the source of truth for the database. The SQL pack in
 * ../sql built the baseline once; from here every change is made in
 * TypeScript and `drizzle-kit generate` writes the migration.
 *
 * The check that the two views agree is a generated migration that comes
 * out EMPTY. Nothing else proves it.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",

  // Everything lives in `wms`. Without this filter, drizzle-kit sees
  // Supabase's own schemas (auth, storage, realtime) and offers to drop
  // them — which is exactly the migration nobody wants to run.
  schemaFilter: ["wms"],

  // audit_log is RANGE-partitioned and its partitions are created by
  // ensure_audit_partition() on a schedule. drizzle-kit introspects each
  // partition as an independent table and then emits ALTERs against
  // inherited columns, which Postgres rejects outright. They are excluded
  // so Drizzle manages the parent and Postgres manages the children.
  tablesFilter: ["*", "!audit_log_2*", "!audit_log_default"],

  dbCredentials: {
    // DIRECT_URL, not DATABASE_URL. DDL through the transaction pooler is
    // how you get a half-applied schema: the pooler cannot hold the
    // advisory lock drizzle-kit takes for the migration table.
    url: process.env.DIRECT_URL!,
  },

  // Drizzle's own bookkeeping table goes in wms, not in a new `drizzle`
  // schema. The target project is shared with four other applications;
  // this pack creates exactly one schema and everything lives in it, so
  // `drop schema wms cascade` leaves nothing behind.
  migrations: {
    table: "__drizzle_migrations",
    schema: "wms",
  },

  // Extensions are shared and live outside wms; never let a diff try to
  // create or drop them.
  extensionsFilters: ["postgis"],
  verbose: true,
  strict: true,
});
