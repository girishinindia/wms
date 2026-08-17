import { type NextRequest } from "next/server";

import { findAccountByEmailAndMobile } from "@/lib/auth/account";
import { dispatchOtp } from "@/lib/auth/dispatch-otp";
import { clientIp, limitOrAllow, limitOtpSend } from "@/lib/auth/ratelimit";
import { shouldBlock, verifyRecaptcha } from "@/lib/auth/recaptcha";
import { auditQuietly } from "@/lib/audit";
import { fail, fieldsFrom, handler, ok, toResponse, HandledError } from "@/lib/api/respond";
import { forgotPasswordRequestSchema } from "@/lib/validation/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/auth/password/forgot
 *
 * Takes the email AND the mobile, and they must belong to the SAME
 * account. Knowing somebody's email address is therefore not enough to
 * start a reset against them — an attacker needs the mobile number too,
 * and the codes then go to both channels.
 *
 * Answers `{ ok: true }` for every input, always. This is the classic
 * enumeration endpoint: anything that distinguishes "we sent you a code"
 * from "no such account" turns the login page into a directory of your
 * customers. A mismatched pair is treated exactly like a match.
 *
 * The uniform time floor matters as much as the uniform message —
 * "found, hashed, sent two messages" is otherwise hundreds of
 * milliseconds slower than "not found, returned".
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

    const parsed = forgotPasswordRequestSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
        fields: fieldsFrom(parsed.error),
      });
    }
    const email = parsed.data.email.trim().toLowerCase();
    const mobile = parsed.data.mobile.trim();
    // One rate-limit key for the pair, so trying many mobiles against one
    // email spends the same budget as trying many emails.
    const identifier = `${email}|${mobile}`;

    try {
      const captcha = await verifyRecaptcha(parsed.data.captchaToken, "forgot_password", ip);
      if (shouldBlock(captcha)) {
        await auditQuietly({
          action: "auth.password.forgot", operation: "DENY", entityType: "user",
          entityId: identifier, result: "DENIED", reason: "captcha rejected",
          ip, userAgent, requestId,
        });
        throw new HandledError("CAPTCHA_FAILED", "We could not verify that you are human.");
      }

      const cap = await limitOrAllow(() => limitOtpSend(identifier));
      if (!cap.allowed) {
        await auditQuietly({
          action: "auth.password.forgot", operation: "DENY", entityType: "user",
          entityId: identifier, result: "DENIED", reason: "daily OTP cap reached",
          ip, userAgent, requestId,
        });
        // Even this is a small leak — but a shared answer here would let
        // an attacker spend a real user's daily budget invisibly, which
        // is worse. The cap is per identifier, so reaching it already
        // required guessing that identifier repeatedly.
        throw new HandledError(
          "RATE_LIMITED",
          "Too many reset requests. Please try again later.",
          { retryAfter: cap.retryAfter },
        );
      }

      const account = await findAccountByEmailAndMobile(email, mobile);
      if (account && account.status !== "SUSPENDED") {
        const dispatched = await dispatchOtp({
          userId: account.id,
          purpose: "passwordRecovery",
          firstName: account.firstName,
          email: account.email,
          mobile: account.mobile,
          ip,
          correlationId: requestId,
        });
        await auditQuietly({
          action: "auth.password.forgot", operation: "UPDATE", entityType: "user",
          entityId: String(account.id), entityLabel: account.email,
          actorUserId: account.id, actorEmail: account.email,
          ip, userAgent, requestId, correlationId: requestId,
          metadata: { delivery: dispatched.delivery },
        });
      } else {
        await auditQuietly({
          action: "auth.password.forgot", operation: "DENY", entityType: "user",
          entityId: identifier, result: "DENIED",
          reason: account
            ? "account suspended"
            : "no account with that email and mobile together",
          ip, userAgent, requestId,
          metadata: { email, mobileGiven: true },
        });
      }

      return ok({ ok: true as const }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  }, { minMillis: 800 })();
}
