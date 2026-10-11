import { deliveryRoute, parse } from "@/lib/delivery/http";
import { holdLine } from "@/lib/delivery/ops";
import { holdLineSchema } from "@/lib/validation/api-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PUT /api/v1/delivery/draft/{id}/lines — hold { cartons } of one item (0 puts them back). */
export const PUT = deliveryRoute(
  "dispatch.order.create",
  async ({ actor, id, body }) => holdLine(actor, id!, parse(holdLineSchema, body)),
  { verified: true },
);
