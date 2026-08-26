import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { emailEnv } from "@/lib/env";
import { sendEmail } from "@/lib/notify/email";

/**
 * Answering a contact-form enquiry, from the portal.
 *
 * Replying used to be a `mailto:` link. It opened whatever mail client
 * the machine had, and everything after that happened somewhere this
 * system cannot see — no record that anybody answered, no way for a
 * second super admin to know it was handled, and nothing to show when
 * the customer says they never heard back.
 *
 * The rule this module keeps: the row is written whatever the provider
 * does. A reply Brevo refused is still a thing a person typed and
 * believed they sent, and hiding it would be the same silence the
 * `mailto:` had.
 */

export type ReplyStatus = "SENT" | "FAILED" | "SUPPRESSED";

export type EnquiryReply = {
  id: number;
  body: string;
  sentAt: string;
  sentByName: string;
  status: ReplyStatus;
  error: string | null;
};

/** Every reply on one enquiry, oldest first — the order a conversation
 *  reads in. */
export async function readThread(enquiryId: number): Promise<EnquiryReply[]> {
  const rows = await getDb().execute<{
    id: number; body: string; sent_at: string;
    sent_by_name: string | null; status: ReplyStatus; error: string | null;
  }>(sql`
    select r.id, r.body, r.sent_at::text as sent_at,
           nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') as sent_by_name,
           r.status::text as status, r.error
      from wms.enquiry_reply r
      left join wms.users u on u.id = r.sent_by
     where r.enquiry_id = ${enquiryId}
     order by r.sent_at asc`);

  return rows.map((r) => ({
    id: Number(r.id),
    body: r.body,
    sentAt: r.sent_at,
    sentByName: r.sent_by_name ?? "A super admin",
    status: r.status,
    error: r.error,
  }));
}

/**
 * What the enquirer is answered with.
 *
 * Their own message is quoted underneath, the way a mail client would,
 * because a reply arriving days later with no context reads as a
 * cold email. The quote is plain text — `sendEmail` escapes everything
 * before it reaches the HTML, so a message containing markup stays
 * inert.
 */
function compose(body: string, original: { subject: string; message: string }): string {
  return [
    body.trim(),
    "",
    "———",
    `You wrote to us about "${original.subject}":`,
    "",
    original.message.trim(),
  ].join("\n");
}

export type SendReplyResult = {
  id: number;
  status: ReplyStatus;
  error: string | null;
};

export async function sendReply(input: {
  enquiry: { id: number; name: string; email: string; subject: string; message: string };
  body: string;
  actorUserId: number;
}): Promise<SendReplyResult> {
  const env = emailEnv();

  /**
   * `Re:` only once, however many times this goes back and forth.
   *
   * A subject that grows "Re: Re: Re:" is the tell of a system that
   * concatenates rather than reads.
   */
  const subject = /^re:\s/i.test(input.enquiry.subject)
    ? input.enquiry.subject
    : `Re: ${input.enquiry.subject}`;

  /**
   * A failed send must not lose the reply.
   *
   * `sendEmail` already returns rather than throws for a provider
   * error, but a thrown exception — a DNS failure, an env parse — would
   * otherwise take the row down with it, and the person would be told
   * nothing happened when they have no way to get their words back.
   */
  const outcome = await sendEmail({
    toEmail: input.enquiry.email,
    toName: input.enquiry.name,
    subject,
    message: compose(input.body, input.enquiry),
    /**
     * The default footer says "please do not reply to this email",
     * which is exactly wrong here: this IS the reply, and theirs should
     * come back to a person.
     */
    footerNote: `You can reply directly to this email and it will reach ${env.EMAIL_FROM_NAME}.`,
    replyTo: env.adminNotify
      ? { email: env.adminNotify, name: env.EMAIL_FROM_NAME }
      : undefined,
  }).catch((error: unknown) => ({
    status: "FAILED" as const,
    error: error instanceof Error ? error.message : String(error),
    providerMessageId: undefined,
  }));

  /**
   * SUPPRESSED is not a failure and not a success, and the difference
   * matters more here than anywhere else in the product.
   *
   * `shouldReallySend()` gates every send on APP_ENV being production.
   * On a deployment where that is not set, this stores replies nobody
   * receives — so the status is carried through honestly and the screen
   * says which of the three happened, rather than showing a tick for a
   * message that never left.
   */
  const status: ReplyStatus =
    outcome.status === "SENT" ? "SENT" : outcome.status === "SUPPRESSED" ? "SUPPRESSED" : "FAILED";

  const error =
    status === "SENT"
      ? null
      : status === "SUPPRESSED"
        ? "Email sending is switched off for this environment (APP_ENV is not production)."
        : ("error" in outcome && outcome.error) || "The email provider refused the message.";

  const [row] = await getDb().execute<{ id: number }>(sql`
    insert into wms.enquiry_reply
      (enquiry_id, body, sent_by, to_email, status, provider_message_id, error)
    values (${input.enquiry.id}, ${input.body.trim()}, ${input.actorUserId},
            ${input.enquiry.email}, ${status}::wms.delivery_status,
            ${"providerMessageId" in outcome ? (outcome.providerMessageId ?? null) : null},
            ${error})
    returning id`);

  return { id: Number(row!.id), status, error };
}
