import { storageRoute } from "@/lib/storage/http";
import { layout } from "@/lib/storage/locations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/storage/warehouses/{id} — its floors and galas, with cartons per gala. */
export const GET = storageRoute("storage.goods.update", ({ actor, id }) => layout(actor, id!));
