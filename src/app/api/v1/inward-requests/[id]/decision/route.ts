import { type NextRequest } from "next/server";

import { fail, fieldsFrom, handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { idFrom, jsonBody, metaOf, respondError } from "@/lib/inward/http";
import { decideRequest, scopeFor } from "@/lib/inward/ops";
import { inwardDecisionSchema } from "@/lib/validation/api-inward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/inward-requests/{id}/decision — the dock's side.
 *
 * { action: ACKNOWLEDGE | NEEDS_CHANGES | IN_PROCESS | COMPLETE, note? }
 * One endpoint for the four moves, because they are one permission
 * (`inward.request.approve`) and one state machine.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handler(async ({ requestId }) => {
    try {
      const id = idFrom((await context.params).id);
      if (id === null) return fail("NOT_FOUND", "No such inward request", requestId);
      const { actor, grant } = await requirePermission("inward.request.approve", {
        entityType: "inward_request",
        entityId: String(id),
      });
      const body = await jsonBody(request);
      if (body === undefined) return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      const parsed = inwardDecisionSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const result = await decideRequest(
        actor,
        scopeFor(actor, grant),
        id,
        parsed.data.action,
        parsed.data.note ?? null,
        metaOf(request, requestId),
      );
      return ok(result, requestId);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}
