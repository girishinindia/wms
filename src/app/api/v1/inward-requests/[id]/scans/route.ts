import { fieldsFrom } from "@/lib/api/respond";
import { cartonRoute } from "@/lib/inward/carton-http";
import { recordScans } from "@/lib/inward/cartons";
import { jsonBody } from "@/lib/inward/http";
import { InwardError } from "@/lib/inward/ops";
import { cartonScanSchema } from "@/lib/validation/api-inward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/inward-requests/{id}/scans — { scans: [{ code, clientScanId?, via?, device? }] }
 *
 * One result per scan, in order: RECEIVED, DUPLICATE, OTHER_REQUEST or
 * UNKNOWN. A scan already recorded under the same clientScanId returns
 * its stored result, so a phone may resend after being offline.
 */
export const POST = cartonRoute("update", async ({ actor, scope, id, request, meta }) => {
  const parsed = cartonScanSchema.safeParse(await jsonBody(request));
  if (!parsed.success) throw new InwardError("VALIDATION_FAILED", "Nothing to record", fieldsFrom(parsed.error));
  return recordScans(actor, scope, id, parsed.data.scans, meta);
});
