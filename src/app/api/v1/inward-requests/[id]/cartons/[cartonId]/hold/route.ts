import { fieldsFrom } from "@/lib/api/respond";
import { cartonRoute } from "@/lib/inward/carton-http";
import { holdCarton } from "@/lib/inward/cartons";
import { jsonBody } from "@/lib/inward/http";
import { InwardError } from "@/lib/inward/ops";
import { cartonHoldSchema } from "@/lib/validation/api-inward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/inward-requests/{id}/cartons/{cartonId}/hold — { reason, note? } */
export const POST = cartonRoute("update", async ({ actor, scope, id, cartonId, request, meta }) => {
  const parsed = cartonHoldSchema.safeParse(await jsonBody(request));
  if (!parsed.success) throw new InwardError("VALIDATION_FAILED", "Choose a reason", fieldsFrom(parsed.error));
  return holdCarton(actor, scope, id, cartonId!, parsed.data.reason, parsed.data.note ?? null, meta);
});
