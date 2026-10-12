import { deliveryRoute, parse } from "@/lib/delivery/http";
import { setHold } from "@/lib/dispatch/ops";
import { holdSchema } from "@/lib/validation/api-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/dispatch/{id}/hold — { on, reason }. */
export const POST = deliveryRoute("package.read", async ({ actor, id, body, meta }) => {
  const { on, reason } = parse(holdSchema, body);
  return { work: await setHold(actor, id!, on, reason ?? null, meta) };
});
