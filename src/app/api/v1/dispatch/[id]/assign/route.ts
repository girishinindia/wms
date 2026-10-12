import { deliveryRoute, parse } from "@/lib/delivery/http";
import { assign } from "@/lib/dispatch/ops";
import { assignSchema } from "@/lib/validation/api-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/dispatch/{id}/assign — { userIds } replaces the assigned staff. */
export const POST = deliveryRoute("package.read", async ({ actor, id, body, meta }) => {
  const { userIds } = parse(assignSchema, body);
  return { work: await assign(actor, id!, userIds, meta) };
});
