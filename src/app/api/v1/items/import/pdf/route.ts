import { type NextRequest } from "next/server";

import { fail, handler, ok } from "@/lib/api/respond";
import { requireVerifiedImporter } from "@/lib/auth/guard";
import { actingImporterId, metaOf, respondError } from "@/lib/inward/http";
import { importPackingList, setItemImage, sniffDocument } from "@/lib/inward/ops";
import { pdfToRowsWithPictures } from "@/lib/inward/pdf-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/items/import/pdf — the packing list as a PDF, raw bytes.
 * The words are read off the page into the same columns a sheet has,
 * then it is the same import. Scans (pictures of a list) have no words.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor, grant } = await requireVerifiedImporter("item.create", { entityType: "item" });
      const importerId = actingImporterId(actor, grant, request.nextUrl.searchParams.get("importerId"));
      if (importerId === null) return fail("FORBIDDEN", "You are not linked to an importer", requestId);
      const declared = Number(request.headers.get("content-length") ?? 0);
      if (declared > 4 * 1024 * 1024) return fail("VALIDATION_FAILED", "That PDF is over 4 MB — export the sheet instead", requestId);
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length === 0) return fail("VALIDATION_FAILED", "Nothing was sent", requestId);
      if (sniffDocument(bytes).type !== "application/pdf") return fail("VALIDATION_FAILED", "That is not a PDF", requestId);
      const { rows, pictures } = await pdfToRowsWithPictures(bytes);
      if (rows.length === 0) {
        return fail("VALIDATION_FAILED", "No text in that PDF — it looks like a scan. Send the spreadsheet instead.", requestId);
      }
      const meta = metaOf(request, requestId);
      const result = await importPackingList(actor, importerId, rows, meta);
      // The PDF's pictures go onto the catalogue rows this import created —
      // the bytes are already here, so no second trip from the client.
      for (const line of result.lines) {
        const pic = line.created && line.itemId !== null ? pictures.get(line.row) : undefined;
        if (!pic) continue;
        try {
          const item = await setItemImage(actor, importerId, line.itemId!, pic.bytes, meta);
          line.imageUrl = item.imageUrl;
        } catch (error) {
          // A picture that would not store is not worth failing the import for.
          console.warn("[inward] packing-list picture not stored", {
            requestId,
            itemId: line.itemId,
            bytes: pic.bytes.length,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return ok(result, requestId);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}
