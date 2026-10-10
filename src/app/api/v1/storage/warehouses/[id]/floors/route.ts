import { storageRoute } from "@/lib/storage/http";
import { addFloor } from "@/lib/storage/locations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/storage/warehouses/{id}/floors — the next floor (F1, F2…). */
export const POST = storageRoute("warehouse.location.create", ({ actor, id, meta }) => addFloor(actor, id!, meta));
