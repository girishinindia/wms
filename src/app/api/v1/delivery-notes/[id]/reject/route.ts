import { deliveryRoute, parse } from "@/lib/delivery/http";
import { dnScope, rejectNote } from "@/lib/delivery/ops";
import { rejectSchema } from "@/lib/validation/api-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/delivery-notes/{id}/reject — { reason } (an admin also { confirm }). Final; cartons free again. */
export const POST = deliveryRoute("dispatch.order.approve", async ({ actor, grant, id, body, meta }) => {
  const { reason, confirm } = parse(rejectSchema, body);
  return { note: await rejectNote(dnScope(actor, grant), actor, id!, reason, confirm ?? null, meta) };
});
