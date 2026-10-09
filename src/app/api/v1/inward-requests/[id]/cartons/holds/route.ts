import { cartonRoute } from "@/lib/inward/carton-http";
import { holdList } from "@/lib/inward/cartons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/inward-requests/{id}/cartons/holds — cartons on hold and why. */
export const GET = cartonRoute("update", async ({ actor, scope, id }) => ({ holds: await holdList(actor, scope, id) }));
