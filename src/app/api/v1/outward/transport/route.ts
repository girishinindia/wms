import { deliveryRoute, queryNumber } from "@/lib/delivery/http";
import { transportOptions } from "@/lib/outward/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/outward/transport?transporterId=&q= — transporters, and that transporter's vehicles and drivers. */
export const GET = deliveryRoute("outward.order.create", async ({ request }) =>
  transportOptions(queryNumber(request, "transporterId"), request.nextUrl.searchParams.get("q")),
);
