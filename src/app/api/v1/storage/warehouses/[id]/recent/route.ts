import { storageRoute } from "@/lib/storage/http";
import { recentStores } from "@/lib/storage/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/storage/warehouses/{id}/recent — the last 50 stores and moves. */
export const GET = storageRoute("storage.goods.update", async ({ actor, id }) => ({ recent: await recentStores(actor, id!) }));
