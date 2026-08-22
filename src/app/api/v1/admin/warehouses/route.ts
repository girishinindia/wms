import { type NextRequest } from "next/server";

import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { clientIp } from "@/lib/auth/ratelimit";
import { isUniqueViolation } from "@/lib/db-errors";
import { createWarehouse, WarehouseError } from "@/lib/warehouses/ops";
import { requirePlatformWarehouse } from "@/lib/warehouses/guard";
import { createWarehouseSchema } from "@/lib/validation/api-warehouse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/admin/warehouses — add a site.
 *
 * `code` is not accepted from the request: the column defaults to
 * WH-0001 from `warehouse_code_seq`, the way importers and sales agents
 * already work. A hand-typed value in a UNIQUE column is a collision
 * waiting for two people to add a warehouse on the same afternoon.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor } = await requirePlatformWarehouse("warehouse.create");

      const parsed = createWarehouseSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }

      const created = await createWarehouse(parsed.data as Record<string, unknown>, actor, {
        requestId,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
      });
      return ok(created, requestId, 201);
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
