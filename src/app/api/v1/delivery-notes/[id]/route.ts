import { deliveryRoute, parse } from "@/lib/delivery/http";
import { dnScope, editNote, getNote } from "@/lib/delivery/ops";
import { editNoteSchema } from "@/lib/validation/api-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/delivery-notes/{id} */
export const GET = deliveryRoute("dispatch.order.read", async ({ actor, grant, id }) => ({
  note: await getNote(dnScope(actor, grant), actor, id!),
}));

/** PUT /api/v1/delivery-notes/{id} — change items and details (sales agent who made it, or the importer). */
export const PUT = deliveryRoute("dispatch.order.read", async ({ actor, grant, id, body, meta }) => ({
  note: await editNote(dnScope(actor, grant), actor, id!, parse(editNoteSchema, body), meta),
}));
