import "server-only";

import { emailEnv, shouldReallySend } from "@/lib/env";

import type { SendOutcome } from "./types";

/**
 * Brevo transactional email.
 *
 * Ported from the reference proxy server: same endpoint, same payload,
 * same branded template. The proxy is gone because a Next route handler
 * is already server-side — the browser never sees BREVO_API_KEY either
 * way, and there is one fewer process to keep alive.
 */

const ENDPOINT = "https://api.brevo.com/v3/smtp/email";

/**
 * Escape before interpolating. The reference template dropped `message`
 * straight into the HTML, which is fine for a demo page and not fine for
 * a name or a company field that a user typed. An OTP mail carrying
 * someone's `<script>` is a stored-XSS report waiting to happen in
 * whatever webmail renders it.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type TemplateInput = {
  toName?: string;
  /** Plain text. Newlines become <br>; everything is escaped first. */
  message: string;
  footerNote?: string;
  /** Absolute https URL. A relative path is silently dropped — see below. */
  actionUrl?: string | null;
  actionLabel?: string;
};

/**
 * Only http(s), and only absolute.
 *
 * Two separate reasons, both of which have bitten real systems:
 *
 *  * `javascript:` and `data:` in an href are a scripting vector in any
 *    mail client that renders them, and the URL here originates from a
 *    database row an administrator can edit.
 *  * A relative path cannot work in an email at all — there is no base
 *    to resolve it against. Rendering it anyway produces a button that
 *    looks clickable and goes nowhere, which is worse than no button,
 *    so it is dropped instead.
 */
function safeHref(value: string | null | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.toString();
}

/** The branded wrapper from the reference implementation, escaped. */
export function buildEmailHtml({
  toName,
  message,
  footerNote,
  actionUrl,
  actionLabel,
}: TemplateInput): string {
  const brand = escapeHtml(emailEnv().EMAIL_FROM_NAME);
  const greeting = escapeHtml(toName?.trim() || "there");
  const body = escapeHtml(message).replace(/\n/g, "<br>");
  const footer = escapeHtml(
    footerNote ??
      `This is an automated message from ${emailEnv().EMAIL_FROM_NAME}. Please do not reply to this email.`,
  );

  const href = safeHref(actionUrl);
  const action = href
    ? `<p style="margin:0 0 24px 0;">
                <a href="${escapeHtml(href)}" style="display:inline-block;background-color:#0891b2;color:#ffffff;font-size:15px;text-decoration:none;padding:12px 24px;border-radius:6px;">${escapeHtml(actionLabel ?? "Open in the portal")}</a>
              </p>
              <p style="font-size:12px;color:#64748b;margin:0 0 24px 0;word-break:break-all;">Or paste this into your browser: ${escapeHtml(href)}</p>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f8;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <tr>
            <td style="background-color:#0891b2;padding:24px 32px;">
              <span style="color:#ffffff;font-size:20px;font-weight:bold;">${brand}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="font-size:15px;color:#0f172a;margin:0 0 16px 0;">Dear ${greeting},</p>
              <div style="font-size:15px;color:#334155;line-height:1.6;margin:0 0 24px 0;">${body}</div>
              ${action}
              <p style="font-size:14px;color:#334155;margin:0;">Regards,<br>${brand}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background-color:#f1f5f9;border-top:1px solid #e2e8f0;">
              <p style="font-size:12px;color:#64748b;margin:0;">${footer}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export type SendEmailInput = {
  toEmail: string;
  toName?: string;
  subject: string;
  /** Plain text; the branded HTML is built around it. */
  message: string;
  /** Also send a copy to EMAIL_ADMIN_NOTIFY. */
  notifyAdmin?: boolean;
  /** Overrides the default small print. */
  footerNote?: string;
  /**
   * Absolute URL for the call-to-action button. Callers pass the result
   * of `absoluteUrl()` — a relative path is dropped rather than rendered
   * as a dead button.
   */
  actionUrl?: string | null;
  actionLabel?: string;
};

export async function sendEmail(input: SendEmailInput): Promise<SendOutcome> {
  const env = emailEnv();
  const html = buildEmailHtml({
    toName: input.toName,
    message: input.message,
    footerNote: input.footerNote,
    actionUrl: input.actionUrl,
    actionLabel: input.actionLabel,
  });

  if (!shouldReallySend()) {
    return {
      status: "SUPPRESSED",
      retryable: false,
      provider: "brevo",
      address: input.toEmail,
      response: {
        suppressed: "APP_ENV is not production and SMS_FORCE_SEND is off",
        subject: input.subject,
        wouldSend: input.message,
        // Surfaced in the suppressed payload so a dev run can prove the
        // link is absolute without sending anything.
        wouldLinkTo: input.actionUrl ?? null,
      },
    };
  }

  const outcome = await post({
    sender: { name: env.EMAIL_FROM_NAME, email: env.EMAIL_FROM },
    to: [{ email: input.toEmail, name: input.toName || input.toEmail }],
    subject: input.subject,
    htmlContent: html,
  });

  // The admin copy is best-effort on purpose. Failing the user's
  // registration because a CC to the office inbox bounced would be the
  // tail wagging the dog; the failure is recorded on the outcome.
  if (input.notifyAdmin && env.adminNotify && outcome.status === "SENT") {
    const copy = await post({
      sender: { name: env.EMAIL_FROM_NAME, email: env.EMAIL_FROM },
      to: [{ email: env.adminNotify, name: "Admin" }],
      subject: `[Copy] ${input.subject}`,
      htmlContent: buildEmailHtml({
        toName: "Admin",
        message: `Copy of email sent to: ${input.toEmail}\n\n${input.message}`,
        footerNote: `Admin notification from ${env.EMAIL_FROM_NAME}.`,
      }),
    });
    return {
      ...outcome,
      response: { main: outcome.response, adminCopy: copy.response ?? copy.error },
    };
  }

  return outcome;
}

async function post(payload: unknown): Promise<SendOutcome> {
  let raw: string;
  let httpStatus: number;
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": emailEnv().BREVO_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    httpStatus = response.status;
    raw = await response.text();
  } catch (error) {
    return {
      status: "FAILED",
      retryable: true,
      errorCode: "NETWORK",
      error: error instanceof Error ? error.message : String(error),
      provider: "brevo",
    };
  }

  const body = safeParse<{ messageId?: string; code?: string; message?: string }>(raw);

  if (httpStatus >= 200 && httpStatus < 300) {
    return {
      status: "SENT",
      retryable: false,
      provider: "brevo",
      providerMessageId: body?.messageId,
      response: body ?? { raw },
    };
  }

  // 401 is a bad key, 400 is a malformed payload or a blocked recipient.
  // Neither improves on retry. 429 and 5xx do.
  const retryable = httpStatus === 429 || httpStatus >= 500;
  return {
    status: "FAILED",
    retryable,
    errorCode: body?.code ?? `HTTP_${httpStatus}`,
    error: body?.message ?? raw.slice(0, 300),
    provider: "brevo",
    response: body ?? { raw },
  };
}

function safeParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
