import { type NextRequest } from "next/server";

import { fail, handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { LOGO_MAX_BYTES, removeImporterLogo, setImporterLogo } from "@/lib/importer/logo";
import { idFrom, metaOf, respondError } from "@/lib/inward/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST / DELETE /api/v1/admin/importers/{id}/logo — the super admin sets
 * or removes an importer's logo. `importer.update` at ALL only; an
 * importer changes their own through /importer/me/logo.
 */
async function guard(context: { params: Promise<{ id: string }> }) {
  const id = idFrom((await context.params).id);
  if (id === null) return { id: null } as const;
  const { actor, grant } = await requirePermission("importer.update", {
    entityType: "importer",
    entityId: String(id),
    importerId: id,
  });
  return { id, actor, all: grant.scope === "ALL" } as const;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handler(async ({ requestId }) => {
    try {
      const g = await guard(context);
      if (g.id === null) return fail("NOT_FOUND", "No such importer", requestId);
      if (!g.all) return fail("FORBIDDEN", "You do not have permission to do that.", requestId);
      if (Number(request.headers.get("content-length") ?? 0) > LOGO_MAX_BYTES) {
        return fail("VALIDATION_FAILED", "That logo is over 1 MB", requestId);
      }
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length === 0) return fail("VALIDATION_FAILED", "Nothing was sent", requestId);
      return ok(await setImporterLogo(g.actor, g.id, bytes, metaOf(request, requestId)), requestId);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handler(async ({ requestId }) => {
    try {
      const g = await guard(context);
      if (g.id === null) return fail("NOT_FOUND", "No such importer", requestId);
      if (!g.all) return fail("FORBIDDEN", "You do not have permission to do that.", requestId);
      return ok(await removeImporterLogo(g.actor, g.id, metaOf(request, requestId)), requestId);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}
