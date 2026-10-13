import { deliveryRoute, parse } from "@/lib/delivery/http";
import { checkLr } from "@/lib/outward/ops";
import { lrCheckSchema } from "@/lib/validation/api-outward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/outward/{id}/lr/check — { lrId, ok, reason? }: the manager verifies or rejects an LR. */
export const POST = deliveryRoute("outward.order.read", async ({ actor, id, body, meta }) => {
  const { lrId, ok, reason } = parse(lrCheckSchema, body);
  return { order: await checkLr(actor, id!, lrId, ok, reason ?? null, meta) };
});
