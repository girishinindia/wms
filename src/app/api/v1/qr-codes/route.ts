import type { NextRequest } from "next/server";

import { handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { cartonQueue } from "@/lib/inward/cartons";
import { respondError } from "@/lib/inward/http";
import { scopeFor } from "@/lib/inward/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/qr-codes?q=&completed=1 — the inwards whose cartons the
 * caller can number, print and scan now (the "QR codes" menu).
 * Super admin, warehouse admin, inward manager: `inward.goods.update`.
 */
export async function GET(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor, grant } = await requirePermission("inward.goods.update", { entityType: "inward_request" });
      const params = request.nextUrl.searchParams;
      return ok(
        await cartonQueue(actor, scopeFor(actor, grant), {
          q: params.get("q") ?? "",
          completed: params.get("completed") === "1",
        }),
        requestId,
      );
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}
