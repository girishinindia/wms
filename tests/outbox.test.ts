import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

/**
 * The outbox: three attempts, then nothing.
 *
 * Email is mocked to fail (retryable) so the attempt counter can be
 * watched; the rows are real. Without QSTASH_TOKEN the queue falls
 * through to inline attempts, which is exactly what lets this run here.
 */
const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const canRun = Boolean(url) && process.env.CI_SKIP_DB !== "1";

const sendEmail = vi.fn();
vi.mock("@/lib/notify/email", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

describe.skipIf(!canRun)("notification outbox", () => {
  let db: Awaited<ReturnType<typeof import("@/db")["getDb"]>>;
  let outbox: typeof import("@/lib/notify/outbox");
  let userId = 0;
  let notificationId = 0;
  const tag = `ob${Date.now().toString(36)}`;

  const row = async (id: number) =>
    (await db.execute<{ status: string; attempts: number; next_retry_at: string | null; error_code: string | null }>(sql`
      select status::text as status, attempts, next_retry_at::text as next_retry_at, error_code, last_error
        from wms.notification_delivery where id = ${id}`))[0]!;

  beforeAll(async () => {
    process.env.DATABASE_SSL = "disable";
    process.env.DATABASE_URL = url;
    delete process.env.QSTASH_TOKEN;
    db = (await import("@/db")).getDb();
    outbox = await import("@/lib/notify/outbox");
    const [u] = await db.execute<{ id: number }>(sql`
      insert into wms.users (email, first_name, last_name, mobile)
      values (${`${tag}@test.invalid`}, 'Out', 'Box', ${"7" + String(Date.now()).slice(-9)}::wms.mobile_in)
      returning id`);
    userId = u!.id;
    const [n] = await db.execute<{ id: number }>(sql`
      insert into wms.notification (event_key, recipient_user_id, title, body, payload, dedupe_key)
      values ('importer.kyc_submitted', ${userId}, 'T', 'B',
              '{"company":"X","code":"IMP-1","legal_name":"X Ltd","contact":"C","email":"c@x.invalid","mobile":"9000000000","importer_id":"1"}'::jsonb,
              ${`${tag}:dedupe`})
      returning id`);
    notificationId = n!.id;
  });

  afterAll(async () => {
    await db.execute(sql`delete from wms.notification where id = ${notificationId}`);
    await db.execute(sql`delete from wms.users where id = ${userId}`);
  });

  it("fails retryably three times, then stops for good", async () => {
    sendEmail.mockResolvedValue({
      status: "FAILED", retryable: true, provider: "brevo", errorCode: "NETWORK", error: "boom",
    });

    // Attempt 1 happens inline (no queue configured).
    const { deliveryId } = await outbox.queueDelivery({ notificationId, channel: "EMAIL", address: `${tag}@test.invalid` });
    let r = await row(deliveryId);
    expect(r.status).toBe("FAILED");
    expect(r.attempts).toBe(1);
    expect(r.error_code).toBe("NETWORK");
    expect(r.next_retry_at).not.toBeNull();

    await outbox.attemptDelivery(deliveryId);
    r = await row(deliveryId);
    expect(r.attempts).toBe(2);
    expect(r.next_retry_at).not.toBeNull();

    await outbox.attemptDelivery(deliveryId);
    r = await row(deliveryId);
    expect(r.attempts).toBe(3);
    expect(r.status).toBe("FAILED");
    // The cap: no next retry, ever.
    expect(r.next_retry_at).toBeNull();

    // A fourth call is a no-op: nothing sent, nothing changed.
    sendEmail.mockClear();
    expect(await outbox.attemptDelivery(deliveryId)).toBeNull();
    expect(sendEmail).not.toHaveBeenCalled();
    expect((await row(deliveryId)).attempts).toBe(3);

    // And the cron never picks it up either.
    const due = await outbox.requeueDue(50);
    expect((await row(deliveryId)).attempts).toBe(3);
    void due;
  });

  it("a permanent failure stops at the first attempt", async () => {
    sendEmail.mockResolvedValue({
      status: "FAILED", retryable: false, provider: "brevo", errorCode: "INVALID_EMAIL", error: "nope",
    });
    const { deliveryId } = await outbox.queueDelivery({ notificationId, channel: "EMAIL", address: "bad@test.invalid" });
    const r = await row(deliveryId);
    expect(r.attempts).toBe(1);
    expect(r.status).toBe("FAILED");
    expect(r.next_retry_at).toBeNull();
    expect(await outbox.attemptDelivery(deliveryId)).toBeNull();
  });

  it("a template that cannot render is a permanent failure, not three retries", async () => {
    const [n] = await db.execute<{ id: number }>(sql`
      insert into wms.notification (event_key, recipient_user_id, title, body, payload, dedupe_key)
      values ('importer.kyc_submitted', ${userId}, 'T', 'B', '{"company":"X"}'::jsonb, ${`${tag}:dedupe2`})
      returning id`);
    sendEmail.mockClear();
    const { deliveryId } = await outbox.queueDelivery({ notificationId: n!.id, channel: "EMAIL", address: `${tag}@test.invalid` });
    const r = await row(deliveryId);
    expect(r.status).toBe("FAILED");
    expect(r.error_code).toBe("TEMPLATE");
    expect(r.next_retry_at).toBeNull();
    expect(sendEmail).not.toHaveBeenCalled();
    await db.execute(sql`delete from wms.notification where id = ${n!.id}`);
  });

  it("a success is SENT and never attempted again", async () => {
    sendEmail.mockResolvedValue({ status: "SENT", retryable: false, provider: "brevo", providerMessageId: `${tag}-m1` });
    const { deliveryId } = await outbox.queueDelivery({ notificationId, channel: "EMAIL", address: `${tag}@test.invalid` });
    const r = await row(deliveryId);
    expect(r.status).toBe("SENT");
    expect(r.attempts).toBe(1);
    sendEmail.mockClear();
    expect(await outbox.attemptDelivery(deliveryId)).toBeNull();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
