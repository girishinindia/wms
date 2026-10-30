import { reviewRoute } from "@/lib/reviews/http";
import { deleteReview } from "@/lib/reviews/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/v1/admin/reviews/:id — remove a review. Super admin only. */
export const DELETE = reviewRoute("review.delete", async ({ actor, id, meta }) => deleteReview(actor, id!, meta));
