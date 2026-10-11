import { deliveryRoute, parse } from "@/lib/delivery/http";
import { setAutoApprove } from "@/lib/delivery/ops";
import { autoApproveSchema } from "@/lib/validation/api-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/sales-agents/{id}/auto-approve — { on }: this agent's delivery notes need no approval. */
export const POST = deliveryRoute("sales_agent.update", async ({ actor, id, body, meta }) =>
  setAutoApprove(actor, id!, parse(autoApproveSchema, body).on, meta),
);
