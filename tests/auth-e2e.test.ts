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

  /**
   * Teardown has to switch the immutability trigger off, and the fact
   * that it MUST is the point.
   *
   * `ura_protect_immutable` refuses to let an IMPORTER assignment be
   * deleted or changed by anyone — and it means it. A plain
   * `delete from wms.users` fails too, because the cascade reaches the
   * assignment and the trigger fires on that. Disabling a trigger needs
   * table-owner rights, which the application role does not have, so
   * this escape hatch exists for a test fixture and nowhere else.
   *
   * In production nothing takes this path: users are soft-deleted.
   */
  const cleanup = async () => {
    await sql`alter table wms.user_role_assignment disable trigger ura_protect_immutable`;
    try {
      await sql`
        delete from wms.user_role_assignment
         where user_id in (select id from wms.users where email = ${EMAIL}::citext)`;
      await sql`delete from wms.users where email in (${EMAIL}, 'e2e-other@smoke.invalid')`;
      await sql`delete from wms.importer where contact_email = ${EMAIL}::citext`;
    } finally {
      await sql`alter table wms.user_role_assignment enable trigger ura_protect_immutable`;
    }
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
      select status::text,
             (select count(*)::int from wms.user_role_assignment where user_id = ${userId}) as roles
        from wms.users where id = ${userId}`;
    expect(row.status).toBe("PENDING");
    expect(row.roles).toBe(0);

    // There is no company column on users — the name is on the importer.
    const columns = await sql`
      select column_name from information_schema.columns
       where table_schema = 'wms' and table_name = 'users'
         and column_name like '%company%'`;
    expect(columns).toHaveLength(0);

    // The importer row exists already, incomplete and PENDING.
    const [importer] = await sql`
      select code, company_name, status::text, kyc_status, origin,
             legal_name, entity_type, address, city_id, pincode
        from wms.importer where contact_email = ${EMAIL}::citext`;
    expect(importer.company_name).toBe("E2E Imports");
    expect(importer.code).toMatch(/^IMP-\d{4}$/);
    expect(importer.status).toBe("PENDING");
    expect(importer.origin).toBe("SELF_REGISTERED");
    // The five that arrive with KYC.
    for (const field of ["legal_name", "entity_type", "address", "city_id", "pincode"]) {
      expect(importer[field], field).toBeNull();
    }

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

    expect(r.json.roleAssigned).toBe(true);
    expect(r.json.importerCode).toMatch(/^IMP-\d{4}$/);

    const [row] = await sql`select status::text from wms.users where id = ${user.id}`;
    expect(row.status).toBe("ACTIVE");

    // The role is attached, scoped to this user's own importer.
    const [role] = await sql`
      select ura.role::text, ura.role_domain::text, i.code
        from wms.user_role_assignment ura
        join wms.importer i on i.id = ura.importer_id
       where ura.user_id = ${user.id} and ura.revoked_at is null`;
    expect(role.role).toBe("IMPORTER");
    expect(role.role_domain).toBe("IMPORTER");
    expect(role.code).toBe(r.json.importerCode);

    // Replay must fail: the codes were consumed.
    const replay = await call("/api/v1/auth/otp/verify", {
      body: { purpose: "registration", identifier: EMAIL, emailCode, smsCode },
    });
    expect(replay.status).toBe(400);
  }, 20_000);

  /**
   * Found by driving the real form: a correct code paired with a
   * mistyped one used to be CONSUMED, leaving the user in front of a
   * form still demanding a code that no longer worked. One wrong digit
   * and the only way out was a resend.
   */
  it("does not burn a correct code when the other one is wrong", async () => {
    const [user] = await sql`select id from wms.users where email = ${EMAIL}::citext`;

    // Fresh pair, then submit one right and one wrong.
    await call("/api/v1/auth/otp/send", {
      body: { purpose: "passwordRecovery", identifier: EMAIL },
    });
    const emailCode = await codesFor(user.id, "EMAIL");

    const partial = await call("/api/v1/auth/otp/verify", {
      body: {
        purpose: "passwordRecovery",
        identifier: EMAIL,
        emailCode,
        smsCode: "000000",
      },
    });
    expect(partial.status).toBe(400);
    // Names the channel that was wrong, so the user knows which box to fix.
    expect(partial.json.error.message).toMatch(/mobile/i);

    // The correct code survived and is still usable.
    const [{ live }] = await sql`
      select count(*)::int as live from wms.user_verification_token
       where user_id = ${user.id} and channel = 'EMAIL' and consumed_at is null`;
    expect(live).toBe(1);

    const smsCode = await codesFor(user.id, "SMS");
    const retry = await call("/api/v1/auth/otp/verify", {
      body: { purpose: "passwordRecovery", identifier: EMAIL, emailCode, smsCode },
    });
    expect(retry.status).toBe(200);
    expect(retry.json.resetToken).toBeTruthy();
  }, 30_000);

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

  it("requires the email and mobile to be the SAME account", async () => {
    const matched = await call("/api/v1/auth/password/forgot", {
      body: { email: EMAIL, mobile: MOBILE },
    });
    // Right email, somebody else's mobile — must behave like a stranger.
    const crossed = await call("/api/v1/auth/password/forgot", {
      body: { email: EMAIL, mobile: "9800000001" },
    });
    const stranger = await call("/api/v1/auth/password/forgot", {
      body: { email: "nobody@smoke.invalid", mobile: "9800000002" },
    });

    for (const r of [matched, crossed, stranger]) expect(r.status).toBe(200);
    expect(matched.json).toEqual(crossed.json);
    expect(matched.json).toEqual(stranger.json);
    expect(Math.abs(matched.ms - stranger.ms)).toBeLessThan(400);

    // The mismatched pair must not have produced a code.
    const [{ count }] = await sql`
      select count(*)::int from wms.audit_log
       where action = 'auth.password.forgot' and result = 'DENIED'
         and reason like '%email and mobile together%'`;
    expect(count).toBeGreaterThan(0);
  }, 30_000);

  it("resets the password and kills every other session", async () => {
    const [user] = await sql`select id from wms.users where email = ${EMAIL}`;

    // Two extra sessions to be revoked.
    const a = await call("/api/v1/auth/login", { body: { identifier: EMAIL, password: PASSWORD } });
    const b = await call("/api/v1/auth/login", { body: { identifier: EMAIL, password: PASSWORD } });
    const cookieA = (a.headers.get("set-cookie") ?? "").split(";")[0];
    expect(b.status).toBe(200);

    await call("/api/v1/auth/password/forgot", { body: { email: EMAIL, mobile: MOBILE } });
    const emailCode = await codesFor(user.id, "EMAIL");
    const smsCode = await codesFor(user.id, "SMS");

    const verified = await call("/api/v1/auth/otp/verify", {
      body: { purpose: "passwordRecovery", identifier: EMAIL, emailCode, smsCode },
    });
    expect(verified.status).toBe(200);
    expect(verified.json.resetToken).toBeTruthy();

    const NEW_PASSWORD = "second-password-4417";
    const reset = await call("/api/v1/auth/password/reset", {
      body: {
        resetToken: verified.json.resetToken,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      },
    });
    expect(reset.status).toBe(200);
    expect(reset.json.sessionsRevoked).toBeGreaterThanOrEqual(2);

    // The old session is dead — the whole point of a reset.
    const stale = await call("/api/v1/auth/session", { method: "GET", cookie: cookieA });
    expect(stale.status).toBe(401);

    // The ticket is single use.
    const replay = await call("/api/v1/auth/password/reset", {
      body: {
        resetToken: verified.json.resetToken,
        newPassword: "third-password-9999",
        confirmPassword: "third-password-9999",
      },
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
