import { type NextRequest } from "next/server";

import { fail, handler, ok } from "@/lib/api/respond";
import { importerIdOf, requirePermission } from "@/lib/auth/guard";
import { idFrom, metaOf, respondError } from "@/lib/inward/http";
import { setItemImage } from "@/lib/inward/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/items/{id}/image — the body is the picture. 2 MB cap. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handler(async ({ requestId }) => {
    try {
      const id = idFrom((await context.params).id);
      if (id === null) return fail("NOT_FOUND", "No such item", requestId);
      const { actor, grant } = await requirePermission("item.update", { entityType: "item", entityId: String(id) });
      let importerId = importerIdOf(actor);
      if (grant.scope !== "OWN") {
        const wanted = request.nextUrl.searchParams.get("importerId");
        if (wanted) importerId = idFrom(wanted);
      }
      if (importerId === null) return fail("FORBIDDEN", "You are not linked to an importer", requestId);
      const declared = Number(request.headers.get("content-length") ?? 0);
      if (declared > 2 * 1024 * 1024) return fail("VALIDATION_FAILED", "That image is over 2 MB", requestId);
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length === 0) return fail("VALIDATION_FAILED", "Nothing was sent", requestId);
      return ok(await setItemImage(actor, importerId, id, bytes, metaOf(request, requestId)), requestId);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}
