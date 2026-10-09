import { cartonRoute } from "@/lib/inward/carton-http";
import { cartonOverview } from "@/lib/inward/cartons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/inward-requests/{id}/cartons — counts per item, totals and the last scans. */
export const GET = cartonRoute("update", ({ actor, scope, id }) => cartonOverview(actor, scope, id));
