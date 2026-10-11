import { deliveryRoute, parse } from "@/lib/delivery/http";
import { createClient, listClients } from "@/lib/delivery/ops";
import { clientCreateSchema } from "@/lib/validation/api-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/delivery/clients?q= — the importer's buyers. */
export const GET = deliveryRoute(
  "dispatch.order.create",
  async ({ actor, request }) => ({ clients: await listClients(actor, request.nextUrl.searchParams.get("q") ?? "") }),
  { verified: true },
);

/** POST /api/v1/delivery/clients — a new buyer, saved for next time. */
export const POST = deliveryRoute(
  "dispatch.order.create",
  async ({ actor, body, meta }) => ({ client: await createClient(actor, parse(clientCreateSchema, body), meta) }),
  { verified: true },
);
