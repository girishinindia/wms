import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { getDb } from "@/db";
import { fail, fieldsFrom, handler, ok, toResponse, HandledError } from "@/lib/api/respond";
import { auditQuietly } from "@/lib/audit";
import { clientIp, limitAuthAttempt, limitOrAllow } from "@/lib/auth/ratelimit";
import { shouldBlock, verifyRecaptcha } from "@/lib/auth/recaptcha";
import { enquiryRequestSchema } from "@/lib/validation/contact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/contact — a message from the public contact form.
 *
 * The only unauthenticated write in the product, which is the whole of
 * what makes it interesting. There is no session to check, so the
 * guards are what is left: a rate limit keyed on the caller's address,
 * a schema that matches the table's CHECK constraints exactly, and a
 * captcha when one is configured.
 *
 * It answers 201 with nothing but an id. No echo of what was stored, no
 * "we already have a message from you" — a contact form that reports
 * what it knows about the sender is an enumeration tool.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    const ip = clientIp(request.headers);
    const userAgent = request.headers.get("user-agent");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
    }

    const parsed = enquiryRequestSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
        fields: fieldsFrom(parsed.error),
      });
    }
    const input = parsed.data;

    try {
      /**
       * Keyed on the address AND the email given.
       *
       * `limitAuthAttempt` takes both because either alone is weak: an
       * office behind one NAT is many people at one address, and an
       * attacker can invent a new email per request. Reusing the auth
       * limiter rather than inventing a bucket keeps one set of numbers
       * to tune, and the numbers already suit a form a person fills in
       * by hand.
       */
      const limit = await limitOrAllow(() =>
        limitAuthAttempt({ ip, account: input.email }),
      );
      if (!limit.allowed) {
        await auditQuietly({
          action: "enquiry.created", operation: "INSERT", entityType: "enquiry",
          entityId: input.email, result: "DENIED", reason: "rate limited",
          ip, userAgent, requestId,
          metadata: { scope: limit.scope, retryAfter: limit.retryAfter },
        });
        throw new HandledError(
          "RATE_LIMITED",
          "Too many messages from here just now. Please try again shortly.",
          { retryAfter: limit.retryAfter },
        );
      }

      /**
       * Captcha, but only where it can actually say something.
       *
       * `shouldBlock` refuses on INVALID as well as LOW_SCORE, and
       * INVALID is what "no token was submitted" looks like. There is
       * no client-side reCAPTCHA integration in this product yet — no
       * form mints a token, including sign-up — so honouring INVALID
       * here would mean that the day somebody sets RECAPTCHA_ENABLED,
       * every enquiry silently stops arriving and nothing says why.
       *
       * So: a real, scored verdict blocks. Anything else is recorded
       * and allowed through, with the rate limit above still standing.
       * When a token-minting client is added, this can go back to
       * `shouldBlock`.
       */
      const captcha = await verifyRecaptcha(input.captchaToken, "contact", ip);
      const scoredAgainstUs = !captcha.ok && captcha.reason === "LOW_SCORE";
      if (scoredAgainstUs && shouldBlock(captcha)) {
        await auditQuietly({
          action: "enquiry.created", operation: "INSERT", entityType: "enquiry",
          entityId: input.email, result: "DENIED", reason: "captcha",
          ip, userAgent, requestId,
          metadata: { reason: captcha.reason },
        });
        throw new HandledError(
          "FORBIDDEN",
          "We could not verify this request. Please try again, or email us directly.",
        );
      }
      if (!captcha.ok) {
        // Not a refusal — a note that the check did not give a verdict,
        // so a run of these is visible rather than invisible.
        console.warn("[contact] captcha inconclusive", { reason: captcha.reason, requestId });
      }

      const [row] = await getDb().execute<{ id: number }>(sql`
        insert into wms.enquiry (name, email, mobile, subject, message, ip, user_agent)
        values (${input.name}, ${input.email}, ${input.mobile},
                ${input.subject}, ${input.message}, ${ip}, ${userAgent})
        returning id`);

      /**
       * Audited with the subject but NOT the message.
       *
       * The audit log is read by every super admin and cannot be edited
       * or deleted. Copying a stranger's whole message into it puts the
       * same personal text in two places with different deletion rules
       * — and the enquiry screen is where it is meant to be read.
       */
      await auditQuietly({
        action: "enquiry.created", operation: "INSERT", entityType: "enquiry",
        entityId: String(row!.id), result: "SUCCESS",
        ip, userAgent, requestId,
        after: { name: input.name, email: input.email, mobile: input.mobile, subject: input.subject },
      });

      return ok({ id: row!.id }, requestId, 201);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
