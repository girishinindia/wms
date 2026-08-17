import "server-only";

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Secret-token handling: generate, hash, compare.
 *
 * The rule this file exists to enforce is that **nothing secret is ever
 * stored in a readable form**. `user_session.token_hash` and
 * `user_verification_token.token_hash` both hold a SHA-256 digest, never
 * the value that was sent to the user.
 *
 * The reasoning is the same as for passwords: a leaked backup, a
 * mis-scoped read replica, or a support engineer with a SQL console
 * should not be able to take over a session or spend somebody's OTP.
 *
 * SHA-256 rather than argon2 here, and that is deliberate. A session
 * token is 32 bytes of CSPRNG output — there is nothing to brute-force,
 * so the slow-hash cost buys nothing and would be paid on every single
 * authenticated request. A password is low-entropy and human-chosen;
 * that is the case argon2 is for.
 */

/** 32 random bytes, url-safe. ~256 bits: not guessable, not enumerable. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * A numeric OTP of the configured length.
 *
 * `randomInt` and not `Math.random()`: the latter is seeded predictably
 * enough that an attacker who sees a few codes can compute the next one.
 * Codes are generated one digit at a time from a uniform source, which
 * also avoids the modulo bias you get from `randomBytes % 10^n`.
 */
export function generateOtp(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += String(randomInt(0, 10));
  return out;
}

/** What goes in the database. The caller keeps the plaintext only long
 *  enough to hand it to Brevo or SmsGatewayHub. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Compare two hex digests without leaking where they diverge.
 *
 * `a === b` on strings short-circuits at the first differing character,
 * and that timing difference is measurable across a network for a value
 * an attacker can submit repeatedly. `timingSafeEqual` compares every
 * byte regardless.
 *
 * The length check first is not a leak: both sides are fixed-length
 * SHA-256 digests, so a length mismatch means malformed input, not a
 * near-miss.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Look up a submitted token by its hash.
 *
 * Callers should query on `token_hash = hashToken(submitted)` rather
 * than fetching a candidate row and comparing in JavaScript — the
 * database does an index lookup on a value the attacker cannot control
 * the shape of, and there is no row to compare against if the token is
 * wrong. `safeEqual` is here for the paths where a row has already been
 * selected for another reason.
 */
export const TOKEN_HASH_LENGTH = 64;
