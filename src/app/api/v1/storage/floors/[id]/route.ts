import { fieldsFrom } from "@/lib/api/respond";
import { InwardError } from "@/lib/inward/ops";
import { storageRoute } from "@/lib/storage/http";
import { remove, rename, setActive } from "@/lib/storage/locations";
import { locationPatchSchema } from "@/lib/validation/api-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/v1/storage/floors/{id} — { active } switch on or off (off only
 * when empty), or { name } rename. Super admin and warehouse admin.
 */
export const PATCH = storageRoute("warehouse.location.update", async ({ actor, id, body, meta }) => {
  const parsed = locationPatchSchema.safeParse(body);
  if (!parsed.success) throw new InwardError("VALIDATION_FAILED", "Nothing to change", fieldsFrom(parsed.error));
  let out = parsed.data.name !== undefined ? await rename(actor, "floor", id!, parsed.data.name, meta) : null;
  if (parsed.data.active !== undefined) out = await setActive(actor, "floor", id!, parsed.data.active, meta);
  return out;
});

/** DELETE /api/v1/storage/floors/{id} — only if no carton was ever stored there. */
export const DELETE = storageRoute("warehouse.location.delete", ({ actor, id, meta }) => remove(actor, "floor", id!, meta));
