import { type NextRequest } from "next/server";

import { fail, fieldsFrom, handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { idFrom, jsonBody, metaOf, respondError } from "@/lib/inward/http";
import { cancelRequest, getRequest, scopeFor, updateRequest } from "@/lib/inward/ops";
import { inwardSaveSchema } from "@/lib/validation/api-inward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET — the whole request: header, lines, documents, and what the caller may do next. */
export async function GET(_request: NextRequest, context: Ctx) {
  return handler(async ({ requestId }) => {
    try {
      const id = idFrom((await context.params).id);
      if (id === null) return fail("NOT_FOUND", "No such inward request", requestId);
      const { actor, grant } = await requirePermission("inward.request.read", {
        entityType: "inward_request",
        entityId: String(id),
      });
      return ok(await getRequest(actor, scopeFor(actor, grant), id), requestId);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}

/** PUT — replace the header and every line. Drafts and sent-back requests only. */
export async function PUT(request: NextRequest, context: Ctx) {
  return handler(async ({ requestId }) => {
    try {
      const id = idFrom((await context.params).id);
      if (id === null) return fail("NOT_FOUND", "No such inward request", requestId);
      const { actor, grant } = await requirePermission("inward.request.update", {
        entityType: "inward_request",
        entityId: String(id),
      });
      const body = await jsonBody(request);
      if (body === undefined) return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      const parsed = inwardSaveSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const scope = scopeFor(actor, grant);
      await updateRequest(actor, scope, id, parsed.data, metaOf(request, requestId));
      return ok(await getRequest(actor, scope, id), requestId);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}

/** DELETE — cancel. The row stays; the status says what happened. */
export async function DELETE(request: NextRequest, context: Ctx) {
  return handler(async ({ requestId }) => {
    try {
      const id = idFrom((await context.params).id);
      if (id === null) return fail("NOT_FOUND", "No such inward request", requestId);
      const { actor, grant } = await requirePermission("inward.request.delete", {
        entityType: "inward_request",
        entityId: String(id),
      });
      return ok(await cancelRequest(actor, scopeFor(actor, grant), id, metaOf(request, requestId)), requestId);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}
