import { deliveryRoute, parse, queryNumber } from "@/lib/delivery/http";
import { getSeries, setSeries } from "@/lib/delivery/ops";
import { seriesSchema } from "@/lib/validation/api-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/delivery/series — the importer's numbering. */
export const GET = deliveryRoute("dispatch.order.approve", async ({ actor, request }) => ({
  series: await getSeries(actor, queryNumber(request, "importerId")),
}));

/** PUT /api/v1/delivery/series — prefix and next numbers. */
export const PUT = deliveryRoute("dispatch.order.approve", async ({ actor, body, meta, request }) => ({
  series: await setSeries(actor, parse(seriesSchema, body), meta, queryNumber(request, "importerId")),
}));
