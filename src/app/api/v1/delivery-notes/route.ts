import { deliveryRoute, queryNumber } from "@/lib/delivery/http";
import { dnScope, listNotes } from "@/lib/delivery/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/delivery-notes?status=&q=&warehouseId= — the notes this person may see. */
export const GET = deliveryRoute("dispatch.order.read", async ({ actor, grant, request }) => {
  const p = request.nextUrl.searchParams;
  const scope = dnScope(actor, grant, queryNumber(request, "importerId"));
  return { notes: await listNotes(scope, { status: p.get("status"), q: p.get("q"), warehouseId: queryNumber(request, "warehouseId") }) };
});
