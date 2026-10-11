import { deliveryRoute, queryNumber } from "@/lib/delivery/http";
import { stockFor } from "@/lib/delivery/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/delivery/stock?draftId= — the importer's goods by warehouse and item, with what is free. */
export const GET = deliveryRoute(
  "dispatch.order.create",
  async ({ actor, request }) => ({ stock: await stockFor(actor, queryNumber(request, "draftId")) }),
  { verified: true },
);
