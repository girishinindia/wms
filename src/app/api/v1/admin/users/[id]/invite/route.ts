import { type NextRequest } from "next/server";

import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp, limitInviteSend, limitOrAllow } from "@/lib/auth/ratelimit";
import { mayActOnUser } from "@/lib/users/authority";
import { InviteError, resendInvite } from "@/lib/users/invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/admin/users/[id]/invite — send sign-in details again.
 *
 * The answer to "I never got the email", and the only way back from a
 * send that was suppressed or bounced. It mints a NEW temporary
 * password rather than repeating the old one, because the old one only
 * exists as an argon2 hash — a system that can tell you a password back
 * is a system that stored it.
 *
 * Guarded by `user.create` rather than `user.update`, and the
 * distinction is not pedantry: this hands somebody a working credential,
 * which is the same act as creating the account. Anyone who may make an
 * account for this person may re-issue their password; being allowed to
 * edit a phone number is not the same permission.
 *
 * `mayActOnUser` then narrows it to the caller's own people — without
 * it a warehouse admin could re-issue a super admin's password and read
 * it out of their own inbox, which is a complete takeover through an
 * endpoint that looks like a convenience.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { id: rawId } = await context.params;
      const targetUserId = Number(rawId);
      if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        return fail("NOT_FOUND", "No such user", requestId);
      }

      const { actor } = await requirePermission("user.create", {
        entityType: "user",
        entityId: String(targetUserId),
      });

      const reach = await mayActOnUser(
        actor,
        targetUserId,
        "user.create",
        "send their sign-in details",
      );
      if (reach !== true) {
        return fail(reach.kind, reach.reason, requestId);
      }

      /**
       * Keyed on the target, so the limit follows the inbox being
       * filled rather than the person filling it. `limitOrAllow` fails
       * OPEN — a Redis blip must not stop an admin getting somebody
       * back into the system.
       */
      const limit = await limitOrAllow(() => limitInviteSend(targetUserId));
      if (!limit.allowed) {
        return fail(
          "RATE_LIMITED",
          `Sign-in details have just been sent to this account. Try again in ${Math.ceil(
            limit.retryAfter / 60,
          )} minutes.`,
          requestId,
        );
      }

      const result = await resendInvite(targetUserId, actor, {
        requestId,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
      });

      // The address and what happened to it. Never the password.
      return ok({ email: result.email, emailStatus: result.status }, requestId);
    } catch (error) {
      if (error instanceof InviteError) {
        return fail(error.kind, error.message, requestId);
      }
      return toResponse(error, requestId);
    }
  })();
}
