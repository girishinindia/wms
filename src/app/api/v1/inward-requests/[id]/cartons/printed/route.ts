import { cartonRoute } from "@/lib/inward/carton-http";
import { markPrinted } from "@/lib/inward/cartons";
import { jsonBody } from "@/lib/inward/http";
import { InwardError } from "@/lib/inward/ops";
import { cartonPrintedSchema } from "@/lib/validation/api-inward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/inward-requests/{id}/cartons/printed — { ids } were just sent to the printer. */
export const POST = cartonRoute("update", async ({ actor, scope, id, request, meta }) => {
  const parsed = cartonPrintedSchema.safeParse(await jsonBody(request));
  if (!parsed.success) throw new InwardError("VALIDATION_FAILED", "Say which cartons were printed");
  return markPrinted(actor, scope, id, parsed.data.ids, meta);
});
