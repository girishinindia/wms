import { deliveryRoute, parse } from "@/lib/delivery/http";
import { approveNote, dnScope } from "@/lib/delivery/ops";
import { approveSchema } from "@/lib/validation/api-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/delivery-notes/{id}/approve — the importer; an admin with { confirm: { method, person } }. */
export const POST = deliveryRoute("dispatch.order.approve", async ({ actor, grant, id, body, meta }) => {
  const { confirm } = parse(approveSchema, body);
  return { note: await approveNote(dnScope(actor, grant), actor, id!, confirm ?? null, meta) };
});
