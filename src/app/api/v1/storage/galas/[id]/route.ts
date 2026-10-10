import { fieldsFrom } from "@/lib/api/respond";
import { InwardError } from "@/lib/inward/ops";
import { storageRoute } from "@/lib/storage/http";
import { setActive } from "@/lib/storage/locations";
import { galaContents } from "@/lib/storage/store";
import { setActiveSchema } from "@/lib/validation/api-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/storage/galas/{id} — what is in it, by item and by carton. */
export const GET = storageRoute("storage.goods.update", ({ actor, id }) => galaContents(actor, id!));

/** PATCH /api/v1/storage/galas/{id} — { active } switch a gala on or off (only when empty). */
export const PATCH = storageRoute("warehouse.location.update", ({ actor, id, body, meta }) => {
  const parsed = setActiveSchema.safeParse(body);
  if (!parsed.success) throw new InwardError("VALIDATION_FAILED", "Say on or off", fieldsFrom(parsed.error));
  return setActive(actor, "gala", id!, parsed.data.active, meta);
});
