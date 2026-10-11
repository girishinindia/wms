import { deliveryRoute, parse } from "@/lib/delivery/http";
import { cancelDraft, saveDraftHeader } from "@/lib/delivery/ops";
import { deliveryHeaderSchema } from "@/lib/validation/api-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/v1/delivery/draft/{id} — buyer, transport, billing, packing. */
export const PATCH = deliveryRoute(
  "dispatch.order.create",
  async ({ actor, id, body }) => ({ draft: await saveDraftHeader(actor, id!, parse(deliveryHeaderSchema, body)) }),
  { verified: true },
);

/** DELETE /api/v1/delivery/draft/{id} — cancel; its cartons are free again. */
export const DELETE = deliveryRoute(
  "dispatch.order.create",
  async ({ actor, id }) => {
    await cancelDraft(actor, id!);
    return { cancelled: true };
  },
  { verified: true },
);
