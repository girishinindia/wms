import { type NextRequest } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  activateSelfRegistration,
  findAccount,
  markVerified,
  pendingImporterFor,
} from "@/lib/auth/account";
import { purposeFor } from "@/lib/auth/dispatch-otp";
import { verifyOtpPair } from "@/lib/auth/otp";
import { clientIp, limitAuthAttempt, limitOrAllow } from "@/lib/auth/ratelimit";
import { auditQuietly } from "@/lib/audit";
import { otpEnv } from "@/lib/env";
import { fail, fieldsFrom, handler, ok, toResponse, HandledError } from "@/lib/api/respond";
import { otpVerifyRequestSchema } from "@/lib/validation/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/auth/otp/verify
 *
 * Unlike /send, this one does NOT hide whether the code was right — it
 * cannot, that is the whole answer. What it hides is whether the account
 * exists: an unknown identifier gets the same OTP_INVALID as a real
 * account with a wrong code.
 *
 * On a completed passwordRecovery it mints a short-lived reset token.
 * That token is what /password/reset consumes, so the reset endpoint
 * never has to re-check an OTP that was already spent — and the OTP
 * itself, which the user may still have in a text message, cannot be
 * replayed against it.
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

    const parsed = otpVerifyRequestSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
        fields: fieldsFrom(parsed.error),
      });
    }
    const input = parsed.data;
    const identifier = input.identifier.trim().toLowerCase();
    const INVALID = "That code is not valid. Check it and try again.";

    try {
      const limit = await limitOrAllow(() => limitAuthAttempt({ ip, account: identifier }));
      if (!limit.allowed) {
        throw new HandledError("RATE_LIMITED", "Too many attempts. Please try again shortly.", {
          retryAfter: limit.retryAfter,
        });
      }

      const account = await findAccount(identifier);
      if (!account) {
        await auditQuietly({
          action: "auth.otp.verify", operation: "DENY", entityType: "user",
          entityId: identifier, result: "DENIED", reason: "no such account",
          ip, userAgent, requestId,
        });
        throw new HandledError("OTP_INVALID", INVALID);
      }

      const entries = ([
        ["EMAIL", input.emailCode],
        ["SMS", input.smsCode],
      ] as const)
        .filter(([, code]) => Boolean(code))
        .map(([channel, code]) => ({
          channel,
          code: code!,
          purpose: purposeFor(input.purpose, channel),
        }));

      // All or nothing. One correct code must not be burned because the
      // other one had a typo in it — see verifyOtpPair.
      const outcome = await verifyOtpPair({ userId: account.id, entries });

      if (!outcome.ok) {
        await auditQuietly({
          action: "auth.otp.verify", operation: "DENY", entityType: "user",
          entityId: String(account.id), entityLabel: account.email,
          actorUserId: account.id, result: "DENIED",
          reason:
            "code rejected: " +
            outcome.failures.map((f) => `${f.channel}=${f.reason}`).join(", "),
          ip, userAgent, requestId, metadata: { purpose: input.purpose },
        });
        const worst = outcome.failures[0].reason;
        if (worst === "EXPIRED") {
          throw new HandledError("OTP_EXPIRED", "That code has expired. Request a new one.");
        }
        if (worst === "TOO_MANY_ATTEMPTS") {
          throw new HandledError(
            "OTP_ATTEMPTS_EXCEEDED",
            "Too many incorrect attempts. Request a new code.",
          );
        }
        throw new HandledError(
          "OTP_INVALID",
          outcome.failures.length === 1
            ? `The ${outcome.failures[0].channel === "EMAIL" ? "email" : "mobile"} code is not valid. Check it and try again.`
            : INVALID,
        );
      }

      const results = outcome.verified.map((channel) => ({ channel, ok: true }));
      for (const channel of outcome.verified) await markVerified(account.id, channel);

      // Re-read: markVerified may have set one or both timestamps.
      const after = await findAccount(identifier);
      const emailVerified = after?.emailVerifiedAt !== null && after?.emailVerifiedAt !== undefined;
      const mobileVerified =
        after?.mobileVerifiedAt !== null && after?.mobileVerifiedAt !== undefined;

      const needsBoth = env.OTP_REQUIRE_BOTH_CHANNELS;
      const complete =
        input.purpose === "registration"
          ? needsBoth
            ? emailVerified && mobileVerified
            : emailVerified || mobileVerified
          : results.length > 0;

      // Both channels proven: this is the point the account becomes real.
      //
      // Activation and the role go on together, in one statement. An
      // ACTIVE account with no role can sign in and see nothing; a role
      // on a still-PENDING account is a permission granted to something
      // unverified. Neither half is worth having alone.
      //
      // It is also the point of no return: IMPORTER is immutable, so
      // after this nobody — Super Admin included — can change or revoke
      // it. That is precisely why it waits until both codes are proven.
      let activation: { activated: boolean; roleAssigned: boolean } | undefined;
      let importerCode: string | undefined;
      if (input.purpose === "registration" && complete) {
        const importer = await pendingImporterFor(account.email);
        if (!importer) {
          throw new HandledError(
            "INTERNAL",
            "This registration has no importer record. Please start again.",
          );
        }
        importerCode = importer.code;
        activation = await activateSelfRegistration({
          userId: account.id,
          importerId: importer.id,
        });
      }

      let resetToken: string | undefined;
      if (input.purpose === "passwordRecovery" && complete) {
        resetToken = await mintResetToken(account.id, ip);
      }

      await auditQuietly({
        action: "auth.otp.verify", operation: "UPDATE", entityType: "user",
        entityId: String(account.id), entityLabel: account.email,
        actorUserId: account.id, actorEmail: account.email,
        before: {
          email_verified: account.emailVerifiedAt !== null,
          mobile_verified: account.mobileVerifiedAt !== null,
        },
        after: { email_verified: emailVerified, mobile_verified: mobileVerified },
        ip, userAgent, requestId, correlationId: requestId,
        metadata: {
          purpose: input.purpose,
          channels: results.map((r) => r.channel),
          issuedResetToken: resetToken !== undefined,
          ...(activation
            ? {
                activated: activation.activated,
                importerRoleAssigned: activation.roleAssigned,
                importerCode,
              }
            : {}),
        },
      });

      return ok(
        {
          emailVerified,
          mobileVerified,
          complete,
          ...(activation
            ? { roleAssigned: activation.roleAssigned, importerCode }
            : {}),
          ...(resetToken ? { resetToken } : {}),
        },
        requestId,
      );
    } catch (error) {
      return toResponse(error, requestId);
    }
  }, { minMillis: 300 })();
}

/**
 * A single-use reset ticket, stored hashed like everything else.
 *
 * Short TTL — five minutes — because it is handed straight to the reset
 * form, not emailed. It reuses `user_verification_token` rather than
 * introducing a table, so consumption, expiry and audit all behave the
 * same way as an OTP.
 */
async function mintResetToken(userId: number, ip: string | null): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await getDb().execute(sql`
    insert into wms.user_verification_token
      (user_id, purpose, token_hash, sent_to, channel, max_attempts, expires_at, ip)
    values (${userId}, 'PASSWORD_RESET',
            ${createHash("sha256").update(token).digest("hex")},
            'reset-ticket', 'EMAIL', 1, now() + interval '5 minutes', ${ip}::inet)
  `);
  return token;
}
