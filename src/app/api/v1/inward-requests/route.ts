import { type NextRequest } from "next/server";

import { fail, fieldsFrom, handler, ok } from "@/lib/api/respond";
import { requirePermission, requireVerifiedImporter } from "@/lib/auth/guard";
import { actingImporterId, jsonBody, metaOf, respondError } from "@/lib/inward/http";
import { createRequest, getRequest, listRequests, scopeFor } from "@/lib/inward/ops";
import { inwardListQuerySchema, inwardSaveSchema } from "@/lib/validation/api-inward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/v1/inward-requests   — mine (importer side), my sites' (dock side), or all
 * POST /api/v1/inward-requests   — a new draft; the importer must be verified
 */
export async function GET(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor, grant } = await requirePermission("inward.request.read", { entityType: "inward_request" });
      const parsed = inwardListQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Check the filters", requestId, { fields: fieldsFrom(parsed.error) });
      }
      const q = parsed.data;
      const scope = scopeFor(actor, grant, { importerId: q.importerId ?? null, warehouseId: q.warehouseId ?? null });
      const requests = await listRequests(scope, { status: q.status, q: q.q, limit: q.limit, offset: q.offset });
      return ok({ requests, side: scope.side }, requestId);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}

export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor, grant } = await requireVerifiedImporter("inward.request.create", { entityType: "inward_request" });
      const body = await jsonBody(request);
      if (body === undefined) return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      const parsed = inwardSaveSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      // Whose request: the actor's own company, or — for a platform
      // user — the importer named in the body.
      const importerId = actingImporterId(actor, grant, (body as { importerId?: unknown }).importerId);
      if (importerId === null) {
        return grant.scope === "ALL"
          ? fail("VALIDATION_FAILED", "Which importer?", requestId, { fields: { importerId: "Required" } })
          : fail("FORBIDDEN", "You are not linked to an importer", requestId);
      }
      const id = await createRequest(actor, importerId, parsed.data, metaOf(request, requestId));
      const scope = scopeFor(actor, grant, { importerId });
      return ok(await getRequest(actor, scope, id), requestId, 201);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}
