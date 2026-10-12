import { deliveryRoute, parse } from "@/lib/delivery/http";
import { scan } from "@/lib/dispatch/ops";
import { scanSchema } from "@/lib/validation/api-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/dispatch/{id}/scan — { step: PICK|ARRIVE|VERIFY, code, clientScanId? }. Answers OK / DUPLICATE / REJECTED. */
export const POST = deliveryRoute("package.read", async ({ actor, id, body, meta }) => {
  const { step, ...input } = parse(scanSchema, body);
  return { scan: await scan(actor, id!, step, input, meta) };
});
