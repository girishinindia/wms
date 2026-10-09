import { type NextRequest } from "next/server";

import { fail, fieldsFrom, handler, ok } from "@/lib/api/respond";
import { requireVerifiedImporter } from "@/lib/auth/guard";
import { actingImporterId, jsonBody, metaOf, respondError } from "@/lib/inward/http";
import { importPackingList } from "@/lib/inward/ops";
import { packingRowsSchema } from "@/lib/validation/api-inward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/items/import — a packing list's cells, as the client
 * read them from the sheet (header row included). Every item number
 * lands in the importer's catalogue; the reply is the request lines.
 *
 * The client reads the spreadsheet itself and sends only the cells,
 * because the sheets suppliers send carry a picture per row and run to
 * 8 MB — more than a request body may be here. Pictures follow one at a
 * time through /items/{id}/image, for rows this call reports `created`.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor, grant } = await requireVerifiedImporter("item.create", { entityType: "item" });
      const importerId = actingImporterId(actor, grant, request.nextUrl.searchParams.get("importerId"));
      if (importerId === null) return fail("FORBIDDEN", "You are not linked to an importer", requestId);
      const body = await jsonBody(request);
      if (body === undefined) return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      const parsed = packingRowsSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "That does not look like a sheet", requestId, { fields: fieldsFrom(parsed.error) });
      }
      return ok(await importPackingList(actor, importerId, parsed.data.rows, metaOf(request, requestId)), requestId);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}
