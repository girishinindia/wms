import { type NextRequest } from "next/server";

import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { clientIp } from "@/lib/auth/ratelimit";
import { GALLERY_LIMITS } from "@/lib/images/webp";
import {
  addWarehouseImage,
  listWarehouseImages,
  publicImage,
  WarehouseError,
} from "@/lib/warehouses/ops";
import { requirePlatformWarehouse } from "@/lib/warehouses/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/v1/admin/warehouses/[id]/images — this warehouse's gallery.
 * POST /api/v1/admin/warehouses/[id]/images — add one photo to it.
 *
 * One gallery per warehouse, stored under `wms/gallery/<id>/`. The body
 * of a POST is the image itself: the browser has already resized and
 * re-encoded it to WebP, so there is nothing else to carry. Its bytes
 * are read and checked in `ops.ts` — the content-type header is a hint,
 * and is treated as one.
 */
const idOf = async (context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handler(async ({ requestId }) => {
    try {
      const id = await idOf(context);
      if (id === null) return fail("VALIDATION_FAILED", "Bad warehouse id", requestId);
      await requirePlatformWarehouse("warehouse.read", String(id));
      const images = await listWarehouseImages(id);
      return ok({ images: images.map(publicImage) }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handler(async ({ requestId }) => {
    try {
      const id = await idOf(context);
      if (id === null) return fail("VALIDATION_FAILED", "Bad warehouse id", requestId);
      const { actor } = await requirePlatformWarehouse("warehouse.update", String(id));

      const declared = Number(request.headers.get("content-length") ?? 0);
      if (declared > GALLERY_LIMITS.maxBytes) {
        return fail(
          "VALIDATION_FAILED",
          `That image is over ${Math.round(GALLERY_LIMITS.maxBytes / 1024)} KB`,
          requestId,
        );
      }
      const bytes = new Uint8Array(await request.arrayBuffer());
      const image = await addWarehouseImage(id, bytes, actor, {
        requestId,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
      });
      return ok(publicImage(image), requestId, 201);
    } catch (error) {
      if (error instanceof WarehouseError) return fail(error.kind, error.message, requestId);
      return toResponse(error, requestId);
    }
  })();
}
