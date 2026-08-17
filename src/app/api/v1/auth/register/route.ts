import { NextResponse, type NextRequest } from "next/server";

import { createSelfRegistration, findAccount } from "@/lib/auth/account";
import { dispatchOtp } from "@/lib/auth/dispatch-otp";
import { hashPassword } from "@/lib/auth/password";
import { clientIp, limitAuthAttempt, limitOrAllow } from "@/lib/auth/ratelimit";
import { shouldBlock, verifyRecaptcha } from "@/lib/auth/recaptcha";
import { auditQuietly } from "@/lib/audit";
import {
  fail,
  fieldsFrom,
  handler,
  ok,
  toResponse,
  HandledError,
} from "@/lib/api/respond";
import { registerRequestSchema } from "@/lib/validation/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/auth/register — self-registering importer.
 *
 * Answers identically whether or not the email is already taken. A
 * signup form that says "this address is registered" is a free account
 * enumerator, and the information is worth less than the addresses it
 * leaks: a real returning user is told the same thing by the email they
 * receive, which for an existing account says "you already have one".
 *
 * NO ROLE IS ASSIGNED. `IMPORTER` is exclusive and immutable, so
 * granting it to an unverified signup makes a mistyped email permanent.
 * See account.ts.
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

    const parsed = registerRequestSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
        fields: fieldsFrom(parsed.error),
      });
    }
    const input = parsed.data;

    try {
      const limit = await limitOrAllow(() =>
        limitAuthAttempt({ ip, account: input.email }),
      );
      if (!limit.allowed) {
        await auditQuietly({
          action: "auth.register", operation: "DENY", entityType: "user",
          entityId: input.email, result: "DENIED", reason: "rate limited",
          ip, userAgent, requestId,
          metadata: { scope: limit.scope, retryAfter: limit.retryAfter },
        });
        throw new HandledError("RATE_LIMITED", "Too many attempts. Please try again shortly.", {
          retryAfter: limit.retryAfter,
        });
      }

      const captcha = await verifyRecaptcha(input.captchaToken, "register", ip);
      if (shouldBlock(captcha)) {
        await auditQuietly({
          action: "auth.register", operation: "DENY", entityType: "user",
          entityId: input.email, result: "DENIED", reason: "captcha rejected",
          ip, userAgent, requestId,
          metadata: { captcha: captcha.ok ? "ok" : captcha.reason },
        });
        throw new HandledError("CAPTCHA_FAILED", "We could not verify that you are human.");
      }

      const created = await createSelfRegistration({
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        mobile: input.mobile,
        companyName: input.companyName,
        passwordHash: await hashPassword(input.password),
      });

      if (!created) {
        // Address already in use. Logged as a real event — repeated hits
        // on one address are worth seeing — but answered like a success.
        const existing = await findAccount(input.email);
        await auditQuietly({
          action: "auth.register", operation: "DENY", entityType: "user",
          entityId: input.email, result: "DENIED", reason: "identifier already registered",
          ip, userAgent, requestId,
          metadata: { emailOrMobileTaken: true },
        });
        return ok(
          {
            userId: existing?.id ?? 0,
            verificationRequired: true as const,
            channels: ["EMAIL", "SMS"],
            expiresInSeconds: 0,
            resendAfterSeconds: 0,
          },
          requestId,
          201,
        );
      }

      const dispatched = await dispatchOtp({
        userId: created.id,
        purpose: "registration",
        firstName: input.firstName,
        email: input.email,
        mobile: input.mobile,
        ip,
        correlationId: requestId,
      });

      await auditQuietly({
        action: "auth.register", operation: "INSERT", entityType: "user",
        entityId: String(created.id), entityLabel: input.email,
        actorUserId: created.id, actorName: `${input.firstName} ${input.lastName}`,
        actorEmail: input.email,
        after: {
          email: input.email, mobile: input.mobile,
          signup_company_name: input.companyName, status: "PENDING",
        },
        ip, userAgent, requestId, correlationId: requestId,
        metadata: { delivery: dispatched.delivery, captcha: captcha.ok ? "ok" : captcha.reason },
      });

      return ok(
        {
          userId: created.id,
          verificationRequired: true as const,
          channels: dispatched.channels,
          expiresInSeconds: dispatched.expiresInSeconds,
          resendAfterSeconds: dispatched.resendAfterSeconds,
        },
        requestId,
        201,
      );
    } catch (error) {
      return toResponse(error, requestId);
    }
    // Floor covers the difference between "created and sent two messages"
    // and "already exists, returned immediately".
  }, { minMillis: 700 })();
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "Use POST" } }, { status: 405 });
}
