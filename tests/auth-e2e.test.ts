import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";

import { testDb } from "./db";

/**
 * The auth endpoints, end to end, against a running Next server and a
 * real PostgreSQL.
 *
 * Not unit tests of the handlers. The things worth proving here only
 * exist once the whole stack is assembled: that the cookie comes back
 * httpOnly, that a wrong password and an unknown account are
 * indistinguishable from outside, that the audit row lands in the same
 * request, that a reset actually kills the other sessions.
 *
 * Requires E2E_BASE_URL (a `next start` on the same database) and
 * TEST_DATABASE_URL.
 */
const BASE = process.env.E2E_BASE_URL;
const DB = process.env.TEST_DATABASE_URL;
const describeE2E = BASE && DB ? describe : describe.skip;

if (!BASE || !DB) {
  console.warn("\n  auth-e2e.test.ts SKIPPED: needs E2E_BASE_URL and TEST_DATABASE_URL.\n");
}

const EMAIL = "e2e-user@smoke.invalid";
const MOBILE = "9800000097";
const PASSWORD = "first-password-9021";

type Json = Record<string, any>;

async function call(
  path: string,
  init: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<{ status: number; json: Json; headers: Headers; ms: number }> {
  const started = Date.now();
  const response = await fetch(`${BASE}${path}`, {
    method: init.method ?? "POST",
    headers: {
      "content-type": "application/json",
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    redirect: "manual",
  });
  const text = await response.text();
  let json: Json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json, headers: response.headers, ms: Date.now() - started };
}

describeE2E("auth endpoints", () => {
  let sql: postgres.Sql;

  const codesFor = async (userId: number, channel: "EMAIL" | "SMS") => {
    // The plaintext is never stored, so the test reads it back out of the
    // suppressed provider payload — the same place a developer would.
    const rows = await sql`
      select d.provider_response
        from wms.notification_delivery d
        join wms.notification n on n.id = d.notification_id
       where n.recipient_user_id = ${userId}
         and d.channel = ${channel}::wms.notif_channel
       order by d.id desc limit 1`;
    const payload = rows[0]?.provider_response as { wouldSend?: string } | null;
    return /\b(\d{6})\b/.exec(payload?.wouldSend ?? "")?.[1];
  };

  const cleanup = async () => {
    await sql`delete from wms.users where email in (${EMAIL}, 'e2e-other@smoke.invalid')`;
  };

  beforeAll(async () => {
    sql = testDb(DB!);
    await cleanup();
  });

  afterAll(async () => {
    if (!sql) return;
    await cleanup();
    await sql.end();
  });

  it("rejects a malformed body with field-keyed messages", async () => {
    const r = await call("/api/v1/auth/register", {
      body: { firstName: "A", lastName: "Test", email: "nope", mobile: "12", password: "short",
              companyName: "X" },
    });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("VALIDATION_FAILED");
    // Keyed by field so the form can render each message in place.
    expect(Object.keys(r.json.error.fields).sort()).toEqual(
      ["companyName", "email", "firstName", "mobile", "password"],
    );
    expect(r.json.error.requestId).toBeTruthy();
  });

  it("registers, and answers the same way for a duplicate", async () => {
    const body = {
      firstName: "Ejay", lastName: "Tester", companyName: "E2E Imports",
      email: EMAIL, mobile: MOBILE, password: PASSWORD,
    };

    const first = await call("/api/v1/auth/register", { body });
    expect(first.status).toBe(201);
    expect(first.json.verificationRequired).toBe(true);
    expect(first.json.channels.sort()).toEqual(["EMAIL", "SMS"]);
    const userId = first.json.userId;
    expect(userId).toBeGreaterThan(0);

    // The account is PENDING and holds no role: IMPORTER is immutable,
    // so it must not be attached before verification.
    const [row] = await sql`
      select status::text, signup_company_name,
             (select count(*)::int from wms.user_role_assignment where user_id = ${userId}) as roles
        from wms.users where id = ${userId}`;
    expect(row.status).toBe("PENDING");
    expect(row.signup_company_name).toBe("E2E Imports");
    expect(row.roles).toBe(0);

    const second = await call("/api/v1/auth/register", { body });
    expect(second.status).toBe(201);
    expect(second.json.verificationRequired).toBe(true);
    // Still one user, and the duplicate did not say so.
    const [{ count }] = await sql`
      select count(*)::int from wms.users where email = ${EMAIL}`;
    expect(count).toBe(1);
  }, 30_000);

  it("issues a different code per channel", async () => {
    const [user] = await sql`select id from wms.users where email = ${EMAIL}`;
    const emailCode = await codesFor(user.id, "EMAIL");
    const smsCode = await codesFor(user.id, "SMS");

    expect(emailCode).toMatch(/^\d{6}$/);
    expect(smsCode).toMatch(/^\d{6}$/);
    // Same code on both channels would make the second channel theatre.
    expect(emailCode).not.toBe(smsCode);
  });

  it("refuses sign-in until the account is verified", async () => {
    const r = await call("/api/v1/auth/login", {
      body: { identifier: EMAIL, password: PASSWORD },
    });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("ACCOUNT_INACTIVE");
  }, 15_000);

  it("verifies both codes and activates the account", async () => {
    const [user] = await sql`select id from wms.users where email = ${EMAIL}`;
    const emailCode = await codesFor(user.id, "EMAIL");
    const smsCode = await codesFor(user.id, "SMS");

    const r = await call("/api/v1/auth/otp/verify", {
      body: { purpose: "registration", identifier: EMAIL, emailCode, smsCode },
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ emailVerified: true, mobileVerified: true, complete: true });

    const [row] = await sql`select status::text from wms.users where id = ${user.id}`;
    expect(row.status).toBe("ACTIVE");

    // Replay must fail: the codes were consumed.
    const replay = await call("/api/v1/auth/otp/verify", {
      body: { purpose: "registration", identifier: EMAIL, emailCode, smsCode },
    });
    expect(replay.status).toBe(400);
  }, 20_000);

  it("signs in and sets an httpOnly session cookie", async () => {
    const r = await call("/api/v1/auth/login", {
      body: { identifier: EMAIL, password: PASSWORD, platform: "WEB", deviceName: "vitest" },
    });
    expect(r.status).toBe(200);
    expect(r.json.user.email).toBe(EMAIL);

    const setCookie = r.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("wms_session=");
    // Readable by script would make every XSS a session takeover.
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    // Never widened to sibling hosts.
    expect(setCookie.toLowerCase()).not.toContain("domain=");
  }, 15_000);

  it("accepts the mobile number as the identifier too", async () => {
    const r = await call("/api/v1/auth/login", {
      body: { identifier: MOBILE, password: PASSWORD },
    });
    expect(r.status).toBe(200);
  }, 15_000);

  /**
   * The enumeration test. A wrong password on a real account and a login
   * for an address that does not exist must be indistinguishable — same
   * code, same message, and no usable timing gap.
   */
  it("cannot be used to discover which addresses are registered", async () => {
    const real = await call("/api/v1/auth/login", {
      body: { identifier: EMAIL, password: "definitely-not-the-password" },
    });
    const ghost = await call("/api/v1/auth/login", {
      body: { identifier: "no-such-person@smoke.invalid", password: "definitely-not-it" },
    });

    expect(real.status).toBe(ghost.status);
    expect(real.json.error.code).toBe(ghost.json.error.code);
    expect(real.json.error.message).toBe(ghost.json.error.message);

    // Both padded to the same floor; the gap must be noise, not signal.
    const gap = Math.abs(real.ms - ghost.ms);
    expect(gap).toBeLessThan(250);
  }, 20_000);

  it("answers forgot-password identically for a stranger", async () => {
    const known = await call("/api/v1/auth/password/forgot", { body: { identifier: EMAIL } });
    const unknown = await call("/api/v1/auth/password/forgot", {
      body: { identifier: "nobody@smoke.invalid" },
    });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.json).toEqual(unknown.json);
    expect(Math.abs(known.ms - unknown.ms)).toBeLessThan(400);
  }, 25_000);

  it("resets the password and kills every other session", async () => {
    const [user] = await sql`select id from wms.users where email = ${EMAIL}`;

    // Two extra sessions to be revoked.
    const a = await call("/api/v1/auth/login", { body: { identifier: EMAIL, password: PASSWORD } });
    const b = await call("/api/v1/auth/login", { body: { identifier: EMAIL, password: PASSWORD } });
    const cookieA = (a.headers.get("set-cookie") ?? "").split(";")[0];
    expect(b.status).toBe(200);

    await call("/api/v1/auth/password/forgot", { body: { identifier: EMAIL } });
    const emailCode = await codesFor(user.id, "EMAIL");
    const smsCode = await codesFor(user.id, "SMS");

    const verified = await call("/api/v1/auth/otp/verify", {
      body: { purpose: "passwordRecovery", identifier: EMAIL, emailCode, smsCode },
    });
    expect(verified.status).toBe(200);
    expect(verified.json.resetToken).toBeTruthy();

    const NEW_PASSWORD = "second-password-4417";
    const reset = await call("/api/v1/auth/password/reset", {
      body: { resetToken: verified.json.resetToken, newPassword: NEW_PASSWORD },
    });
    expect(reset.status).toBe(200);
    expect(reset.json.sessionsRevoked).toBeGreaterThanOrEqual(2);

    // The old session is dead — the whole point of a reset.
    const stale = await call("/api/v1/auth/session", { method: "GET", cookie: cookieA });
    expect(stale.status).toBe(401);

    // The ticket is single use.
    const replay = await call("/api/v1/auth/password/reset", {
      body: { resetToken: verified.json.resetToken, newPassword: "third-password-9999" },
    });
    expect(replay.status).toBe(410);

    // Old password gone, new one works.
    expect((await call("/api/v1/auth/login", {
      body: { identifier: EMAIL, password: PASSWORD },
    })).status).toBe(401);
    const fresh = await call("/api/v1/auth/login", {
      body: { identifier: EMAIL, password: NEW_PASSWORD },
    });
    expect(fresh.status).toBe(200);
  }, 60_000);

  it("returns the user and permissions for a live session, 401 without one", async () => {
    const login = await call("/api/v1/auth/login", {
      body: { identifier: EMAIL, password: "second-password-4417" },
    });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

    const session = await call("/api/v1/auth/session", { method: "GET", cookie });
    expect(session.status).toBe(200);
    expect(session.json.user.email).toBe(EMAIL);
    expect(Array.isArray(session.json.permissions)).toBe(true);

    expect((await call("/api/v1/auth/session", { method: "GET" })).status).toBe(401);

    const out = await call("/api/v1/auth/logout", { cookie });
    expect(out.status).toBe(200);
    expect((await call("/api/v1/auth/session", { method: "GET", cookie })).status).toBe(401);

    // Logout must never fail, even for a token that is already dead.
    expect((await call("/api/v1/auth/logout", { cookie })).status).toBe(200);
  }, 30_000);

  /**
   * The audit trail is only useful if the DENIALS are in it. Successful
   * actions cannot tell you who was probing.
   */
  it("records both the successes and the denials", async () => {
    const rows = await sql`
      select action, operation::text, result::text, reason
        from wms.audit_log
       where entity_label = ${EMAIL} or entity_id = ${EMAIL}
       order by occurred_at`;

    const actions = new Set(rows.map((r) => r.action));
    expect(actions).toContain("auth.register");
    expect(actions).toContain("auth.login");
    expect(actions).toContain("auth.password.reset");
    expect(actions).toContain("auth.logout");

    const denied = rows.filter((r) => r.result === "DENIED");
    expect(denied.length).toBeGreaterThan(0);
    // The schema requires a reason on every denial; check it is a real
    // one and not a placeholder.
    for (const row of denied) expect(row.reason).toBeTruthy();
    expect(denied.map((r) => r.reason).join(" ")).toMatch(/wrong password|already registered/);

    // Nothing secret ever reaches the log.
    const dump = JSON.stringify(
      await sql`select * from wms.audit_log where entity_label = ${EMAIL}`,
    );
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain("second-password-4417");
  }, 20_000);
});
