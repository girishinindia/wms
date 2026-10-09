import { type NextRequest } from "next/server";

import { fail, fieldsFrom, handler, ok } from "@/lib/api/respond";
import { importerIdOf, requirePermission } from "@/lib/auth/guard";
import { idFrom, jsonBody, metaOf, respondError } from "@/lib/inward/http";
import { deleteItem, updateItem } from "@/lib/inward/ops";
import { itemSaveSchema } from "@/lib/validation/api-inward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function owner(permission: string, request: NextRequest, id: number) {
  const { actor, grant } = await requirePermission(permission, { entityType: "item", entityId: String(id) });
  let importerId = importerIdOf(actor);
  if (grant.scope !== "OWN") {
    const wanted = request.nextUrl.searchParams.get("importerId");
    if (wanted) importerId = idFrom(wanted);
  }
  return { actor, importerId };
}

export async function PATCH(request: NextRequest, context: Ctx) {
  return handler(async ({ requestId }) => {
    try {
      const id = idFrom((await context.params).id);
      if (id === null) return fail("NOT_FOUND", "No such item", requestId);
      const { actor, importerId } = await owner("item.update", request, id);
      if (importerId === null) return fail("FORBIDDEN", "You are not linked to an importer", requestId);
      const body = await jsonBody(request);
      if (body === undefined) return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      const parsed = itemSaveSchema.partial().safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      return ok(await updateItem(actor, importerId, id, parsed.data, metaOf(request, requestId)), requestId);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}

export async function DELETE(request: NextRequest, context: Ctx) {
  return handler(async ({ requestId }) => {
    try {
      const id = idFrom((await context.params).id);
      if (id === null) return fail("NOT_FOUND", "No such item", requestId);
      const { actor, importerId } = await owner("item.delete", request, id);
      if (importerId === null) return fail("FORBIDDEN", "You are not linked to an importer", requestId);
      await deleteItem(actor, importerId, id, metaOf(request, requestId));
      return ok({ deleted: true }, requestId);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}
