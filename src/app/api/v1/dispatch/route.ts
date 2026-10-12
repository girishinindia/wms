import { deliveryRoute } from "@/lib/delivery/http";
import { workQueue } from "@/lib/dispatch/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/dispatch?view=OPEN|MINE|READY|PUTBACK|ALL&q= — delivery notes in warehouse work. */
export const GET = deliveryRoute("package.read", async ({ actor, request }) => {
  const p = request.nextUrl.searchParams;
  return { notes: await workQueue(actor, { view: p.get("view"), q: p.get("q") }) };
});
