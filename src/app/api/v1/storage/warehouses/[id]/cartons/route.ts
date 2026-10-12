import { storedCartons } from "@/lib/storage/cartons";
import { storageRoute } from "@/lib/storage/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/storage/warehouses/{id}/cartons?q= — every stored carton of a warehouse (up to 5000; q narrows on the server). */
export const GET = storageRoute("storage.goods.update", ({ actor, id, request }) =>
  storedCartons(actor, { warehouseId: id! }, request.nextUrl.searchParams.get("q")),
);
