import { type NextRequest } from "next/server";

import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { clientIp } from "@/lib/auth/ratelimit";
import { deleteWarehouseImage, WarehouseError } from "@/lib/warehouses/ops";
import { requirePlatformWarehouse } from "@/lib/warehouses/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/v1/admin/warehouses/[id]/images/[imageId]
 *
 * Takes the file off the CDN and then the row out of the table. Both
 * ids are in the WHERE clause, so a photo id from another warehouse
 * matches nothing rather than being deleted from under it.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; imageId: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { id, imageId } = await context.params;
      const warehouseId = Number(id);
      const image = Number(imageId);
      if (!Number.isInteger(warehouseId) || warehouseId <= 0 || !Number.isInteger(image) || image <= 0) {
        return fail("VALIDATION_FAILED", "Bad id", requestId);
      }
      const { actor } = await requirePlatformWarehouse("warehouse.update", String(warehouseId));

      await deleteWarehouseImage(warehouseId, image, actor, {
        requestId,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
      });
      return ok({ ok: true as const }, requestId);
    } catch (error) {
      if (error instanceof WarehouseError) return fail(error.kind, error.message, requestId);
      return toResponse(error, requestId);
    }
  })();
}
