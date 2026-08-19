import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";

import { queueDelivery } from "./outbox";
import { devicesFor } from "./push";
import { getTemplate, render } from "./templates";
import type { SendOutcome } from "./types";

/**
 * Fan an event out to whoever the routing rules say should hear it.
 *
 * The audience is resolved by `resolve_notification_audience` in the
 * database rather than by a chain of ifs here — which means "who gets
 * told about a new importer" is a row somebody can change, not a deploy.
 *
 * Every channel gets its own `notification_delivery` row, so a push that
 * fails while the email succeeds is visible as exactly that rather than
 * as one ambiguous "notification failed".
 */

export type AnnounceInput = {
  eventKey: string;
  /** Substituted into the templates. Values must be strings. */
  values: Record<string, string>;
  /** Distinguishes this occurrence; combined with the recipient id. */
  dedupeSuffix: string;
  actorUserId?: number | null;
  entityType?: string;
  entityId?: string;
  importerId?: number | null;
  warehouseId?: number | null;
  correlationId?: string;
};

export type AnnounceResult = {
  recipients: number;
  sent: Record<string, number>;
  failed: Record<string, number>;
  /** Handed to the queue; the job reports the final outcome on the row. */
  queued: Record<string, number>;
};

export async function announce(input: AnnounceInput): Promise<AnnounceResult> {
  const db = getDb();

  // Which channels, and to whom — both from the database.
  const rules = await db.execute<{ audience: string; role_filter: string | null; channels: string[] }>(sql`
    select audience::text as audience, role_filter::text as role_filter,
           channels::text[] as channels
      from wms.notification_rule
     where event_key = ${input.eventKey} and is_active
  `);

  const result: AnnounceResult = { recipients: 0, sent: {}, failed: {}, queued: {} };
  if (rules.length === 0) return result;

  const seen = new Set<number>();

  for (const rule of rules) {
    const audience = await db.execute<{ user_id: number }>(sql`
      select user_id from wms.resolve_notification_audience(
        ${rule.audience}::wms.notif_audience,
        ${rule.role_filter}::wms.role_key,
        ${input.actorUserId ?? null},
        null,
        ${input.warehouseId ?? null},
        ${input.importerId ?? null}
      )
    `);

    for (const { user_id: userId } of audience) {
      // A user matched by two rules gets one notification, not two.
      if (seen.has(userId)) continue;
      seen.add(userId);
      result.recipients += 1;

      const notificationId = await createNotification(input, userId, rule.channels);

      for (const channel of rule.channels) {
        const outcome = await deliver(channel, userId, input, notificationId);
        if (!outcome) continue;
        const bucket =
          outcome === "QUEUED" ? result.queued : outcome.status === "FAILED" ? result.failed : result.sent;
        bucket[channel] = (bucket[channel] ?? 0) + 1;
      }
    }
  }

  return result;
}

async function createNotification(
  input: AnnounceInput,
  recipientUserId: number,
  channels: string[],
): Promise<number> {
  const inApp = await getTemplate(input.eventKey, "IN_APP").catch(() => null);
  const title = inApp ? render(inApp.subject ?? input.eventKey, input.values) : input.eventKey;
  const body = inApp ? render(inApp.body, input.values) : "";

  const rows = await getDb().execute<{ id: number }>(sql`
    with inserted as (
      insert into wms.notification
        (event_key, recipient_user_id, actor_user_id, entity_type, entity_id,
         importer_id, warehouse_id, title, body, action_url, payload,
         correlation_id, dedupe_key)
      values (${input.eventKey}, ${recipientUserId}, ${input.actorUserId ?? null},
              ${input.entityType ?? null}, ${input.entityId ?? null},
              ${input.importerId ?? null}, ${input.warehouseId ?? null},
              ${title}, ${body},
              ${inApp?.actionUrl ? render(inApp.actionUrl, input.values) : null},
              ${JSON.stringify(input.values)}::jsonb,
              ${input.correlationId ?? null},
              ${`${input.eventKey}:${recipientUserId}:${input.dedupeSuffix}`})
      on conflict (dedupe_key) do nothing
      returning id
    )
    select id from inserted
    union all
    select id from wms.notification
     where dedupe_key = ${`${input.eventKey}:${recipientUserId}:${input.dedupeSuffix}`}
       and not exists (select 1 from inserted)
    limit 1
  `);

  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`Could not create a notification for ${input.eventKey}`);
  void channels;
  return id;
}

async function deliver(
  channel: string,
  userId: number,
  input: AnnounceInput,
  notificationId: number,
): Promise<SendOutcome | "QUEUED" | null> {
  if (channel === "IN_APP") {
    // The `notification` row IS the in-app delivery. Recorded anyway, so
    // one query answers "which channels was this sent on".
    return record(notificationId, "IN_APP", "in-app", {
      status: "SENT",
      retryable: false,
      provider: "brevo",
      response: { inApp: true },
    });
  }

  // EMAIL and PUSH go through the outbox: a QUEUED delivery row now,
  // the provider call from the QStash job (or inline when there is no
  // queue). Three attempts at most — see outbox.ts.
  if (channel === "EMAIL") {
    const [user] = await getDb().execute<{ email: string }>(sql`
      select email::text as email from wms.users where id = ${userId} and deleted_at is null
    `);
    if (!user) return null;
    const template = await getTemplate(input.eventKey, "EMAIL").catch(() => null);
    if (!template) return null;
    const { outcome } = await queueDelivery({ notificationId, channel: "EMAIL", address: user.email });
    return outcome;
  }

  if (channel === "PUSH") {
    const template = await getTemplate(input.eventKey, "PUSH").catch(() => null);
    if (!template) return null;
    const tokens = await devicesFor(userId);
    // No registered device is not a failure — most admins are on the web.
    if (tokens.length === 0) return null;
    let last: SendOutcome | "QUEUED" | null = null;
    for (const token of tokens) {
      const { outcome } = await queueDelivery({ notificationId, channel: "PUSH", address: token });
      last = outcome;
    }
    return last;
  }

  return null;
}

async function record(
  notificationId: number,
  channel: string,
  address: string,
  outcome: SendOutcome,
): Promise<SendOutcome> {
  await getDb().execute(sql`
    insert into wms.notification_delivery
      (notification_id, channel, address, status, provider, provider_message_id,
       provider_response, attempts, last_error, error_code, sent_at, failed_at,
       next_retry_at)
    values (
      ${notificationId}, ${channel}::wms.notif_channel,
      ${outcome.address ?? address}, ${outcome.status}::wms.delivery_status,
      ${outcome.provider}, ${outcome.providerMessageId ?? null},
      ${JSON.stringify(outcome.response ?? null)}::jsonb, 1,
      ${outcome.error ?? null}, ${outcome.errorCode ?? null},
      ${outcome.status === "SENT" ? sql`now()` : sql`null`},
      ${outcome.status === "FAILED" ? sql`now()` : sql`null`},
      ${
        outcome.status === "FAILED" && outcome.retryable
          ? sql`now() + interval '1 minute'`
          : sql`null`
      }
    )
  `);
  return outcome;
}
