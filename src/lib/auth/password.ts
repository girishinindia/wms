import "server-only";

import { hash, verify } from "@node-rs/argon2";

import { authEnv } from "@/lib/env";

/**
 * Password hashing: argon2id, peppered.
 *
 * Why `@node-rs/argon2` and not the `argon2` package: the latter is a
 * node-gyp native addon that has to compile on the deploy target. It
 * does not build on Vercel's build image. This one ships prebuilt Rust
 * binaries and works on Vercel, on a Mac, and in CI without a toolchain.
 *
 * Why argon2id and not bcrypt: bcrypt caps the input at 72 bytes and
 * offers no memory hardness, so a GPU farm chews through it. argon2id is
 * the current OWASP recommendation and resists both GPU and side-channel
 * attacks.
 *
 * Why a pepper: the salt is stored next to the hash, so a dumped `users`
 * table is enough to start cracking offline. The pepper is not in the
 * database — it is in the environment — so that dump alone is useless.
 * Rotating it invalidates every password in the system, which is why it
 * is a deliberate act and not a routine one.
 */

/**
 * Cost parameters come from .env: 64 MiB, 3 passes, 4 lanes by default.
 * That is the OWASP second-choice profile and takes roughly 50-100ms on
 * a serverless instance — slow enough to matter to an attacker, fast
 * enough that a login does not feel slow.
 */
/**
 * `Algorithm.Argon2id` and `Version.V0x13` are ambient const enums, which
 * TypeScript refuses to read under `isolatedModules` — the setting Next
 * requires. Their numeric values are stable parts of the argon2 format
 * (id = 2, version 0x13 = 19, encoded as 1) and are asserted in the
 * tests against the `$argon2id$v=19$` prefix of a real hash, so a change
 * upstream fails loudly rather than silently downgrading the algorithm.
 */
const ARGON2ID = 2;
const VERSION_0x13 = 1;

function options() {
  const env = authEnv();
  return {
    algorithm: ARGON2ID,
    version: VERSION_0x13,
    memoryCost: env.ARGON2_MEMORY_KIB,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
    secret: Buffer.from(env.PASSWORD_PEPPER, "utf8"),
  };
}

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length === 0) throw new Error("Refusing to hash an empty password");
  return hash(plain, options());
}

/**
 * Verify, returning false rather than throwing on a malformed hash.
 *
 * A row whose `password_hash` is corrupt, truncated, or left over from
 * some other scheme must read as "wrong password", not as a 500. A 500
 * there is an oracle: it tells an attacker that the account exists and
 * that something about it is unusual.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  try {
    return await verify(stored, plain, options());
  } catch {
    return false;
  }
}

/**
 * Burn roughly the same CPU as a real verify, for accounts that do not
 * exist or have no password set.
 *
 * Without this, "unknown email" returns in under a millisecond while a
 * real account takes ~80ms, and that difference alone enumerates your
 * user base. The hash below is a fixed, valid argon2id encoding of a
 * value nobody can supply, so verify() does the full derivation and then
 * fails.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHRzYWx0c2FsdA$" +
  "RdescudvJCsgt3ub+b+dWRWJTmaaJObG";

export async function fakeVerify(): Promise<void> {
  try {
    await verify(DUMMY_HASH, "not-the-password", options());
  } catch {
    // Expected: the point is the elapsed time, not the answer.
  }
}

/**
 * True when a stored hash was made with weaker parameters than the
 * current settings — so it can be transparently upgraded on the next
 * successful login, while the plaintext is briefly in hand.
 *
 * Raising ARGON2_MEMORY_KIB is worth nothing if existing users keep
 * their old hashes forever.
 */
export function needsRehash(stored: string): boolean {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(stored);
  if (!m) return true; // unrecognised: rewrite it
  const env = authEnv();
  return (
    Number(m[1]) < env.ARGON2_MEMORY_KIB ||
    Number(m[2]) < env.ARGON2_TIME_COST ||
    Number(m[3]) < env.ARGON2_PARALLELISM
  );
}
