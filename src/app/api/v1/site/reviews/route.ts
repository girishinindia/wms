import { handler, ok, toResponse } from "@/lib/api/respond";
import { publicReviews } from "@/lib/reviews/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/site/reviews — approved reviews only, same loader as
 * /reviews. No auth; no email, mobile or full name ever leaves here.
 */
export async function GET() {
  return handler(async ({ requestId }) => {
    try {
      return ok(await publicReviews(), requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
