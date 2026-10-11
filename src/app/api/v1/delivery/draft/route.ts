import { deliveryRoute, parse } from "@/lib/delivery/http";
import { currentDraft, startDraft } from "@/lib/delivery/ops";
import { startDraftSchema } from "@/lib/validation/api-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/delivery/draft — the delivery note being filled (or that just ran out), or null. */
export const GET = deliveryRoute("dispatch.order.create", async ({ actor }) => ({ draft: await currentDraft(actor) }), {
  verified: true,
});

/** POST /api/v1/delivery/draft — start a new one ({ copyFrom } keeps the buyer and transport). */
export const POST = deliveryRoute(
  "dispatch.order.create",
  async ({ actor, body }) => ({ draft: await startDraft(actor, parse(startDraftSchema, body).copyFrom ?? null) }),
  { verified: true },
);
