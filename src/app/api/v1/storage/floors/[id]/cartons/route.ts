import { storedCartons } from "@/lib/storage/cartons";
import { storageRoute } from "@/lib/storage/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/storage/floors/{id}/cartons?q= — every stored carton on a floor, with its gala. */
export const GET = storageRoute("storage.goods.update", ({ actor, id, request }) =>
  storedCartons(actor, { floorId: id! }, request.nextUrl.searchParams.get("q")),
);
