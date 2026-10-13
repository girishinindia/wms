import type { NextRequest } from "next/server";

import { fail, handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { idFrom, metaOf, respondError } from "@/lib/inward/http";
import { InwardError } from "@/lib/inward/ops";
import { attachLr } from "@/lib/outward/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/outward/{id}/lr?lrNo=&lrDate=YYYY-MM-DD&fileName=&replacesId= — the body is the LR photo or PDF (8 MB).
 * Attached after departure, the same day or days later.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handler(async ({ requestId }) => {
    try {
      const id = idFrom((await context.params).id);
      if (id === null) return fail("NOT_FOUND", "No such dispatch order", requestId);
      const { actor } = await requirePermission("lorry_receipt.create", { entityType: "dispatch_order", entityId: String(id) });
      if (Number(request.headers.get("content-length") ?? 0) > 8 * 1024 * 1024) {
        throw new InwardError("VALIDATION_FAILED", "That file is over 8 MB", { file: "That file is over 8 MB" });
      }
      const p = request.nextUrl.searchParams;
      const bytes = new Uint8Array(await request.arrayBuffer());
      const replaces = p.get("replacesId");
      const order = await attachLr(
        actor,
        id,
        {
          lrNo: p.get("lrNo") ?? "",
          lrDate: p.get("lrDate") ?? "",
          fileName: p.get("fileName"),
          replacesId: replaces ? idFrom(replaces) : null,
          transportName: p.get("transportName"),
          vehicleNo: p.get("vehicleNo"),
        },
        bytes,
        metaOf(request, requestId),
      );
      return ok({ order }, requestId);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}
