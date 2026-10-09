import { cartonRoute } from "@/lib/inward/carton-http";
import { setHoldPhoto } from "@/lib/inward/cartons";
import { InwardError } from "@/lib/inward/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/inward-requests/{id}/cartons/{cartonId}/photo — the body is the photo. 3 MB cap. */
export const POST = cartonRoute("update", async ({ actor, scope, id, cartonId, request }) => {
  if (Number(request.headers.get("content-length") ?? 0) > 3 * 1024 * 1024) {
    throw new InwardError("VALIDATION_FAILED", "That photo is over 3 MB");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0) throw new InwardError("VALIDATION_FAILED", "Nothing was sent");
  return setHoldPhoto(actor, scope, id, cartonId!, bytes);
});
