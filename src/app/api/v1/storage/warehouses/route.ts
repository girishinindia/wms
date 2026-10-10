import { storageRoute } from "@/lib/storage/http";
import { storageWarehouses } from "@/lib/storage/locations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/storage/warehouses — where this person can store cartons. */
export const GET = storageRoute("storage.goods.update", async ({ actor }) => ({ warehouses: await storageWarehouses(actor) }));
