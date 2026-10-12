import { deliveryRoute, parse } from "@/lib/delivery/http";
import { packScan } from "@/lib/dispatch/ops";
import { packScanSchema } from "@/lib/validation/api-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/dispatch/packages/{id}/scan — { code, remove? } puts a carton in (or takes it out of) an open package. */
export const POST = deliveryRoute("package.read", async ({ actor, id, body, meta }) => ({
  scan: await packScan(actor, id!, parse(packScanSchema, body), meta),
}));
