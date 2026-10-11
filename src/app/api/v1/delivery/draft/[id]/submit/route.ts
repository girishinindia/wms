import { deliveryRoute } from "@/lib/delivery/http";
import { submitDraft } from "@/lib/delivery/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/delivery/draft/{id}/submit — one delivery note per warehouse. */
export const POST = deliveryRoute("dispatch.order.create", async ({ actor, id, meta }) => submitDraft(actor, id!, meta), {
  verified: true,
});
