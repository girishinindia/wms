import { storageRoute } from "@/lib/storage/http";
import { waitingToStore } from "@/lib/storage/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/storage/warehouses/{id}/waiting — inwards with received cartons not yet in a gala. */
export const GET = storageRoute("storage.goods.update", async ({ actor, id }) => ({ waiting: await waitingToStore(actor, id!) }));
