import { type NextRequest } from "next/server";

import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { getPublicWarehouse } from "@/lib/warehouses/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/site/warehouses/[code] — one public site in full, for a
 * native client.
 *
 * `getPublicWarehouse` returns null for "no such code", "switched off"
 * and "deleted" alike, and all three become the same NOT_FOUND here —
 * exactly as the web page turns them into the same 404, so a stranger
 * cannot confirm that a hidden code exists. The contact person is a
 * name only; no phone number crosses this boundary.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { code } = await context.params;
      const warehouse = await getPublicWarehouse(code);
      if (!warehouse) return fail("NOT_FOUND", "No such warehouse", requestId);
      return ok(warehouse, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
