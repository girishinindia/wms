import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { otpEnv } from "@/lib/env";

import { generateOtp, hashToken } from "./tokens";

/**
 * One-time codes, in `wms.user_verification_token`.
 *
 * Stored hashed and single-use. The three failure modes this guards
 * against, in the order they actually bite:
 *
 *   1. Replay — a code that still works after it was used. Solved by
 *      `consumed_at`, set in the same statement that validates it.
 *   2. Brute force — six digits is a million guesses, which is nothing
 *      at HTTP speed. Solved by `attempts`/`max_attempts` on the row,
 *      counted per token rather than per request.
 *   3. Disclosure — a support console showing the live code. Solved by
 *      storing only the SHA-256.
 */

export type OtpPurpose =
  | "EMAIL_VERIFY"
  | "MOBILE_VERIFY"
  | "PASSWORD_RESET"
  | "LOGIN_OTP"
  | "INVITE";

export type IssuedOtp = {
  /** The plaintext code. Hand it to the provider and then drop it. */
  code: string;
  tokenId: number;
  expiresAt: Date;
  ttlMinutes: number;
};

/**
 * Issue a code for one channel.
 *
 * Any live code for the same (user, purpose, channel) is consumed first.
 * Without that, "resend" leaves both codes valid and the number of
 * guesses an attacker gets grows with every resend — the opposite of
 * what a resend button should do.
 */
export async function issueOtp(params: {
  userId: number;
  purpose: OtpPurpose;
  channel: "EMAIL" | "SMS";
  /** Where it is being sent — recorded so an audit can show the address. */
  sentTo: string;
  ip?: string | null;
}): Promise<IssuedOtp> {
  const env = otpEnv();
  const code = generateOtp(env.OTP_LENGTH);
  const db = getDb();

  const rows = await db.execute<{ id: number; expires_at: string }>(sql`
    with superseded as (
      update wms.user_verification_token
         set consumed_at = now()
       where user_id = ${params.userId}
         and purpose = ${params.purpose}
         and channel = ${params.channel}
         and consumed_at is null
         and expires_at > now()
      returning id
    )
    insert into wms.user_verification_token
      (user_id, purpose, token_hash, sent_to, channel,
       max_attempts, expires_at, ip)
    values (
      ${params.userId}, ${params.purpose}, ${hashToken(code)},
      ${params.sentTo}, ${params.channel}, ${env.OTP_MAX_ATTEMPTS},
      now() + make_interval(secs => ${env.OTP_TTL_SECONDS}),
      ${params.ip ?? null}::inet
    )
    returning id, expires_at
  `);

  const row = rows[0];
  if (!row) throw new Error("Failed to issue a verification code");

  return {
    code,
    tokenId: row.id,
    expiresAt: new Date(row.expires_at),
    ttlMinutes: Math.round(env.OTP_TTL_SECONDS / 60),
  };
}

export type VerifyResult =
  | { ok: true; tokenId: number; userId: number }
  | {
      ok: false;
      reason: "NOT_FOUND" | "EXPIRED" | "CONSUMED" | "TOO_MANY_ATTEMPTS";
      attemptsLeft?: number;
    };

/**
 * Verify and consume, in one statement.
 *
 * A read-then-write would let two concurrent requests both see an
 * unconsumed row and both succeed — which is exactly the race an
 * attacker scripts once they know a code is close. The UPDATE below
 * matches on `consumed_at is null` and returns nothing if another
 * transaction got there first.
 *
 * The lookup is by `token_hash`, so a wrong code selects no row at all;
 * there is no candidate to compare against and therefore no comparison
 * to time.
 */
export async function verifyOtp(params: {
  userId: number;
  purpose: OtpPurpose;
  channel: "EMAIL" | "SMS";
  code: string;
}): Promise<VerifyResult> {
  const db = getDb();
  const tokenHash = hashToken(params.code);

  const consumed = await db.execute<{ id: number; user_id: number }>(sql`
    update wms.user_verification_token
       set consumed_at = now(), attempts = attempts + 1
     where token_hash = ${tokenHash}
       and user_id = ${params.userId}
       and purpose = ${params.purpose}
       and channel = ${params.channel}
       and consumed_at is null
       and expires_at > now()
       and attempts < max_attempts
    returning id, user_id
  `);

  if (consumed[0]) {
    return { ok: true, tokenId: consumed[0].id, userId: consumed[0].user_id };
  }

  // Nothing matched. Charge the attempt against the LIVE token for this
  // (user, purpose, channel) so a wrong guess costs the attacker one of
  // their tries — otherwise max_attempts only limits correct guesses,
  // which is not a limit at all.
  const remaining = await db.execute<{
    attempts: number;
    max_attempts: number;
    expired: boolean;
  }>(sql`
    update wms.user_verification_token t
       set attempts = t.attempts + 1
      from (
        select id from wms.user_verification_token
         where user_id = ${params.userId}
           and purpose = ${params.purpose}
           and channel = ${params.channel}
           and consumed_at is null
         order by created_at desc
         limit 1
      ) live
     where t.id = live.id
    returning t.attempts, t.max_attempts, (t.expires_at <= now()) as expired
  `);

  const row = remaining[0];
  if (!row) return { ok: false, reason: "NOT_FOUND" };
  if (row.expired) return { ok: false, reason: "EXPIRED" };
  if (row.attempts >= row.max_attempts) {
    return { ok: false, reason: "TOO_MANY_ATTEMPTS", attemptsLeft: 0 };
  }
  return {
    ok: false,
    reason: "NOT_FOUND",
    attemptsLeft: row.max_attempts - row.attempts,
  };
}

/** Revoke every live code for a user — used after a password change. */
export async function consumeAllOtps(userId: number, purpose?: OtpPurpose): Promise<void> {
  await getDb().execute(sql`
    update wms.user_verification_token
       set consumed_at = now()
     where user_id = ${userId}
       and consumed_at is null
       ${purpose ? sql`and purpose = ${purpose}` : sql``}
  `);
}

/**
 * How long until another code may be requested, in seconds. 0 means now.
 *
 * Enforced from the database rather than from Redis on purpose: the
 * cooldown must survive a Redis eviction, and the row that proves when
 * the last code went out is already being written.
 */
export async function resendCooldownRemaining(params: {
  userId: number;
  purpose: OtpPurpose;
  channel: "EMAIL" | "SMS";
}): Promise<number> {
  const env = otpEnv();
  const rows = await getDb().execute<{ wait: number }>(sql`
    select greatest(0, ceil(extract(epoch from (
             max(created_at) + make_interval(secs => ${env.OTP_RESEND_COOLDOWN_SECONDS}) - now()
           ))))::int as wait
      from wms.user_verification_token
     where user_id = ${params.userId}
       and purpose = ${params.purpose}
       and channel = ${params.channel}
  `);
  return rows[0]?.wait ?? 0;
}

/**
 * Verify SEVERAL codes as one unit: all correct, or none consumed.
 *
 * The reason this exists is a real failure found by driving the UI. With
 * per-channel verification, a user who typed the email code correctly
 * and fat-fingered one digit of the SMS code had their EMAIL code
 * consumed and marked verified — then sat in front of a form still
 * demanding an email code that no longer worked. One wrong digit, and
 * the only way out was a resend.
 *
 * So: match every submitted code first, and only consume if all of them
 * matched. A wrong guess still costs an attempt on the channel that was
 * wrong — the brute-force budget has to be spent, or `max_attempts`
 * limits nothing — but a correct code is never burned by someone else's
 * typo.
 *
 * The check-then-consume gap is safe: the consuming UPDATE still carries
 * `consumed_at is null`, so a concurrent request cannot double-verify.
 * The worst case is this call reporting a failure it did not cause,
 * which is the right way round.
 */
export async function verifyOtpPair(params: {
  userId: number;
  entries: Array<{ purpose: OtpPurpose; channel: "EMAIL" | "SMS"; code: string }>;
}): Promise<
  | { ok: true; verified: Array<"EMAIL" | "SMS"> }
  | {
      ok: false;
      failures: Array<{
        channel: "EMAIL" | "SMS";
        reason: "NOT_FOUND" | "EXPIRED" | "CONSUMED" | "TOO_MANY_ATTEMPTS";
      }>;
    }
> {
  const db = getDb();

  // 1. Does a live token match, for every channel submitted?
  const matches = await Promise.all(
    params.entries.map(async (entry) => {
      const rows = await db.execute<{ id: number }>(sql`
        select id from wms.user_verification_token
         where token_hash = ${hashToken(entry.code)}
           and user_id = ${params.userId}
           and purpose = ${entry.purpose}
           and channel = ${entry.channel}
           and consumed_at is null
           and expires_at > now()
           and attempts < max_attempts
         limit 1
      `);
      return { entry, tokenId: rows[0]?.id };
    }),
  );

  const missed = matches.filter((m) => m.tokenId === undefined);

  if (missed.length > 0) {
    // 2a. Charge an attempt only against the channels that were wrong,
    //     and report why for each.
    const failures = await Promise.all(
      missed.map(async ({ entry }) => {
        const result = await verifyOtp({
          userId: params.userId,
          purpose: entry.purpose,
          channel: entry.channel,
          code: entry.code,
        });
        return {
          channel: entry.channel,
          reason: result.ok ? ("NOT_FOUND" as const) : result.reason,
        };
      }),
    );
    return { ok: false, failures };
  }

  // 2b. All matched: consume them.
  const consumed = await db.execute<{ id: number }>(sql`
    update wms.user_verification_token
       set consumed_at = now(), attempts = attempts + 1
     where id in ${sql.raw(`(${matches.map((m) => m.tokenId).join(",")})`)}
       and consumed_at is null
    returning id
  `);

  if (consumed.length !== matches.length) {
    // Somebody else consumed one between the check and the update.
    return {
      ok: false,
      failures: [{ channel: params.entries[0].channel, reason: "CONSUMED" }],
    };
  }

  return { ok: true, verified: params.entries.map((e) => e.channel) };
}
