#!/usr/bin/env node
/**
 * Mark migrations as already applied WITHOUT running them.
 *
 * Why this exists
 * ---------------
 * The database was built by the SQL pack in ../sql, not by Drizzle. That
 * pack creates things drizzle-kit cannot express at all — extensions,
 * domains, plpgsql functions, triggers, the RANGE-partitioned audit_log,
 * the user_effective_permission view. `drizzle-kit pull` then recorded
 * the parts it CAN see as migration 0000, so Drizzle has a snapshot to
 * diff future changes against.
 *
 * Running that 0000 would therefore be wrong twice over: every object in
 * it already exists, and it is not a complete description of the schema
 * anyway. What Drizzle needs is simply to be told the baseline is done.
 *
 * Hashes are computed by drizzle-orm's own readMigrationFiles, not
 * reimplemented here — if their hashing ever changes, this script changes
 * with it instead of silently disagreeing.
 *
 * Usage:
 *   node scripts/mark-baseline-applied.mjs            # dry run
 *   node scripts/mark-baseline-applied.mjs --apply
 *
 * Run it ONCE, against a database the SQL pack has already built. Every
 * migration generated after this point is applied normally with
 * `drizzle-kit migrate`.
 */
import { config as loadEnv } from "dotenv";
import postgres from "postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";

loadEnv({ path: [".env.local", ".env"] });

const APPLY = process.argv.includes("--apply");
const url = process.env.DIRECT_URL;
if (!url) throw new Error("DIRECT_URL is not set (use the :5432 direct URL, not the pooler)");

const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
if (migrations.length === 0) throw new Error("no migrations found in ./drizzle");

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

try {
  // Schema must match `migrations.schema` in drizzle.config.ts — wms,
  // not the default `drizzle`, because the target project is shared.
  await sql`CREATE SCHEMA IF NOT EXISTS "wms"`;
  await sql`
    CREATE TABLE IF NOT EXISTS "wms"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )`;

  const existing = await sql`SELECT hash FROM "wms"."__drizzle_migrations"`;
  const known = new Set(existing.map((r) => r.hash));
  const pending = migrations.filter((m) => !known.has(m.hash));

  if (pending.length === 0) {
    console.log(`nothing to do — all ${migrations.length} migration(s) already recorded`);
  } else if (!APPLY) {
    console.log("DRY RUN. Would record as applied (without executing them):");
    for (const m of pending) console.log(`  ${m.hash.slice(0, 12)}  when=${m.folderMillis}`);
    console.log("\nRe-run with --apply to write these rows.");
  } else {
    // One transaction: either the baseline is recorded or it is not.
    await sql.begin(async (tx) => {
      for (const m of pending) {
        await tx`INSERT INTO "wms"."__drizzle_migrations" (hash, created_at)
                 VALUES (${m.hash}, ${m.folderMillis})`;
      }
    });
    console.log(`recorded ${pending.length} migration(s) as applied`);
  }
} finally {
  await sql.end();
}
