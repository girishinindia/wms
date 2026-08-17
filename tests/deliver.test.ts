import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";

import { testDb } from "./db";

/**
 * Delivery recording, against a real PostgreSQL running the wms pack.
 *
 * Not mocked. The whole value of `notification_delivery` is that the
 * database enforces things the application would otherwise have to
 * remember — the NOT NULL on notification_id, the unique dedupe_key,
 * the enum on channel and status. A mocked db would assert that my
 * mock behaves the way I imagined, which proves nothing.
 *
 * Skipped, loudly, when TEST_DATABASE_URL is not set.
 */
const URL = process.env.TEST_DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

if (!URL) {
  console.warn(
    "\n  deliver.test.ts SKIPPED: set TEST_DATABASE_URL to a database built " +
      "from ../sql to run it.\n",
  );
}

describeDb("deliverDualChannel", () => {
  let sql: postgres.Sql;
  let userId: number;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    process.env.DATABASE_SSL = "disable";
    sql = testDb(URL!);
    const [row] = await sql`
      insert into wms.users (email, first_name, last_name, mobile)
      values ('deliver-test@smoke.invalid','Deliver','Test','9800000099')
      returning id`;
    userId = row.id;
  });

  afterAll(async () => {
    if (!sql) return;
    // audit_log is append-only and untouched here; the rest cascades.
    await sql`delete from wms.users where email = 'deliver-test@smoke.invalid'`;
    await sql.end();
  });

  beforeEach(() => vi.resetModules());

  it("records a suppressed send as a row, not just a log line", async () => {
    const { deliverDualChannel } = await import("@/lib/notify/deliver");
    const dedupe = `test:suppressed:${userId}`;

    const out = await deliverDualChannel(
      {
        eventKey: "user.created",
        recipientUserId: userId,
        dedupeKey: dedupe,
        title: "Verify your account",
        body: "We sent a code to your email and mobile.",
      },
      {
        email: { toEmail: "deliver-test@smoke.invalid", subject: "OTP", message: "code" },
        sms: { purpose: "registration", name: "Deliver", otp: "483920", mobile: "9800000099" },
      },
    );

    expect(out.email?.status).toBe("SUPPRESSED");
    expect(out.sms?.status).toBe("SUPPRESSED");

    const rows = await sql`
      select channel::text, status::text, provider, address
        from wms.notification_delivery
       where notification_id = ${out.notificationId}
       order by channel::text`;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.channel)).toEqual(["EMAIL", "SMS"]);
    expect(rows.map((r) => r.status)).toEqual(["SUPPRESSED", "SUPPRESSED"]);
    expect(rows.find((r) => r.channel === "SMS")!.provider).toBe("smsgatewayhub");
  });

  it("reuses the notification on a replayed request instead of sending twice", async () => {
    const { deliverDualChannel } = await import("@/lib/notify/deliver");
    const dedupe = `test:idempotent:${userId}`;
    const args = [
      {
        eventKey: "user.created",
        recipientUserId: userId,
        dedupeKey: dedupe,
        title: "t",
        body: "b",
      },
      { email: { toEmail: "a@b.invalid", subject: "s", message: "m" } },
    ] as const;

    const first = await deliverDualChannel(...args);
    const second = await deliverDualChannel(...args);

    expect(second.notificationId).toBe(first.notificationId);
    const [{ count }] = await sql`
      select count(*)::int from wms.notification where dedupe_key = ${dedupe}`;
    expect(count).toBe(1);
  });

  it("stores the error code and a retry time for a retryable failure", async () => {
    vi.stubEnv("SMS_FORCE_SEND", "true");
    global.fetch = (async () =>
      new Response("gateway down", { status: 503 })) as unknown as typeof fetch;

    const { deliverDualChannel } = await import("@/lib/notify/deliver");
    const out = await deliverDualChannel(
      {
        eventKey: "user.created",
        recipientUserId: userId,
        dedupeKey: `test:retryable:${userId}`,
        title: "t",
        body: "b",
      },
      { sms: { purpose: "registration", name: "D", otp: "1", mobile: "9800000099" } },
    );

    expect(out.sms?.status).toBe("FAILED");
    const [row] = await sql`
      select status::text, error_code, last_error, next_retry_at, failed_at
        from wms.notification_delivery
       where notification_id = ${out.notificationId}`;
    expect(row.status).toBe("FAILED");
    expect(row.error_code).toBe("HTTP_503");
    expect(row.failed_at).not.toBeNull();
    // The retry time is what a worker will poll on; without it the row
    // is a record of failure rather than something that recovers.
    expect(row.next_retry_at).not.toBeNull();
    vi.unstubAllEnvs();
  });

  it("leaves no retry time on a failure that cannot succeed", async () => {
    vi.stubEnv("SMS_FORCE_SEND", "true");
    global.fetch = (async () =>
      new Response(JSON.stringify({ ErrorCode: "0021", ErrorMessage: "No credits" }), {
        status: 200,
      })) as unknown as typeof fetch;

    const { deliverDualChannel } = await import("@/lib/notify/deliver");
    const out = await deliverDualChannel(
      {
        eventKey: "user.created",
        recipientUserId: userId,
        dedupeKey: `test:terminal:${userId}`,
        title: "t",
        body: "b",
      },
      { sms: { purpose: "registration", name: "D", otp: "1", mobile: "9800000099" } },
    );

    const [row] = await sql`
      select status::text, error_code, next_retry_at
        from wms.notification_delivery
       where notification_id = ${out.notificationId}`;
    expect(row.error_code).toBe("0021");
    expect(row.next_retry_at).toBeNull();
    vi.unstubAllEnvs();
  });
});
