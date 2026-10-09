import { type NextRequest } from "next/server";

import { fail, handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { idFrom, metaOf, respondError } from "@/lib/inward/http";
import { removeDocument, scopeFor } from "@/lib/inward/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; documentId: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const params = await context.params;
      const id = idFrom(params.id);
      const documentId = idFrom(params.documentId);
      if (id === null || documentId === null) return fail("NOT_FOUND", "No such document", requestId);
      const { actor, grant } = await requirePermission("inward.request.update", {
        entityType: "inward_request",
        entityId: String(id),
      });
      await removeDocument(actor, scopeFor(actor, grant), id, documentId, metaOf(request, requestId));
      return ok({ removed: true }, requestId);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}
