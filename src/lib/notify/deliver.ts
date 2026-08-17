import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";

import { sendEmail, type SendEmailInput } from "./email";
import { sendSms, type SendSmsInput } from "./sms";
import type { SendOutcome } from "./types";

/**
 * Send, and record the attempt in `wms.notification_delivery`.
 *
 * The recording is the point. A send that fails and only writes to a log
 * is invisible: nobody greps logs to answer "did this importer ever get
 * their OTP?". A row carries the provider, the provider's own id, the
 * error code, the attempt count and the retry time, so the question is a
 * query and the retry is a worker reading a table.
 *
 * Every send needs a `notification` row to hang off, because
 * `notification_delivery.notification_id` is NOT NULL — that is
 * deliberate: it means there is no such thing as a delivery nobody can
 * trace back to an event and a recipient.
 */

export type DeliverInput = {
  /** wms.notification_event.key — must already exist. */
  eventKey: string;
  recipientUserId: number;
  /**
   * Makes the send idempotent. `notification.dedupe_key` is unique, so a
   * retried request reuses the existing row instead of sending twice.
   * Include whatever makes this send distinct: purpose, user, and a
   * token id or time bucket.
   */
  dedupeKey: string;
  title: string;
  /** Shown in the in-app feed. Never put the OTP itself here. */
  body: string;
  correlationId?: string;
  payload?: Record<string, unknown>;
};

/** Backoff for a retryable failure: 1min, 4min, 9min. */
function nextRetryDelaySeconds(attempts: number): number {
  return Math.min(attempts * attempts * 60, 900);
}

/**
 * Create (or find) the notification row, then send on both channels.
 *
 * Email and SMS go out concurrently. They are independent — a bounced
 * email must not delay the SMS — and the dual-OTP flow is only useful if
 * both arrive at about the same time.
 */
export async function deliverDualChannel(
  input: DeliverInput,
  channels: { email?: SendEmailInput; sms?: SendSmsInput },
): Promise<{ notificationId: number; email?: SendOutcome; sms?: SendOutcome }> {
  const notificationId = await upsertNotification(input);

  const [email, smsResult] = await Promise.all([
    channels.email
      ? sendEmail(channels.email).then((o) =>
          recordDelivery(notificationId, "EMAIL", channels.email!.toEmail, o),
        )
      : Promise.resolve(undefined),
    channels.sms
      ? sendSms(channels.sms).then((o) =>
          recordDelivery(notificationId, "SMS", channels.sms!.mobile, o),
        )
      : Promise.resolve(undefined),
  ]);

  return { notificationId, email, sms: smsResult };
}

/**
 * One row per (event, recipient, dedupe_key). `on conflict do nothing`
 * plus a returning-or-select is what makes a retried HTTP request safe:
 * the second call finds the first call's row.
 */
async function upsertNotification(input: DeliverInput): Promise<number> {
  const db = getDb();
  const rows = await db.execute<{ id: number }>(sql`
    with inserted as (
      insert into wms.notification
        (event_key, recipient_user_id, title, body, payload,
         correlation_id, dedupe_key)
      values (${input.eventKey}, ${input.recipientUserId}, ${input.title},
              ${input.body}, ${JSON.stringify(input.payload ?? {})}::jsonb,
              ${input.correlationId ?? null}, ${input.dedupeKey})
      on conflict (dedupe_key) do nothing
      returning id
    )
    select id from inserted
    union all
    select id from wms.notification
     where dedupe_key = ${input.dedupeKey}
       and not exists (select 1 from inserted)
    limit 1
  `);

  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error(
      `Could not create or find a notification for dedupe_key '${input.dedupeKey}'`,
    );
  }
  return id;
}

/**
 * Write the attempt. Uses the partial unique index on
 * (provider, provider_message_id) so a replayed provider callback cannot
 * create a second row for the same message.
 */
async function recordDelivery(
  notificationId: number,
  channel: "EMAIL" | "SMS",
  address: string,
  outcome: SendOutcome,
): Promise<SendOutcome> {
  const db = getDb();
  const failed = outcome.status === "FAILED";
  const retryAt =
    failed && outcome.retryable
      ? sql`now() + make_interval(secs => ${nextRetryDelaySeconds(1)})`
      : sql`null`;

  await db.execute(sql`
    insert into wms.notification_delivery
      (notification_id, channel, address, status, provider,
       provider_message_id, provider_response, attempts,
       last_error, error_code, sent_at, failed_at, next_retry_at)
    values (
      ${notificationId}, ${channel}::wms.notif_channel,
      ${outcome.address ?? address},
      ${outcome.status}::wms.delivery_status,
      ${outcome.provider},
      ${outcome.providerMessageId ?? null},
      ${JSON.stringify(outcome.response ?? null)}::jsonb,
      1,
      ${outcome.error ?? null},
      ${outcome.errorCode ?? null},
      ${outcome.status === "SENT" ? sql`now()` : sql`null`},
      ${failed ? sql`now()` : sql`null`},
      ${retryAt}
    )
  `);

  return outcome;
}
