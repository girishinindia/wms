import { deliveryRoute } from "@/lib/delivery/http";
import { listTransporters } from "@/lib/delivery/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/delivery/transporters?q= — the transporters list, to pick one on a delivery note. */
export const GET = deliveryRoute(
  "dispatch.order.create",
  async ({ actor, request }) => ({ transporters: await listTransporters(actor, request.nextUrl.searchParams.get("q") ?? "") }),
  { verified: true },
);
