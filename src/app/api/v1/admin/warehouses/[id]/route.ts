import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { clientIp } from "@/lib/auth/ratelimit";
import { isUniqueViolation } from "@/lib/db-errors";
import { deleteWarehouse, updateWarehouse, WarehouseError } from "@/lib/warehouses/ops";
import { requirePlatformWarehouse } from "@/lib/warehouses/guard";
import { updateWarehouseSchema } from "@/lib/validation/api-warehouse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH  /api/v1/admin/warehouses/[id] — correct a site.
 * DELETE /api/v1/admin/warehouses/[id] — retire one.
 *
 * The delete is soft and is refused while staff or transporters are
 * still attached: a warehouse is not a master row, people are posted to
 * it, and removing one out from under a live role assignment takes away
 * somebody's access rather than tidying a list. Its gallery photos are
 * deleted for good, because a file nothing can reach is a file nobody
 * stops paying for.
 */
const idOf = async (context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handler(async ({ requestId }) => {
    try {
      const id = await idOf(context);
      if (id === null) return fail("VALIDATION_FAILED", "Bad warehouse id", requestId);
      const { actor } = await requirePlatformWarehouse("warehouse.update", String(id));

      const parsed = updateWarehouseSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      await updateWarehouse(id, parsed.data as Record<string, unknown>, actor, {
        requestId,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
      });
      return ok({ ok: true as const }, requestId);
    } catch (error) {
      if (error instanceof WarehouseError) {
        return fail(error.kind, error.message, requestId, error.fields ? { fields: error.fields } : undefined);
      }
      if (isUniqueViolation(error)) {
        return fail("CONFLICT", "A warehouse with that code already exists", requestId);
      }
      return toResponse(error, requestId);
    }
  })();
}

const deleteSchema = z.object({ reason: z.string().trim().min(3).max(300) });

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handler(async ({ requestId }) => {
    try {
      const id = await idOf(context);
      if (id === null) return fail("VALIDATION_FAILED", "Bad warehouse id", requestId);
      const { actor } = await requirePlatformWarehouse("warehouse.delete", String(id));

      const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Give a short reason — it goes to the audit log", requestId);
      }
      await deleteWarehouse(id, actor, {
        requestId,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
      }, parsed.data.reason);
      return ok({ ok: true as const }, requestId);
    } catch (error) {
      if (error instanceof WarehouseError) {
        return fail(error.kind, error.message, requestId, error.fields ? { fields: error.fields } : undefined);
      }
      return toResponse(error, requestId);
    }
  })();
}
