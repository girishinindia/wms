import { parseBody, reviewRoute } from "@/lib/reviews/http";
import { decideReview } from "@/lib/reviews/ops";
import { decisionSchema } from "@/lib/reviews/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/admin/reviews/:id/decision — { decision, note? }.
 * APPROVE puts it on the public page; REJECT (with a reason the writer
 * sees) or HIDE takes it off. Super admin only (`review.approve` at ALL).
 */
export const POST = reviewRoute("review.approve", async ({ actor, id, body, meta }) =>
  decideReview(actor, id!, parseBody(decisionSchema, body), meta),
);
