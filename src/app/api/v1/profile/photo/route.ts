import { type NextRequest } from "next/server";

import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { requireActor } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { clearUserPhoto, MAX_BYTES, PhotoError, setUserPhoto } from "@/lib/users/photo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST / DELETE /api/v1/profile/photo — my own picture.
 *
 * A session is the whole guard, and it has to be: a SALES_AGENT holds no
 * `user.update` at any scope, so an endpoint keyed on that permission
 * would leave every field agent unable to set their own photo. Same
 * reasoning as `PATCH /api/v1/profile`, which changes your own name on a
 * session alone.
 *
 * The body is the image itself, not a form — the browser has already
 * cropped and encoded it, so there is nothing else to carry. Its bytes
 * are read and checked in `photo.ts`; the content-type header is a hint
 * and is treated as one.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const actor = await requireActor();
      const declared = Number(request.headers.get("content-length") ?? 0);
      if (declared > MAX_BYTES) {
        return fail("VALIDATION_FAILED", `That image is over ${Math.round(MAX_BYTES / 1024)} KB`, requestId);
      }
      const bytes = new Uint8Array(await request.arrayBuffer());
      const result = await setUserPhoto(actor.session.userId, bytes, actor, {
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

export async function DELETE(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const actor = await requireActor();
      const result = await clearUserPhoto(actor.session.userId, actor, {
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
