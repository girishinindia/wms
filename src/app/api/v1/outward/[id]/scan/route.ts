import { deliveryRoute, parse } from "@/lib/delivery/http";
import { loadScan } from "@/lib/outward/ops";
import { loadScanSchema } from "@/lib/validation/api-outward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/outward/{id}/scan — a package label or a single carton onto the vehicle. OK / DUPLICATE / REJECTED. */
export const POST = deliveryRoute("outward.order.read", async ({ actor, id, body, meta }) => ({
  scan: await loadScan(actor, id!, parse(loadScanSchema, body), meta),
}));
