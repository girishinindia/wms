import { type NextRequest } from "next/server";

import { fail, handler, ok } from "@/lib/api/respond";
import { importerIdOf, requirePermission } from "@/lib/auth/guard";
import { LOGO_MAX_BYTES, removeImporterLogo, setImporterLogo } from "@/lib/importer/logo";
import { metaOf, respondError } from "@/lib/inward/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST / DELETE /api/v1/importer/me/logo — the signed-in importer's own
 * logo (body = the picture). It is printed on their carton stickers.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor } = await requirePermission("importer.update", { entityType: "importer" });
      const importerId = importerIdOf(actor);
      if (importerId === null) return fail("NOT_FOUND", "You are not linked to an importer", requestId);
      if (Number(request.headers.get("content-length") ?? 0) > LOGO_MAX_BYTES) {
        return fail("VALIDATION_FAILED", "That logo is over 1 MB", requestId);
      }
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length === 0) return fail("VALIDATION_FAILED", "Nothing was sent", requestId);
      return ok(await setImporterLogo(actor, importerId, bytes, metaOf(request, requestId)), requestId);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}

export async function DELETE(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor } = await requirePermission("importer.update", { entityType: "importer" });
      const importerId = importerIdOf(actor);
      if (importerId === null) return fail("NOT_FOUND", "You are not linked to an importer", requestId);
      return ok(await removeImporterLogo(actor, importerId, metaOf(request, requestId)), requestId);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}
