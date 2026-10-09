import { cartonRoute } from "@/lib/inward/carton-http";
import { releaseCarton } from "@/lib/inward/cartons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/inward-requests/{id}/cartons/{cartonId}/release — accept a held carton after all. */
export const POST = cartonRoute("update", ({ actor, scope, id, cartonId, meta }) => releaseCarton(actor, scope, id, cartonId!, meta));
