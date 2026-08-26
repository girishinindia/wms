import { handler, ok, toResponse } from "@/lib/api/respond";
import { loadGeoOptions } from "@/lib/admin/geo";
import { requireActor } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/geo — active countries, states and cities, for pickers.
 *
 * The web forms never needed this: their pages are server-rendered and
 * call `loadGeoOptions()` directly. A native client has no server
 * render, and the importer profile and sales-agent forms both need a
 * city chosen from the master, not typed.
 *
 * A session is the whole guard, deliberately. The list of active
 * cities is not a secret — it is printed on the public warehouses page
 * — but an unauthenticated endpoint would still be an open cache-warmer
 * for anyone's crawler, so it asks for the one thing every caller of
 * those forms already has.
 *
 * Served from the same Redis-backed cache as the pages, so a burst of
 * pickers opening does not become a burst of three-table scans.
 */
export async function GET() {
  return handler(async ({ requestId }) => {
    try {
      await requireActor();
      return ok(await loadGeoOptions(), requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
