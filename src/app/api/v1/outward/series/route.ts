import { deliveryRoute, parse } from "@/lib/delivery/http";
import { getSeries, setSeries } from "@/lib/outward/ops";
import { doSeriesSchema } from "@/lib/validation/api-outward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/outward/series — the Dispatch Order number series (DO/2026-27/000001). */
export const GET = deliveryRoute("outward.order.read", async () => ({ series: await getSeries() }));

/** PUT /api/v1/outward/series — super admin only. */
export const PUT = deliveryRoute("outward.series.update", async ({ actor, body, meta }) => ({
  series: await setSeries(actor, parse(doSeriesSchema, body), meta),
}));
