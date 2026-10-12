import { findStock } from "@/lib/storage/cartons";
import { storageRoute } from "@/lib/storage/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/storage/warehouses/{id}/find?q= — a gala code, a carton number, an item or an importer: where is it? */
export const GET = storageRoute("storage.goods.update", ({ actor, id, request }) => findStock(actor, id!, request.nextUrl.searchParams.get("q") ?? ""));
