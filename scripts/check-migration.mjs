#!/usr/bin/env node
/**
 * Refuse to let an unreviewed index migration through.
 *
 * drizzle-kit's CREATE INDEX emitter loses information this schema
 * depends on. All four of these were observed on THIS database, not
 * imagined:
 *
 *   NULLS NOT DISTINCT   dropped from user_role_assignment_uk. Without
 *                        it a user can be given SUPER_ADMIN twice —
 *                        warehouse_id and importer_id are both NULL for
 *                        a platform role, and NULLs compare as distinct.
 *   DESC                 dropped from notification_feed_idx, whose only
 *                        job is to serve "newest first".
 *   INCLUDE              users_login_idx and ura_user_active_idx are
 *                        covering indexes; they are read back as plain
 *                        multi-column btrees, so a regenerate turns an
 *                        index-only scan into a heap fetch per row.
 *   operator classes     shuffled between columns on multi-column
 *                        indexes; two pulls of the same unchanged
 *                        database disagreed. A shuffled opclass does not
 *                        even run.
 *
 * So indexes are owned by ../sql/10_indexes.sql, and Drizzle owns
 * tables, columns, enums, foreign keys and constraints. This script is
 * the fence between the two: it fails the build if `drizzle-kit
 * generate` produced index DDL, and tells you to move the change to the
 * SQL pack.
 *
 * Reviewed exceptions are recorded by adding the migration's tag to
 * REVIEWED below, with a note on what was hand-corrected.
 */
import { readFileSync, readdirSync } from "node:fs";

/** Migrations whose index DDL has been read line by line and corrected. */
const REVIEWED = new Set([
  // Restores gin_trgm_ops on the users_name_trgm expression index, which
  // the pull dropped. Verified: the index oid and definition are
  // unchanged after running it.
  "0001_last_prowler",
  // Restored NULLS NOT DISTINCT (×2) and DESC NULLS FIRST (×1); proved a
  // byte-identical no-op against a database rebuilt from the SQL pack.
  "0002_freezing_doorman",
]);

const DIR = "./drizzle";
const INDEX_DDL = /^\s*(CREATE\s+(UNIQUE\s+)?INDEX|DROP\s+INDEX|ALTER\s+INDEX)\b/im;

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const offenders = [];

for (const f of files) {
  const tag = f.replace(/\.sql$/, "");
  if (REVIEWED.has(tag)) continue;
  const body = readFileSync(`${DIR}/${f}`, "utf8");
  // drizzle-kit comments out the whole introspected baseline.
  if (body.includes("Current sql file was generated after introspecting")) continue;
  const hits = body
    .split("-->")
    .map((s) => s.trim())
    .filter((s) => INDEX_DDL.test(s));
  if (hits.length) offenders.push({ tag, hits });
}

if (offenders.length === 0) {
  console.log(`✓ no unreviewed index DDL in ${files.length} migration(s)`);
  process.exit(0);
}

console.error("\n✗ generated migration touches indexes, which Drizzle does not");
console.error("  round-trip correctly on this schema.\n");
for (const { tag, hits } of offenders) {
  console.error(`  ${tag}.sql`);
  for (const h of hits) console.error(`    ${h.split("\n")[0].slice(0, 110)}`);
}
console.error(`
  Do one of these:

  1. The index change belongs in ../sql/10_indexes.sql. Make it there,
     apply it, then re-run \`npm run db:pull\` so Drizzle picks it up and
     this migration disappears.

  2. You genuinely need it here: read every line against
     \`select indexdef from pg_indexes\`, restore whatever was dropped
     (NULLS NOT DISTINCT / DESC / INCLUDE / opclasses), then add the tag
     to REVIEWED in scripts/check-migration.mjs with a note.
`);
process.exit(1);
