import { type NextRequest } from "next/server";

import { handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { buildTree, DEFAULT_VIEW, isView } from "@/lib/org/tree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/admin/org?view=site|role|line|customer — the hierarchy,
 * for a native client.
 *
 * The web page renders `buildTree` server-side; this hands the same
 * nodes over as JSON. The scoping is the tree builder's own: it takes
 * the caller's `user.read` grant scope and narrows every view to the
 * sites they actually hold, so a warehouse admin's tree is their own
 * corner of the company and nothing else.
 */
export async function GET(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor, grant } = await requirePermission("user.read", {
        entityType: "user",
      });
      const raw = request.nextUrl.searchParams.get("view") ?? DEFAULT_VIEW;
      const view = isView(raw) ? raw : DEFAULT_VIEW;
      const nodes = await buildTree(view, actor, grant.scope);
      return ok({ view, nodes }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
