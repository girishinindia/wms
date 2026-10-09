import { type NextRequest } from "next/server";

import { fail, handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { idFrom, metaOf, respondError } from "@/lib/inward/http";
import { addDocument, DOCUMENT_MAX_BYTES, scopeFor } from "@/lib/inward/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/inward-requests/{id}/documents
 *
 * The body is the file itself, the same shape as expense receipts and
 * the warehouse gallery; `X-File-Name` carries what it was called.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handler(async ({ requestId }) => {
    try {
      const id = idFrom((await context.params).id);
      if (id === null) return fail("NOT_FOUND", "No such inward request", requestId);
      const { actor, grant } = await requirePermission("inward.request.update", {
        entityType: "inward_request",
        entityId: String(id),
      });
      const declared = Number(request.headers.get("content-length") ?? 0);
      if (declared > DOCUMENT_MAX_BYTES) {
        return fail("VALIDATION_FAILED", "That file is over 10 MB", requestId);
      }
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length === 0) return fail("VALIDATION_FAILED", "Nothing was sent", requestId);
      const document = await addDocument(
        actor,
        scopeFor(actor, grant),
        id,
        bytes,
        request.headers.get("x-file-name"),
        metaOf(request, requestId),
      );
      return ok(document, requestId, 201);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}
