import { reviewRoute } from "@/lib/reviews/http";
import { listReviewsForAdmin } from "@/lib/reviews/ops";
import { REVIEW_STATUSES, type ReviewStatus } from "@/lib/reviews/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/admin/reviews?status=PENDING — the moderation queue.
 * Super admin only (`review.read` at ALL); pending first, newest first.
 */
export const GET = reviewRoute("review.read", async ({ actor, request }) => {
  const raw = request.nextUrl.searchParams.get("status");
  const status = (REVIEW_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as ReviewStatus) : null;
  return listReviewsForAdmin(actor, status);
});
