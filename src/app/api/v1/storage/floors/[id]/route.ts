import { fieldsFrom } from "@/lib/api/respond";
import { InwardError } from "@/lib/inward/ops";
import { storageRoute } from "@/lib/storage/http";
import { setActive } from "@/lib/storage/locations";
import { setActiveSchema } from "@/lib/validation/api-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/v1/storage/floors/{id} — { active } switch a floor on or off. */
export const PATCH = storageRoute("warehouse.location.update", ({ actor, id, body, meta }) => {
  const parsed = setActiveSchema.safeParse(body);
  if (!parsed.success) throw new InwardError("VALIDATION_FAILED", "Say on or off", fieldsFrom(parsed.error));
  return setActive(actor, "floor", id!, parsed.data.active, meta);
});
