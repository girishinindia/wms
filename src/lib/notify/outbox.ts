import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { qstashEnv } from "@/lib/env";
import { enqueue } from "@/lib/jobs/qstash";
import { absoluteUrl } from "@/lib/url";

import { sendEmail } from "./email";
import { sendPush } from "./push";
import { getTemplate, render } from "./templates";
import type { SendOutcome } from "./types";

/**
 * The outbox: `notification_delivery` rows are written first, sent later.
 *
 * `queueDelivery` writes a QUEUED row and hands its id to QStash, which
 * calls `/api/v1/jobs/deliver` back; `attemptDelivery` is what that job
 * runs. Without QStash the same function runs inline, right after the
 * insert, so local development and a mis-configured deploy still send —
 * one code path, two schedules.
 *
 * Attempts: a failure that the provider calls retryable is tried again
 * after 1, then 4 minutes (attempt² minutes); after `NOTIFY_MAX_ATTEMPTS`
 * (3) the row is FAILED for good — `next_retry_at` is null and nothing
 * in this module or in the crons will ever pick it up again. A failure
 * the provider calls permanent (bad address, rejected template) stops at
 * the first attempt.
 *
 * The message itself is not stored on the delivery row: it is rendered
 * from the channel's template and the notification's `payload` at send
 * time, so a template fix between attempts reaches the retry.
 */

export type QueueChannel = "EMAIL" | "PUSH" | "SMS";

export type QueueInput = {
  notificationId: number;
  channel: QueueChannel;
  /** Email address, device token or mobile — whatever the channel sends to. */
  address: string;
};

export const JOB_DELIVER_PATH = "/api/v1/jobs/deliver";

const backoffSeconds = (attempt: number) => Math.min(attempt * attempt * 60, 900);

/** Write the QUEUED row and dispatch it (queue, or inline). */
export async function queueDelivery(input: QueueInput): Promise<{ deliveryId: number; outcome: SendOutcome | "QUEUED" }> {
  const rows = await getDb().execute<{ id: number }>(sql`
    insert into wms.notification_delivery
      (notification_id, channel, address, status, attempts, max_attempts)
    values (${input.notificationId}, ${input.channel}::wms.notif_channel, ${input.address},
            'QUEUED', 0, ${qstashEnv().NOTIFY_MAX_ATTEMPTS})
    returning id
  `);
  const deliveryId = rows[0]!.id;
  const queued = await enqueue(JOB_DELIVER_PATH, { deliveryId }, { deduplicationId: `deliver:${deliveryId}:1` });
  if (queued) return { deliveryId, outcome: "QUEUED" };
  const outcome = await attemptDelivery(deliveryId);
  return { deliveryId, outcome: outcome ?? "QUEUED" };
}

type DeliveryRow = {
  id: number;
  notification_id: number;
  channel: QueueChannel;
  address: string;
  status: string;
  attempts: number;
  max_attempts: number;
  next_retry_at: string | null;
  event_key: string;
  recipient_user_id: number;
  payload: Record<string, string> | null;
  title: string;
  body: string;
  action_url: string | null;
  email: string | null;
  first_name: string | null;
};

/**
 * One attempt. Idempotent: a row that is already SENT, or has used up its
 * attempts, is left alone — so a duplicated job message cannot send twice.
 * Returns the outcome, or null when there was nothing to do.
 */
export async function attemptDelivery(deliveryId: number): Promise<SendOutcome | null> {
  const rows = await getDb().execute<DeliveryRow>(sql`
    select d.id, d.notification_id, d.channel::text as channel, d.address, d.status::text as status,
           d.attempts, d.max_attempts, d.next_retry_at::text as next_retry_at,
           n.event_key, n.recipient_user_id, n.payload, n.title, n.body, n.action_url,
           u.email::text as email, u.first_name
      from wms.notification_delivery d
      join wms.notification n on n.id = d.notification_id
      left join wms.users u on u.id = n.recipient_user_id
     where d.id = ${deliveryId}
  `);
  const row = rows[0];
  if (!row) return null;
  if (row.status === "SENT" || row.status === "DELIVERED" || row.status === "READ") return null;
  if (row.attempts >= row.max_attempts) return null;
  // FAILED with no retry scheduled is terminal — a permanent failure
  // (bad address, broken template) decided at an earlier attempt.
  if (row.status === "FAILED" && row.attempts > 0 && row.next_retry_at === null) return null;
  if (row.status === "SUPPRESSED") return null;

  const values = row.payload ?? {};
  const attempt = row.attempts + 1;
  let outcome: SendOutcome;

  try {
    outcome = await send(row, values);
  } catch (error) {
    const message = error instanceof Error ? error.message : "send threw";
    // A template that cannot render (missing placeholder, no template)
    // will not render any better in four minutes — permanent. Anything
    // else (network, provider 5xx surfacing as a throw) is worth a retry.
    const permanent = /placeholder|template/i.test(message);
    outcome = {
      status: "FAILED",
      retryable: !permanent,
      provider: row.channel === "EMAIL" ? "brevo" : row.channel === "PUSH" ? "fcm" : "smsgatewayhub",
      errorCode: permanent ? "TEMPLATE" : "EXCEPTION",
      error: message.slice(0, 300),
    };
  }

  const failed = outcome.status === "FAILED";
  const willRetry = failed && outcome.retryable && attempt < row.max_attempts;
  const delay = backoffSeconds(attempt);

  await getDb().execute(sql`
    update wms.notification_delivery
       set status = ${outcome.status}::wms.delivery_status,
           attempts = ${attempt},
           provider = ${outcome.provider},
           provider_message_id = coalesce(${outcome.providerMessageId ?? null}, provider_message_id),
           provider_response = ${JSON.stringify(outcome.response ?? null)}::jsonb,
           address = ${outcome.address ?? row.address},
           last_error = ${outcome.error ?? null},
           error_code = ${outcome.errorCode ?? null},
           sent_at = ${outcome.status === "SENT" ? sql`now()` : sql`sent_at`},
           failed_at = ${failed ? sql`now()` : sql`null`},
           next_retry_at = ${willRetry ? sql`now() + make_interval(secs => ${delay})` : sql`null`},
           updated_at = now()
     where id = ${deliveryId}
  `);

  if (willRetry) {
    // Next attempt via the queue, after the backoff. If there is no
    // queue, `retry-failed` (or nothing — inline mode has no cron) picks
    // it up; inline we do not block the request to sleep.
    await enqueue(JOB_DELIVER_PATH, { deliveryId }, {
      delaySeconds: delay,
      deduplicationId: `deliver:${deliveryId}:${attempt + 1}`,
    });
  }
  return outcome;
}

async function send(row: DeliveryRow, values: Record<string, string>): Promise<SendOutcome> {
  if (row.channel === "EMAIL") {
    const template = await getTemplate(row.event_key, "EMAIL").catch(() => null);
    return sendEmail({
      toEmail: row.address,
      toName: row.first_name ?? "",
      subject: template ? render(template.subject ?? row.event_key, values) : row.title,
      message: template ? render(template.body, values) : row.body,
      actionUrl: template?.actionUrl
        ? absoluteUrl(render(template.actionUrl, values))
        : row.action_url ? absoluteUrl(row.action_url) : null,
    });
  }
  if (row.channel === "PUSH") {
    const template = await getTemplate(row.event_key, "PUSH").catch(() => null);
    const path = template?.actionUrl ? render(template.actionUrl, values) : row.action_url;
    return sendPush({
      token: row.address,
      title: template ? render(template.subject ?? row.event_key, values) : row.title,
      body: template ? render(template.body, values) : row.body,
      data: {
        eventKey: row.event_key,
        notificationId: String(row.notification_id),
        ...(path ? { actionUrl: absoluteUrl(path) ?? path, actionPath: path } : {}),
      },
    });
  }
  // SMS is DLT-template OTP only in this deployment (see sms.ts); a
  // generic notification cannot go out on it. Recorded as suppressed,
  // permanently — not a failure to retry.
  return {
    status: "SUPPRESSED",
    retryable: false,
    provider: "smsgatewayhub",
    errorCode: "NO_SMS_TEMPLATE",
    error: "SMS notifications need a DLT-registered template; none configured for this event",
  };
}

/**
 * The safety net, run by cron: FAILED rows whose retry time has come and
 * that still have attempts left (a delayed publish can be lost), plus
 * QUEUED rows that never got a first attempt within ten minutes. Rows at
 * their attempt cap are never selected — "try 3 times, then nothing".
 */
export async function requeueDue(limit = 100): Promise<{ requeued: number; attempted: number }> {
  const rows = await getDb().execute<{ id: number }>(sql`
    select id from wms.notification_delivery
     where attempts < max_attempts
       and (
         (status = 'FAILED' and next_retry_at is not null and next_retry_at <= now())
         or (status = 'QUEUED' and created_at < now() - interval '10 minutes')
       )
     order by coalesce(next_retry_at, created_at)
     limit ${limit}
  `);
  let requeued = 0;
  let attempted = 0;
  for (const r of rows) {
    const ok = await enqueue(JOB_DELIVER_PATH, { deliveryId: r.id }, { deduplicationId: `requeue:${r.id}:${Date.now()}` });
    if (ok) requeued += 1;
    else {
      await attemptDelivery(Number(r.id));
      attempted += 1;
    }
  }
  return { requeued, attempted };
}
