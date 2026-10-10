import { fieldsFrom } from "@/lib/api/respond";
import { InwardError } from "@/lib/inward/ops";
import { storageRoute } from "@/lib/storage/http";
import { addGalas } from "@/lib/storage/locations";
import { addGalasSchema } from "@/lib/validation/api-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/storage/floors/{id}/galas — { count } more galas after the last one. */
export const POST = storageRoute("warehouse.location.create", ({ actor, id, body, meta }) => {
  const parsed = addGalasSchema.safeParse(body);
  if (!parsed.success) throw new InwardError("VALIDATION_FAILED", "Say how many galas (1 to 50)", fieldsFrom(parsed.error));
  return addGalas(actor, id!, parsed.data.count, meta);
});
