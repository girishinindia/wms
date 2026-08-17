import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";

import { testDb } from "./db";

/**
 * OTP and session behaviour, against a real PostgreSQL running the wms
 * pack.
 *
 * These are the pieces where the guarantee lives in SQL — single-use via
 * `consumed_at`, attempt counting, the idle/absolute expiry pair, the
 * join to `users` that kills a suspended account's sessions. Mocking the
 * database would test my mental model of those statements rather than
 * the statements.
 */
const URL = process.env.TEST_DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

if (!URL) {
  console.warn("\n  auth-db.test.ts SKIPPED: set TEST_DATABASE_URL.\n");
}

describeDb("OTP and sessions", () => {
  let sql: postgres.Sql;
  let userId: number;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    process.env.DATABASE_SSL = "disable";
    sql = testDb(URL!);
    const [row] = await sql`
      insert into wms.users (email, first_name, last_name, mobile)
      values ('auth-test@smoke.invalid','Auth','Test','9800000098')
      returning id`;
    userId = row.id;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from wms.users where email = 'auth-test@smoke.invalid'`;
    await sql.end();
  });

  beforeEach(async () => {
    vi.resetModules();
    await sql`delete from wms.user_verification_token where user_id = ${userId}`;
    await sql`delete from wms.user_session where user_id = ${userId}`;
  });

  // ── OTP ─────────────────────────────────────────────────────────
  it("stores the code hashed, never in plaintext", async () => {
    const { issueOtp } = await import("@/lib/auth/otp");
    const { hashToken } = await import("@/lib/auth/tokens");

    const issued = await issueOtp({
      userId,
      purpose: "EMAIL_VERIFY",
      channel: "EMAIL",
      sentTo: "auth-test@smoke.invalid",
    });

    const [row] = await sql`
      select token_hash, sent_to, channel::text, attempts, max_attempts
        from wms.user_verification_token where id = ${issued.tokenId}`;

    expect(row.token_hash).toBe(hashToken(issued.code));
    // The plaintext must appear nowhere in the row.
    expect(JSON.stringify(row)).not.toContain(issued.code);
    expect(issued.code).toMatch(/^\d{6}$/);
  });

  it("accepts a code once and never again", async () => {
    const { issueOtp, verifyOtp } = await import("@/lib/auth/otp");
    const issued = await issueOtp({
      userId, purpose: "EMAIL_VERIFY", channel: "EMAIL", sentTo: "x@y.invalid",
    });
    const args = { userId, purpose: "EMAIL_VERIFY" as const, channel: "EMAIL" as const };

    expect((await verifyOtp({ ...args, code: issued.code })).ok).toBe(true);
    // The replay is the attack this guards against.
    expect((await verifyOtp({ ...args, code: issued.code })).ok).toBe(false);
  });

  it("charges a wrong guess against the attempt budget", async () => {
    const { issueOtp, verifyOtp } = await import("@/lib/auth/otp");
    const issued = await issueOtp({
      userId, purpose: "LOGIN_OTP", channel: "SMS", sentTo: "9800000098",
    });
    const args = { userId, purpose: "LOGIN_OTP" as const, channel: "SMS" as const };
    const wrong = issued.code === "000000" ? "111111" : "000000";

    // Five wrong guesses exhaust max_attempts...
    for (let i = 0; i < 5; i += 1) await verifyOtp({ ...args, code: wrong });

    // ...and now even the RIGHT code is refused. Without counting wrong
    // guesses, a six-digit code is a million free tries.
    const result = await verifyOtp({ ...args, code: issued.code });
    expect(result.ok).toBe(false);
    const [row] = await sql`
      select attempts, max_attempts from wms.user_verification_token
       where id = ${issued.tokenId}`;
    expect(row.attempts).toBeGreaterThanOrEqual(row.max_attempts);
  });

  it("invalidates the previous code when a new one is sent", async () => {
    const { issueOtp, verifyOtp } = await import("@/lib/auth/otp");
    const args = { userId, purpose: "EMAIL_VERIFY" as const, channel: "EMAIL" as const };

    const first = await issueOtp({ ...args, sentTo: "x@y.invalid" });
    const second = await issueOtp({ ...args, sentTo: "x@y.invalid" });

    // Leaving both live means every "resend" widens the attack surface.
    expect((await verifyOtp({ ...args, code: first.code })).ok).toBe(false);
    expect((await verifyOtp({ ...args, code: second.code })).ok).toBe(true);
  });

  it("refuses an expired code", async () => {
    const { issueOtp, verifyOtp } = await import("@/lib/auth/otp");
    const issued = await issueOtp({
      userId, purpose: "PASSWORD_RESET", channel: "EMAIL", sentTo: "x@y.invalid",
    });
    await sql`update wms.user_verification_token
                 set expires_at = now() - interval '1 second'
               where id = ${issued.tokenId}`;

    const result = await verifyOtp({
      userId, purpose: "PASSWORD_RESET", channel: "EMAIL", code: issued.code,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("EXPIRED");
  });

  it("keeps channels separate, so an emailed code is not an SMS code", async () => {
    const { issueOtp, verifyOtp } = await import("@/lib/auth/otp");
    const emailed = await issueOtp({
      userId, purpose: "LOGIN_OTP", channel: "EMAIL", sentTo: "x@y.invalid",
    });
    // The dual-OTP flow only means anything if the two codes are
    // independent — otherwise one channel is decorative.
    const asSms = await verifyOtp({
      userId, purpose: "LOGIN_OTP", channel: "SMS", code: emailed.code,
    });
    expect(asSms.ok).toBe(false);
  });

  it("reports a resend cooldown and then clears it", async () => {
    const { issueOtp, resendCooldownRemaining } = await import("@/lib/auth/otp");
    const args = { userId, purpose: "EMAIL_VERIFY" as const, channel: "EMAIL" as const };

    await issueOtp({ ...args, sentTo: "x@y.invalid" });
    expect(await resendCooldownRemaining(args)).toBeGreaterThan(0);

    await sql`update wms.user_verification_token
                 set created_at = now() - interval '10 minutes'
               where user_id = ${userId}`;
    expect(await resendCooldownRemaining(args)).toBe(0);
  });

  // ── Sessions ────────────────────────────────────────────────────
  it("stores the session token hashed", async () => {
    const { issueSession } = await import("@/lib/auth/session");
    const { hashToken } = await import("@/lib/auth/tokens");

    const issued = await issueSession(userId, { ip: "203.0.113.9", platform: "WEB" });
    const [row] = await sql`
      select token_hash, ip::text, platform from wms.user_session
       where id = ${issued.sessionId}`;

    expect(row.token_hash).toBe(hashToken(issued.token));
    expect(JSON.stringify(row)).not.toContain(issued.token);
    // inet renders with its mask; a bare host address is /32.
    expect(row.ip).toBe("203.0.113.9/32");
  });

  it("resolves a live session and touches last_seen_at", async () => {
    const { issueSession, resolveSession } = await import("@/lib/auth/session");
    const issued = await issueSession(userId);

    await sql`update wms.user_session set last_seen_at = now() - interval '1 hour'
               where id = ${issued.sessionId}`;
    const resolved = await resolveSession(issued.token);

    expect(resolved?.userId).toBe(userId);
    expect(resolved?.email).toBe("auth-test@smoke.invalid");
    const [row] = await sql`
      select (last_seen_at > now() - interval '5 seconds') as touched
        from wms.user_session where id = ${issued.sessionId}`;
    expect(row.touched).toBe(true);
  });

  it("rejects an unknown, revoked or absolutely-expired token", async () => {
    const { issueSession, resolveSession, revokeSession } = await import("@/lib/auth/session");

    expect(await resolveSession("not-a-real-token")).toBeNull();
    expect(await resolveSession(undefined)).toBeNull();

    const revoked = await issueSession(userId);
    await revokeSession(revoked.token);
    expect(await resolveSession(revoked.token)).toBeNull();

    const expired = await issueSession(userId);
    // `check (expires_at > issued_at)` means the row cannot be aged by
    // moving the deadline alone — issue time has to move with it. The
    // constraint refusing this is the schema doing its job.
    await sql`update wms.user_session
                 set issued_at  = now() - interval '31 days',
                     expires_at = now() - interval '1 second'
               where id = ${expired.sessionId}`;
    expect(await resolveSession(expired.token)).toBeNull();
  });

  it("expires a session left idle past the idle TTL", async () => {
    const { issueSession, resolveSession } = await import("@/lib/auth/session");
    const issued = await issueSession(userId);

    // Absolute deadline is 30 days away; only idleness should kill it.
    await sql`update wms.user_session set last_seen_at = now() - interval '8 days'
               where id = ${issued.sessionId}`;
    expect(await resolveSession(issued.token)).toBeNull();
  });

  /**
   * Deactivating a user has to take effect now, not at their next login.
   * Without the join to `users`, a suspended employee keeps working for
   * up to the absolute TTL.
   */
  it("kills every session the moment the account is suspended", async () => {
    const { issueSession, resolveSession } = await import("@/lib/auth/session");
    const issued = await issueSession(userId);
    expect(await resolveSession(issued.token)).not.toBeNull();

    await sql`update wms.users
                 set status = 'SUSPENDED', deactivation_reason = 'test'
               where id = ${userId}`;
    expect(await resolveSession(issued.token)).toBeNull();

    await sql`update wms.users set status = 'ACTIVE', deactivation_reason = null
               where id = ${userId}`;
  });

  it("revokes every session but the current one on a password reset", async () => {
    const { issueSession, resolveSession, revokeAllSessions } = await import(
      "@/lib/auth/session"
    );
    const a = await issueSession(userId);
    const b = await issueSession(userId);
    const current = await issueSession(userId);

    const killed = await revokeAllSessions(userId, "password reset", current.sessionId);

    expect(killed).toBe(2);
    expect(await resolveSession(a.token)).toBeNull();
    expect(await resolveSession(b.token)).toBeNull();
    // Keeping the current one is what stops a reset logging you out of
    // the tab you just reset from.
    expect(await resolveSession(current.token)).not.toBeNull();
  });

  it("keeps revoked sessions for a week as evidence, then prunes", async () => {
    const { issueSession, revokeSession, pruneSessions } = await import("@/lib/auth/session");
    const recent = await issueSession(userId);
    await revokeSession(recent.token, "logout");

    const old = await issueSession(userId);
    await revokeSession(old.token, "logout");
    await sql`update wms.user_session set revoked_at = now() - interval '8 days'
               where id = ${old.sessionId}`;

    await pruneSessions();
    const rows = await sql`select id from wms.user_session where user_id = ${userId}`;
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(recent.sessionId);
    expect(ids).not.toContain(old.sessionId);
  });
});
