import { type NextRequest } from "next/server";

import { findAccount } from "@/lib/auth/account";
import { dispatchOtp, purposeFor } from "@/lib/auth/dispatch-otp";
import { resendCooldownRemaining } from "@/lib/auth/otp";
import { clientIp, limitOrAllow, limitOtpSend } from "@/lib/auth/ratelimit";
import { shouldBlock, verifyRecaptcha } from "@/lib/auth/recaptcha";
import { auditQuietly } from "@/lib/audit";
import { otpEnv } from "@/lib/env";
import { fail, fieldsFrom, handler, ok, toResponse, HandledError } from "@/lib/api/respond";
import { otpSendRequestSchema } from "@/lib/validation/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/auth/otp/send — issue and send codes.
 *
 * Always answers `{ sent: true }`. An endpoint that says "no such
 * account" is an enumerator, and this one is unauthenticated by
 * definition, so the answer cannot depend on whether the account exists.
 *
 * Two limits, and they do different jobs:
 *   - the per-send COOLDOWN lives in Postgres, keyed off the last token
 *     row, so it survives a Redis eviction;
 *   - the DAILY CAP lives in Upstash, because that is a counter, not a
 *     timestamp, and every send spends real SMS credit.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    const ip = clientIp(request.headers);
    const userAgent = request.headers.get("user-agent");
    const env = otpEnv();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
    }

    const parsed = otpSendRequestSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
        fields: fieldsFrom(parsed.error),
      });
    }
    const input = parsed.data;
    const identifier = input.identifier.trim().toLowerCase();

    /** What every caller sees, account or not. */
    const SILENT = {
      sent: true as const,
      channels: input.channel ? [input.channel] : (["EMAIL", "SMS"] as const),
      expiresInSeconds: env.OTP_TTL_SECONDS,
      resendAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS,
    };

    try {
      const captcha = await verifyRecaptcha(input.captchaToken, "otp_send", ip);
      if (shouldBlock(captcha)) {
        await auditQuietly({
          action: "auth.otp.send", operation: "DENY", entityType: "user",
          entityId: identifier, result: "DENIED", reason: "captcha rejected",
          ip, userAgent, requestId,
        });
        throw new HandledError("CAPTCHA_FAILED", "We could not verify that you are human.");
      }

      const cap = await limitOrAllow(() => limitOtpSend(identifier));
      if (!cap.allowed) {
        await auditQuietly({
          action: "auth.otp.send", operation: "DENY", entityType: "user",
          entityId: identifier, result: "DENIED", reason: "daily OTP cap reached",
          ip, userAgent, requestId, metadata: { purpose: input.purpose },
        });
        throw new HandledError(
          "RATE_LIMITED",
          "You have requested too many codes today. Please try again tomorrow.",
          { retryAfter: cap.retryAfter },
        );
      }

      const account = await findAccount(identifier);
      if (!account) {
        await auditQuietly({
          action: "auth.otp.send", operation: "DENY", entityType: "user",
          entityId: identifier, result: "DENIED", reason: "no such account",
          ip, userAgent, requestId, metadata: { purpose: input.purpose },
        });
        return ok(SILENT, requestId);
      }

      const channels: Array<"EMAIL" | "SMS"> = input.channel
        ? [input.channel]
        : ["EMAIL", "SMS"];
      const waits = await Promise.all(
        channels.map((channel) =>
          resendCooldownRemaining({
            userId: account.id,
            purpose: purposeFor(input.purpose, channel),
            channel,
          }),
        ),
      );
      const wait = Math.max(0, ...waits);
      if (wait > 0) {
        // Told plainly: the user pressed resend and needs to know how
        // long, and the account is already known to exist to whoever is
        // holding the form.
        throw new HandledError(
          "RESEND_TOO_SOON",
          `Please wait ${wait} second${wait === 1 ? "" : "s"} before requesting another code.`,
          { retryAfter: wait },
        );
      }

      const dispatched = await dispatchOtp({
        userId: account.id,
        purpose: input.purpose,
        firstName: account.firstName,
        email: account.email,
        mobile: account.mobile,
        only: input.channel,
        ip,
        correlationId: requestId,
      });

      await auditQuietly({
        action: "auth.otp.send", operation: "UPDATE", entityType: "user",
        entityId: String(account.id), entityLabel: account.email,
        actorUserId: account.id, actorEmail: account.email,
        ip, userAgent, requestId, correlationId: requestId,
        metadata: { purpose: input.purpose, delivery: dispatched.delivery },
      });

      return ok(
        {
          sent: true as const,
          channels: dispatched.channels,
          expiresInSeconds: dispatched.expiresInSeconds,
          resendAfterSeconds: dispatched.resendAfterSeconds,
        },
        requestId,
      );
    } catch (error) {
      return toResponse(error, requestId);
    }
  }, { minMillis: 600 })();
}
