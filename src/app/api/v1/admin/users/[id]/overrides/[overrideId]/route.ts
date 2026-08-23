import { type NextRequest } from "next/server";

import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { liftOverride, RoleError } from "@/lib/roles/matrix";
import { mayManageUser } from "@/lib/users/authority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE one exception — lift it.
 *
 * The row is revoked rather than removed, so "why could they do that in
 * March" is still answerable in June.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; overrideId: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { id: rawUser, overrideId: rawOverride } = await context.params;
      const userId = Number(rawUser);
      const overrideId = Number(rawOverride);
      if (
        !Number.isInteger(userId) || userId <= 0 ||
        !Number.isInteger(overrideId) || overrideId <= 0
      ) {
        return fail("NOT_FOUND", "No such exception", requestId);
      }

      const { actor } = await requirePermission("role.assign", {
        entityType: "user",
        entityId: String(userId),
      });
      const may = await mayManageUser(actor, userId);
      if (may !== true) return fail("FORBIDDEN", may.reason, requestId);

      await liftOverride(actor, userId, overrideId, {
        requestId,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
      });

      return ok({ ok: true as const }, requestId);
    } catch (error) {
      if (error instanceof RoleError) return fail(error.kind, error.message, requestId);
      return toResponse(error, requestId);
    }
  })();
}
