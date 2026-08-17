import { type NextRequest } from "next/server";
import { cookies } from "next/headers";

import {
  findAccount,
  recordFailedLogin,
  recordSuccessfulLogin,
  rolesFor,
} from "@/lib/auth/account";
import { fakeVerify, needsRehash, hashPassword, verifyPassword } from "@/lib/auth/password";
import { clientIp, limitAuthAttempt, limitOrAllow } from "@/lib/auth/ratelimit";
import { shouldBlock, verifyRecaptcha } from "@/lib/auth/recaptcha";
import { issueSession, sessionCookieOptions } from "@/lib/auth/session";
import { setPassword } from "@/lib/auth/account";
import { auditQuietly } from "@/lib/audit";
import { authEnv } from "@/lib/env";
import { fail, fieldsFrom, handler, ok, toResponse, HandledError } from "@/lib/api/respond";
import { loginRequestSchema } from "@/lib/validation/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/auth/login — password only.
 *
 * No OTP on everyday sign-in: warehouse staff sign in at the start of
 * each shift, and a code per shift is friction that gets worked around
 * (shared handsets, written-down codes) rather than tolerated. The
 * controls that carry the weight instead are argon2id, escalating
 * lockout, and per-IP AND per-account rate limits.
 *
 * Every failure path answers the SAME message and takes the SAME time:
 *   - no such account
 *   - account exists, wrong password
 *   - account exists, no password set
 * Distinguishing them is an account enumerator. `fakeVerify()` burns the
 * hashing time for the paths with no hash to check, and the handler's
 * `minMillis` floor covers the rest.
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

    const parsed = loginRequestSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
        fields: fieldsFrom(parsed.error),
      });
    }
    const input = parsed.data;
    const identifier = input.identifier.trim().toLowerCase();

    /** One message for every credential failure. */
    const REJECT = "Email, mobile number or password is incorrect";

    try {
      const limit = await limitOrAllow(() => limitAuthAttempt({ ip, account: identifier }));
      if (!limit.allowed) {
        await auditQuietly({
          action: "auth.login", operation: "DENY", entityType: "user",
          entityId: identifier, result: "DENIED", reason: "rate limited",
          ip, userAgent, requestId, metadata: { scope: limit.scope },
        });
        throw new HandledError("RATE_LIMITED", "Too many attempts. Please try again shortly.", {
          retryAfter: limit.retryAfter,
        });
      }

      const captcha = await verifyRecaptcha(input.captchaToken, "login", ip);
      if (shouldBlock(captcha)) {
        await auditQuietly({
          action: "auth.login", operation: "DENY", entityType: "user",
          entityId: identifier, result: "DENIED", reason: "captcha rejected",
          ip, userAgent, requestId,
        });
        throw new HandledError("CAPTCHA_FAILED", "We could not verify that you are human.");
      }

      const account = await findAccount(identifier);

      if (!account || !account.passwordHash) {
        // Spend the hashing time anyway, or an unknown address answers in
        // 3ms while a real one takes 90ms.
        await fakeVerify();
        await auditQuietly({
          action: "auth.login", operation: "DENY", entityType: "user",
          entityId: identifier, result: "DENIED",
          reason: account ? "no password set" : "no such account",
          ip, userAgent, requestId,
        });
        throw new HandledError("INVALID_CREDENTIALS", REJECT);
      }

      if (account.lockedUntil && account.lockedUntil > new Date()) {
        await fakeVerify();
        const seconds = Math.ceil((account.lockedUntil.getTime() - Date.now()) / 1000);
        await auditQuietly({
          action: "auth.login", operation: "DENY", entityType: "user",
          entityId: String(account.id), entityLabel: account.email,
          result: "DENIED", reason: "account locked",
          ip, userAgent, requestId, metadata: { lockedUntil: account.lockedUntil.toISOString() },
        });
        // Told plainly, unlike a wrong password: the user cannot fix this
        // by trying harder, and hiding it just produces support calls.
        throw new HandledError(
          "ACCOUNT_LOCKED",
          "This account is temporarily locked after too many failed attempts.",
          { retryAfter: seconds },
        );
      }

      const valid = await verifyPassword(input.password, account.passwordHash);
      if (!valid) {
        const { failures, lockedUntil } = await recordFailedLogin(account.id);
        await auditQuietly({
          action: "auth.login", operation: "DENY", entityType: "user",
          entityId: String(account.id), entityLabel: account.email,
          result: "DENIED", reason: "wrong password",
          ip, userAgent, requestId,
          metadata: { failures, lockedUntil: lockedUntil?.toISOString() ?? null },
        });
        throw new HandledError("INVALID_CREDENTIALS", REJECT);
      }

      if (account.status !== "ACTIVE") {
        await auditQuietly({
          action: "auth.login", operation: "DENY", entityType: "user",
          entityId: String(account.id), entityLabel: account.email,
          result: "DENIED", reason: `account status ${account.status}`,
          ip, userAgent, requestId,
        });
        throw new HandledError(
          "ACCOUNT_INACTIVE",
          account.status === "PENDING"
            ? "Verify your email and mobile number before signing in."
            : "This account is not active. Contact your administrator.",
        );
      }

      // The password was correct and is in hand — the only moment a
      // weaker hash can be upgraded without asking the user for anything.
      if (needsRehash(account.passwordHash)) {
        await setPassword(account.id, await hashPassword(input.password));
      }

      const session = await issueSession(account.id, {
        ip, userAgent,
        deviceName: input.deviceName ?? null,
        platform: input.platform ?? "WEB",
      });
      await recordSuccessfulLogin(account.id, ip);

      const env = authEnv();
      const store = await cookies();
      store.set({
        ...sessionCookieOptions(env.AUTH_SESSION_ABSOLUTE_TTL),
        value: session.token,
      });

      await auditQuietly({
        action: "auth.login", operation: "LOGIN", entityType: "user",
        entityId: String(account.id), entityLabel: account.email,
        actorUserId: account.id, actorEmail: account.email,
        actorName: `${account.firstName} ${account.lastName}`,
        ip, userAgent, requestId, correlationId: requestId,
        metadata: { sessionId: session.sessionId, platform: input.platform ?? "WEB" },
      });

      return ok(
        {
          user: {
            id: account.id,
            email: account.email,
            firstName: account.firstName,
            lastName: account.lastName,
            mobile: account.mobile,
            emailVerified: account.emailVerifiedAt !== null,
            mobileVerified: account.mobileVerifiedAt !== null,
            mustChangePassword: account.mustChangePassword,
            roles: await rolesFor(account.id),
          },
          expiresAt: session.expiresAt.toISOString(),
        },
        requestId,
      );
    } catch (error) {
      return toResponse(error, requestId);
    }
  }, { minMillis: 400 })();
}
