import { deliveryRoute, parse } from "@/lib/delivery/http";
import { createDo, outwardBoard } from "@/lib/outward/ops";
import { createDoSchema } from "@/lib/validation/api-outward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/outward?view=READY|LOADING|LOADED|LR_PENDING|LR_VERIFY|DONE|ALL&q= — the outward board. */
export const GET = deliveryRoute("outward.order.read", async ({ actor, request }) => {
  const p = request.nextUrl.searchParams;
  return outwardBoard(actor, { view: p.get("view"), q: p.get("q") });
});

/** POST /api/v1/outward — { noteId, packageIds?, transport… }: a new Dispatch Order. */
export const POST = deliveryRoute("outward.order.create", async ({ actor, body, meta }) => {
  const input = parse(createDoSchema, body);
  return { order: await createDo(actor, input, meta) };
});
