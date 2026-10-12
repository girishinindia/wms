import { deliveryRoute, parse } from "@/lib/delivery/http";
import { packageAction } from "@/lib/dispatch/ops";
import { packageActionSchema } from "@/lib/validation/api-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/v1/dispatch/packages/{id} — { action: CLOSE|REOPEN|CANCEL|UPDATE|PRINTED, weight/size, reason }. */
export const PATCH = deliveryRoute("package.read", async ({ actor, id, body, meta }) => {
  const { action, ...input } = parse(packageActionSchema, body);
  return { work: await packageAction(actor, id!, action, input, meta) };
});
