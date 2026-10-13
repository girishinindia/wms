import { deliveryRoute, parse } from "@/lib/delivery/http";
import { doDetail, updateTransport } from "@/lib/outward/ops";
import { transportSchema } from "@/lib/validation/api-outward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/outward/{id} — one Dispatch Order with its checks, packages, scans and LRs. */
export const GET = deliveryRoute("outward.order.read", async ({ actor, id }) => ({ order: await doDetail(actor, id!) }));

/** PATCH /api/v1/outward/{id} — transporter, vehicle, driver, remarks, Tally voucher no. */
export const PATCH = deliveryRoute("outward.order.read", async ({ actor, id, body, meta }) => {
  const input = parse(transportSchema, body);
  return { order: await updateTransport(actor, id!, input, meta) };
});
