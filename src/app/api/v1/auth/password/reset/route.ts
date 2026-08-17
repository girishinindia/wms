import { type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { setPassword } from "@/lib/auth/account";
import { consumeAllOtps } from "@/lib/auth/otp";
import { hashPassword } from "@/lib/auth/password";
import { clientIp, limitAuthAttempt, limitOrAllow } from "@/lib/auth/ratelimit";
import { revokeAllSessions } from "@/lib/auth/session";
import { auditQuietly } from "@/lib/audit";
import { fail, fieldsFrom, handler, ok, toResponse, HandledError } from "@/lib/api/respond";
import { resetPasswordRequestSchema } from "@/lib/validation/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/auth/password/reset
 *
 * Consumes the reset ticket minted by /otp/verify — not the OTP itself.
 * The OTP is still sitting in the user's inbox and text messages; the
 * ticket is short-lived, single-use and never leaves the browser it was
 * issued to.
 *
 * `confirmPassword` is checked by the Zod schema, server-side. The
 * browser check is a convenience; a native client that never renders a
 * confirm field would otherwise bypass it entirely.
 *
 * Every other session is revoked. If the reason somebody reset their
 * password is that someone else had it, leaving that person's session
 * alive defeats the entire exercise — and this is the single most common
 * way a "successful" password reset achieves nothing at all.
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

    const parsed = resetPasswordRequestSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
        fields: fieldsFrom(parsed.error),
      });
    }

    try {
      const limit = await limitOrAllow(() => limitAuthAttempt({ ip }));
      if (!limit.allowed) {
        throw new HandledError("RATE_LIMITED", "Too many attempts. Please try again shortly.", {
          retryAfter: limit.retryAfter,
        });
      }

      // Consume in the same statement that validates, so two concurrent
      // requests cannot both spend one ticket.
      const hash = createHash("sha256").update(parsed.data.resetToken).digest("hex");
      const rows = await getDb().execute<{ user_id: number; email: string }>(sql`
        update wms.user_verification_token t
           set consumed_at = now(), attempts = t.attempts + 1
          from wms.users u
         where t.token_hash = ${hash}
           and t.purpose = 'PASSWORD_RESET'
           and t.sent_to = 'reset-ticket'
           and t.consumed_at is null
           and t.expires_at > now()
           and u.id = t.user_id
           and u.deleted_at is null
        returning t.user_id, u.email::text as email
      `);

      const ticket = rows[0];
      if (!ticket) {
        await auditQuietly({
          action: "auth.password.reset", operation: "DENY", entityType: "user",
          entityId: "unknown", result: "DENIED",
          reason: "reset ticket invalid, expired or already used",
          ip, userAgent, requestId,
        });
        throw new HandledError(
          "OTP_EXPIRED",
          "That reset link has expired or was already used. Start again.",
        );
      }

      await setPassword(ticket.user_id, await hashPassword(parsed.data.newPassword));
      // Any other live codes are now meaningless and must not be usable.
      await consumeAllOtps(ticket.user_id);
      const revoked = await revokeAllSessions(ticket.user_id, "password reset");

      await auditQuietly({
        action: "auth.password.reset", operation: "UPDATE", entityType: "user",
        entityId: String(ticket.user_id), entityLabel: ticket.email,
        actorUserId: ticket.user_id, actorEmail: ticket.email,
        // The hash itself never goes in the log; that it changed does.
        before: { password_changed: false },
        after: { password_changed: true },
        ip, userAgent, requestId, correlationId: requestId,
        metadata: { sessionsRevoked: revoked },
      });

      return ok({ sessionsRevoked: revoked }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  }, { minMillis: 400 })();
}
