import { deliveryRoute } from "@/lib/delivery/http";
import { packSingles } from "@/lib/dispatch/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/dispatch/{id}/singles — every loose picked carton goes as a single (its sticker is its label). */
export const POST = deliveryRoute("package.read", async ({ actor, id, meta }) => ({ work: await packSingles(actor, id!, meta) }));
