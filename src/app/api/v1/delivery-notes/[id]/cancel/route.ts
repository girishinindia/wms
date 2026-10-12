import { deliveryRoute, parse } from "@/lib/delivery/http";
import { cancelNote, dnScope } from "@/lib/delivery/ops";
import { cancelNoteSchema } from "@/lib/validation/api-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/delivery-notes/{id}/cancel — { reason }. The importer or a super admin; picked cartons go back to storage. */
export const POST = deliveryRoute("dispatch.order.read", async ({ actor, grant, id, body, meta }) => {
  const { reason } = parse(cancelNoteSchema, body);
  return { note: await cancelNote(dnScope(actor, grant), actor, id!, reason, meta) };
});
