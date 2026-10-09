import { cartonRoute } from "@/lib/inward/carton-http";
import { generateCartons } from "@/lib/inward/cartons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/inward-requests/{id}/cartons/generate — one number per declared carton. Safe to repeat. */
export const POST = cartonRoute("create", ({ actor, scope, id, meta }) => generateCartons(actor, scope, id, meta));
