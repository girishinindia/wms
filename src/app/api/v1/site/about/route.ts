import { handler, ok, toResponse } from "@/lib/api/respond";
import { publicAboutSections } from "@/lib/about/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/site/about — the public About sections, same loader as /about. No auth. */
export async function GET() {
  return handler(async ({ requestId }) => {
    try {
      return ok({ sections: await publicAboutSections() }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
