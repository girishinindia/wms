#!/usr/bin/env node
/**
 * Print an argon2id hash for a password, using THIS environment's
 * settings and pepper.
 *
 * Why this exists rather than a hash baked into the SQL: every hash is
 * mixed with PASSWORD_PEPPER, which lives in .env and differs per
 * environment. A hash generated anywhere else — including by me — will
 * never verify against your database. It has to be produced on a machine
 * that has your pepper.
 *
 *   node scripts/hash-password.mjs 'the password'
 *
 * Nothing is written and nothing is logged; the hash goes to stdout so
 * it can be piped straight into psql -v.
 */
import { config } from "dotenv";
import { hash } from "@node-rs/argon2";

config({ path: [".env.local", ".env"] });

const password = process.argv[2];
if (!password) {
  console.error("usage: node scripts/hash-password.mjs '<password>'");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Refusing: use at least 8 characters.");
  process.exit(1);
}

const pepper = process.env.PASSWORD_PEPPER;
if (!pepper || pepper.trim().length < 32) {
  console.error(
    "PASSWORD_PEPPER is missing or too short in .env. A hash made without\n" +
      "the real pepper will not verify against your database.",
  );
  process.exit(1);
}

// Must match src/lib/auth/password.ts exactly, or the hash verifies
// nowhere. argon2id = 2, version 0x13 = 1.
process.stdout.write(
  (await hash(password, {
    algorithm: 2,
    version: 1,
    memoryCost: Number(process.env.ARGON2_MEMORY_KIB ?? 65536),
    timeCost: Number(process.env.ARGON2_TIME_COST ?? 3),
    parallelism: Number(process.env.ARGON2_PARALLELISM ?? 4),
    secret: Buffer.from(pepper, "utf8"),
  })) + "\n",
);
