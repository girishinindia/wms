import { type NextRequest } from "next/server";

import { handler, ok, toResponse } from "@/lib/api/respond";
import { listPublicWarehouses, publicFilterOptions } from "@/lib/warehouses/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/site/warehouses?city=&type= — the public warehouse
 * cards, for a native client.
 *
 * No auth: this is the /warehouses page's own data through the page's
 * own loaders. `listPublicWarehouses` enforces the visibility rule
 * (active AND publicly listed) and binds the filters as parameters;
 * `publicFilterOptions` only offers cities and types that actually
 * contain a public site, so the app never renders a filter that leads
 * to an empty page.
 */
export async function GET(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const params = request.nextUrl.searchParams;
      const city = (params.get("city") ?? "").trim();
      const type = (params.get("type") ?? "").trim();

      const [warehouses, filters] = await Promise.all([
        listPublicWarehouses({
          ...(city ? { city } : {}),
          ...(type ? { type } : {}),
        }),
        publicFilterOptions(),
      ]);

      return ok({ warehouses, filters }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
