import { type NextRequest } from "next/server";

import { fail, fieldsFrom, handler, ok } from "@/lib/api/respond";
import { importerIdOf, requirePermission, requireVerifiedImporter } from "@/lib/auth/guard";
import { idFrom, jsonBody, metaOf, respondError } from "@/lib/inward/http";
import { createItem, listItems } from "@/lib/inward/ops";
import { itemSaveSchema } from "@/lib/validation/api-inward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which importer's catalogue — the actor's own, or ?importerId= for a platform user. */
async function catalogueOf(permission: string, request: NextRequest, verified: boolean) {
  const { actor, grant } = verified
    ? await requireVerifiedImporter(permission, { entityType: "item" })
    : await requirePermission(permission, { entityType: "item" });
  let importerId = importerIdOf(actor);
  if (grant.scope !== "OWN") {
    const wanted = request.nextUrl.searchParams.get("importerId");
    if (wanted) importerId = idFrom(wanted);
  }
  return { actor, importerId };
}

/** GET /api/v1/items?q= — the importer's catalogue. */
export async function GET(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { importerId } = await catalogueOf("item.read", request, false);
      if (importerId === null) return fail("FORBIDDEN", "You are not linked to an importer", requestId);
      const q = request.nextUrl.searchParams.get("q") ?? "";
      return ok({ items: await listItems(importerId, q.trim()) }, requestId);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}

/** POST /api/v1/items — a new catalogue row; the code is minted here. */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor, importerId } = await catalogueOf("item.create", request, true);
      if (importerId === null) return fail("FORBIDDEN", "You are not linked to an importer", requestId);
      const body = await jsonBody(request);
      if (body === undefined) return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      const parsed = itemSaveSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      return ok(await createItem(actor, importerId, parsed.data, metaOf(request, requestId)), requestId, 201);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}
