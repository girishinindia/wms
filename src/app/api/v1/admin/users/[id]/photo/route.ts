import { type NextRequest } from "next/server";

import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { clearUserPhoto, MAX_BYTES, PhotoError, setUserPhoto } from "@/lib/users/photo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST / DELETE /api/v1/admin/users/[id]/photo — somebody else's picture.
 *
 * The counterpart to `/api/v1/profile/photo`, and separate for the same
 * reason the name routes are separate: this one takes an id from the URL
 * and has to prove the caller may act on it, while the self route reads
 * the id off the session and cannot be pointed anywhere.
 *
 * A photo is not a credential — unlike email, mobile and password, which
 * change only through the owner's own verified flows, this is the sort
 * of thing an operator legitimately fixes for somebody (a wrong picture,
 * an unsuitable one). It is guarded on `user.update`, and an OWN-scoped
 * grant covers only the caller themselves.
 */
async function targetFrom(context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handler(async ({ requestId }) => {
    try {
      const targetUserId = await targetFrom(context);
      if (targetUserId === null) return fail("VALIDATION_FAILED", "Bad user id", requestId);

      const { actor, grant } = await requirePermission("user.update", {
        entityType: "user",
        entityId: String(targetUserId),
      });
      if (grant.scope === "OWN" && targetUserId !== actor.session.userId) {
        return fail("FORBIDDEN", "You do not have permission to do that.", requestId);
      }
      const declared = Number(request.headers.get("content-length") ?? 0);
      if (declared > MAX_BYTES) {
        return fail("VALIDATION_FAILED", `That image is over ${Math.round(MAX_BYTES / 1024)} KB`, requestId);
      }
      const bytes = new Uint8Array(await request.arrayBuffer());
      const result = await setUserPhoto(targetUserId, bytes, actor, {
        requestId,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
      });
      return ok(result, requestId);
    } catch (error) {
      if (error instanceof PhotoError) return fail(error.kind, error.message, requestId);
      return toResponse(error, requestId);
    }
  })();
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handler(async ({ requestId }) => {
    try {
      const targetUserId = await targetFrom(context);
      if (targetUserId === null) return fail("VALIDATION_FAILED", "Bad user id", requestId);

      const { actor, grant } = await requirePermission("user.update", {
        entityType: "user",
        entityId: String(targetUserId),
      });
      if (grant.scope === "OWN" && targetUserId !== actor.session.userId) {
        return fail("FORBIDDEN", "You do not have permission to do that.", requestId);
      }
      const result = await clearUserPhoto(targetUserId, actor, {
        requestId,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
      });
      return ok(result, requestId);
    } catch (error) {
      if (error instanceof PhotoError) return fail(error.kind, error.message, requestId);
      return toResponse(error, requestId);
    }
  })();
}
