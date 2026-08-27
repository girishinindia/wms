import { handler, ok, toResponse } from "@/lib/api/respond";
import { publicFaqGroups } from "@/lib/faq/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/site/faqs — the public FAQ list, for a native client.
 *
 * No auth: this is the same data the /faqs page serves the whole
 * internet, and it comes through the same loader — `publicFaqGroups`
 * hand-names every column, drops switched-off rows and empty
 * categories, and answers [] rather than failing when the database is
 * unreachable. There is deliberately no second query here for a new
 * column to slip into.
 */
export async function GET() {
  return handler(async ({ requestId }) => {
    try {
      const groups = await publicFaqGroups();
      return ok({ groups }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
