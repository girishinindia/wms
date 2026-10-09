import { type NextRequest } from "next/server";

import { fail, handler, ok } from "@/lib/api/respond";
import { requireVerifiedImporter } from "@/lib/auth/guard";
import { idFrom, metaOf, respondError } from "@/lib/inward/http";
import { scopeFor, submitRequest } from "@/lib/inward/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/inward-requests/{id}/submit
 *
 * Every dock-facing field must be present; the refusal names each one
 * that is not, so the form jumps to it instead of saying "incomplete".
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handler(async ({ requestId }) => {
    try {
      const id = idFrom((await context.params).id);
      if (id === null) return fail("NOT_FOUND", "No such inward request", requestId);
      const { actor, grant } = await requireVerifiedImporter("inward.request.update", {
        entityType: "inward_request",
        entityId: String(id),
      });
      return ok(await submitRequest(actor, scopeFor(actor, grant), id, metaOf(request, requestId)), requestId);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}
