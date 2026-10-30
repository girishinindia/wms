import { parseBody, reviewRoute } from "@/lib/reviews/http";
import { getMyReview, saveMyReview, withdrawMyReview } from "@/lib/reviews/ops";
import { reviewInputSchema } from "@/lib/reviews/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/v1/reviews/mine — the signed-in importer's or sales agent's own
 * review. One per person.
 *
 *   GET     { review: MyReview | null }
 *   PUT     write or rewrite it; always goes back to PENDING
 *   DELETE  withdraw it
 *
 * `review.create` / `review.update` are held at OWN by IMPORTER and
 * SALES_AGENT only (migration 44); the ops layer also insists on an
 * importer-domain role, so a console grant to anybody else is not enough.
 */
export const GET = reviewRoute("review.read", async ({ actor }) => ({ review: await getMyReview(actor) }));

export const PUT = reviewRoute(
  "review.create",
  async ({ actor, body, meta }) => ({ review: await saveMyReview(actor, parseBody(reviewInputSchema, body), meta) }),
  { verified: true },
);

export const DELETE = reviewRoute("review.update", async ({ actor, meta }) => withdrawMyReview(actor, meta));
