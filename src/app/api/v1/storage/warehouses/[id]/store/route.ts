import { fieldsFrom } from "@/lib/api/respond";
import { InwardError } from "@/lib/inward/ops";
import { storageRoute } from "@/lib/storage/http";
import { storeCartons } from "@/lib/storage/store";
import { storeCartonsSchema } from "@/lib/validation/api-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/storage/warehouses/{id}/store — { galaId, scans: [{ code, clientScanId?, via?, move? }] }
 *
 * One answer per scan: STORED, MOVED, ALREADY_HERE, MOVE_CONFIRM (send it
 * again with move: true), NOT_RECEIVED, ON_HOLD, OTHER_WAREHOUSE, UNKNOWN.
 */
export const POST = storageRoute("storage.goods.update", ({ actor, id, body, meta }) => {
  const parsed = storeCartonsSchema.safeParse(body);
  if (!parsed.success) throw new InwardError("VALIDATION_FAILED", "Nothing to store", fieldsFrom(parsed.error));
  return storeCartons(actor, id!, parsed.data.galaId, parsed.data.scans, meta);
});
