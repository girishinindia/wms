import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";

/**
 * Message templates, read from `wms.notification_template`.
 *
 * Not from .env, and not from a TypeScript constant. The project's own
 * note in web-api/.env says it: `SMSGATEWAY_TEMPLATE_* → IDs belong in
 * the DB`.
 *
 * The reason it matters more for SMS than for email: an Indian
 * transactional SMS is matched by the operator against the exact text
 * registered under the id it was sent with. The text and the id are one
 * fact. Keep the wording in code and the id in .env and they drift the
 * first time a template is re-registered — after which every message is
 * dropped with ErrorCode 0024, silently, and the application sees a
 * successful-looking call.
 *
 * One row holds both, so they cannot drift, and re-registering is an
 * UPDATE rather than a deploy.
 */

/** The five OTP purposes, each an event key in the database. */
export const OTP_EVENTS = {
  registration: "auth.otp.registration",
  passwordRecovery: "auth.otp.password_recovery",
  resetPassword: "auth.otp.reset_password",
  updateEmail: "auth.otp.update_email",
  updateMobile: "auth.otp.update_mobile",
} as const;

export type OtpPurpose = keyof typeof OTP_EVENTS;

export type Template = {
  eventKey: string;
  channel: "EMAIL" | "SMS";
  subject: string | null;
  body: string;
  dltTemplateId: string | null;
  dltEntityId: string | null;
  senderId: string | null;
};

/**
 * Cached for a minute. Templates change when someone re-registers with
 * the operator — measured in days — so a per-request round trip buys
 * nothing. A minute is short enough that an emergency correction takes
 * effect without a deploy, which is the whole point of holding them in
 * the database.
 */
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Template | null }>();

/** Drops the cache. Call after changing a template row. */
export function clearTemplateCache(): void {
  cache.clear();
}

export async function getTemplate(
  eventKey: string,
  channel: "EMAIL" | "SMS",
  locale = "en",
): Promise<Template> {
  const key = `${eventKey}|${channel}|${locale}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    if (hit.value) return hit.value;
    throw notFound(eventKey, channel, locale);
  }

  const rows = await getDb().execute<{
    event_key: string;
    channel: "EMAIL" | "SMS";
    subject: string | null;
    body: string;
    dlt_template_id: string | null;
    dlt_entity_id: string | null;
    sender_id: string | null;
  }>(sql`
    select event_key, channel::text as channel, subject, body,
           dlt_template_id, dlt_entity_id, sender_id
      from wms.notification_template
     where event_key = ${eventKey}
       and channel = ${channel}::wms.notif_channel
       and locale = ${locale}
       and is_active
     order by version desc
     limit 1
  `);

  const row = rows[0];
  if (!row) {
    cache.set(key, { at: Date.now(), value: null });
    throw notFound(eventKey, channel, locale);
  }

  const template: Template = {
    eventKey: row.event_key,
    channel: row.channel,
    subject: row.subject,
    body: row.body,
    dltTemplateId: row.dlt_template_id,
    dltEntityId: row.dlt_entity_id,
    senderId: row.sender_id,
  };
  cache.set(key, { at: Date.now(), value: template });
  return template;
}

function notFound(eventKey: string, channel: string, locale: string): Error {
  return new Error(
    `No active ${channel} template for '${eventKey}' (locale ${locale}). ` +
      `Templates are seeded by sql/11_notification_templates.sql.`,
  );
}

/**
 * Substitute `{{name}}`-style placeholders.
 *
 * Throws on a placeholder with no value rather than leaving `{{otp}}` in
 * the message. For SMS that difference is the whole ballgame: a literal
 * `{{otp}}` still matches the DLT pattern well enough to be delivered,
 * and the user receives a code that is not a code.
 */
export function render(body: string, values: Record<string, string | number>): string {
  const missing: string[] = [];
  const out = body.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      missing.push(name);
      return "";
    }
    return String(value);
  });
  if (missing.length) {
    throw new Error(`Template placeholder(s) with no value: ${missing.join(", ")}`);
  }
  return out;
}

/**
 * The variable part of a DLT template. Collapsed and capped, because the
 * operator matches the FIXED text around the variables — a name carrying
 * a newline can push the message out of shape and get it dropped.
 */
export function sanitiseName(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  return cleaned.length > 30 ? cleaned.slice(0, 30) : cleaned || "User";
}
