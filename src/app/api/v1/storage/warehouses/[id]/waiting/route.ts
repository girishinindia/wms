import { storageRoute } from "@/lib/storage/http";
import { putBackList, waitingToStore } from "@/lib/storage/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/storage/warehouses/{id}/waiting — inwards with received cartons not yet in a gala,
 *  and (putBack) picked cartons of rejected / cancelled delivery notes to put back. */
export const GET = storageRoute("storage.goods.update", async ({ actor, id }) => ({
  waiting: await waitingToStore(actor, id!),
  putBack: await putBackList(actor, id!),
}));
