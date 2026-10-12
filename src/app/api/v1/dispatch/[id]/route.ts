import { deliveryRoute } from "@/lib/delivery/http";
import { workDetail } from "@/lib/dispatch/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/dispatch/{id} — pick list with locations, cartons, packages, scans, rights. */
export const GET = deliveryRoute("package.read", async ({ actor, id }) => ({ work: await workDetail(actor, id!) }));
