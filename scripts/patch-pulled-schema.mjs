#!/usr/bin/env node
/**
 * Post-process `drizzle-kit pull` output into src/db/schema.ts.
 *
 * drizzle-kit cannot round-trip five things this database uses. Each one
 * is a deliberate choice, not an accident, so the fix is to teach Drizzle
 * about them rather than to give them up:
 *
 *   1. citext, ltree and the six wms.* domains come back as
 *      `unknown(...)` with a TODO comment. Replaced with the customType
 *      wrappers in src/db/types.ts.
 *   2. enum ARRAY columns come back as `unknown(...).array()`, which
 *      generates `type[][]`. Replaced with a single typed array wrapper.
 *   3. identity columns carry `maxValue: 9223372036854775807`, which is
 *      larger than Number.MAX_SAFE_INTEGER and round-trips as
 *      ...776000 — a permanent phantom diff. The bounds are the Postgres
 *      defaults for bigint, so dropping them changes nothing real.
 *   4. an expression index loses its operator class. Without
 *      gin_trgm_ops, generate wants to drop and recreate it forever.
 *   5. multi-column indexes get their operator classes SHUFFLED. Two
 *      pulls of the same unchanged database produced
 *      `("kyc_status" timestamptz_ops, "created_at" text_ops)` and
 *      `(text_ops, text_ops)` for the same index — neither correct. That
 *      name is emitted into the migration SQL, so a shuffled one is not
 *      cosmetic: `CREATE INDEX ... USING btree ("kyc_status"
 *      timestamptz_ops)` fails outright. They are re-read from
 *      pg_opclass and rewritten in catalogue order, which is also what
 *      makes a re-pull reproducible.
 *
 * Run: `npm run db:pull` (pull + this script + cleanup).
 * The proof it worked is a `drizzle-kit generate` that produces an EMPTY
 * migration, twice in a row.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: [".env.local", ".env"] });

const SRC = "drizzle/schema.ts";
const OUT = "src/db/schema.ts";

let s = readFileSync(SRC, "utf8");
const counts = { scalar: 0, array: 0, identity: 0, opclass: 0, opFixed: 0 };

// ── 1 + 2. unknown() columns ────────────────────────────────────────
const SCALAR = {
  citext: "citext",
  ltree: "ltree",
  "wms.mobile_in": "mobileIn",
  "wms.gstin": "gstin",
  "wms.pan_no": "panNo",
  "wms.pincode_in": "pincodeIn",
  "wms.vehicle_reg": "vehicleReg",
};
const ARRAY = {
  "wms.role_key[]": "roleKeyArray",
  "wms.notif_channel[]": "notifChannelArray",
};

const used = new Set();

s = s.replace(
  /[ \t]*\/\/ TODO: failed to parse database type '([^']+)'\n([ \t]*)(\w+): unknown\(("(?:[^"]*)")\)(\.array\(\))?/g,
  (whole, pgType, indent, prop, name, arraySuffix) => {
    const helper = ARRAY[pgType] ?? SCALAR[pgType];
    if (!helper) {
      throw new Error(
        `No customType mapping for '${pgType}'. Add one to src/db/types.ts ` +
          `and to this script — silently leaving it as unknown() would ` +
          `produce a schema that does not match the database.`,
      );
    }
    if (ARRAY[pgType]) {
      // The wrapper already declares the [] in its SQL name, so the
      // trailing .array() has to go or Drizzle emits type[][].
      counts.array++;
    } else {
      if (arraySuffix) {
        throw new Error(`'${pgType}' arrived as an array but is mapped as scalar`);
      }
      counts.scalar++;
    }
    used.add(helper);
    return `${indent}${prop}: ${helper}(${name})`;
  },
);

const stillUnknown = s.match(/unknown\(/g);
if (stillUnknown) {
  throw new Error(`${stillUnknown.length} unknown() column(s) left unmapped`);
}

// ── 3. identity bounds ──────────────────────────────────────────────
s = s.replace(
  /, minValue: 1, maxValue: 9223372036854775807, cache: 1/g,
  () => (counts.identity++, ""),
);

// ── 4. trigram expression index ─────────────────────────────────────
// Postgres stores the opclass; the pull drops it for expression columns.
s = s.replace(
  /(index\("users_name_trgm"\)\.using\("gin", sql`\(\(\(first_name \|\| ' '::text\) \|\| last_name\)\))(`)/,
  (_m, head, tail) => (counts.opclass++, `${head} gin_trgm_ops${tail}`),
);

// ── 5. operator classes, from the catalogue ─────────────────────────
const url = process.env.DIRECT_URL;
if (!url) throw new Error("DIRECT_URL is not set — the opclasses are read from the database");

const sqlc = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
let truth;
try {
  // indkey = 0 marks an expression column; drizzle emits those as a raw
  // sql`` fragment with no .op(), so they are skipped rather than
  // consuming a position in the rewrite below.
  truth = await sqlc`
    select ic.relname as index_name,
           x.ord,
           i.indkey[x.ord - 1] = 0 as is_expression,
           oc.opcname
      from pg_index i
      join pg_class ic on ic.oid = i.indexrelid
      join pg_namespace n on n.oid = ic.relnamespace
      join lateral unnest(i.indclass::oid[]) with ordinality x(oid, ord) on true
      join pg_opclass oc on oc.oid = x.oid
     where n.nspname = 'wms'
     order by ic.relname, x.ord`;
} finally {
  await sqlc.end();
}

const byIndex = new Map();
for (const row of truth) {
  if (row.is_expression) continue;
  if (!byIndex.has(row.index_name)) byIndex.set(row.index_name, []);
  byIndex.get(row.index_name).push(row.opcname);
}

s = s
  .split("\n")
  .map((line) => {
    const m = line.match(/^\s*(?:unique)?[iI]ndex\("([^"]+)"\)/);
    if (!m) return line;
    const want = byIndex.get(m[1]);
    if (!want) return line; // partition indexes etc. — filtered out of the pull
    let i = 0;
    return line.replace(/\.op\("([^"]+)"\)/g, (whole, had) => {
      const correct = want[i++];
      if (correct === undefined) return whole;
      if (correct !== had) counts.opFixed++;
      return `.op("${correct}")`;
    });
  })
  .join("\n");

// ── imports ─────────────────────────────────────────────────────────
const names = [...used].sort().join(", ");
s = s.replace(
  /^(import { sql } from "drizzle-orm".*)$/m,
  `$1\nimport { ${names} } from "./types"`,
);
if (!s.includes(`from "./types"`)) {
  throw new Error("could not find the drizzle-orm import line to anchor to");
}

const header = `// GENERATED by \`npm run db:pull\` (drizzle-kit pull +
// scripts/patch-pulled-schema.mjs). Table ORDER in this file is not
// stable across pulls — diff it by content, not by line number.
`;

writeFileSync(OUT, header + s);
console.log(
  `patched → ${OUT}\n` +
    `  ${counts.scalar} domain/citext/ltree columns\n` +
    `  ${counts.array} enum-array columns\n` +
    `  ${counts.identity} identity bound sets stripped\n` +
    `  ${counts.opclass} expression-index opclass restored\n` +
    `  ${counts.opFixed} shuffled operator class(es) corrected\n` +
    `  helpers used: ${names}`,
);
