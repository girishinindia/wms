import { type NextRequest } from "next/server";

import { fail, handler, ok } from "@/lib/api/respond";
import { importerIdOf, requirePermission } from "@/lib/auth/guard";
import { idFrom, respondError } from "@/lib/inward/http";
import { lookupsFor } from "@/lib/inward/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/inward-requests/lookups — everything the form needs, once.
 *
 * Warehouses, the three masters, the carrier register with vehicles and
 * drivers nested under their transporter, the importer's own catalogue,
 * and what they picked last time. One round trip, so the wizard opens
 * with every picker already filled.
 */
export async function GET(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor, grant } = await requirePermission("inward.request.read", { entityType: "inward_request" });
      let importerId = importerIdOf(actor);
      if (grant.scope === "ALL") {
        const wanted = request.nextUrl.searchParams.get("importerId");
        importerId = wanted ? idFrom(wanted) : importerId;
      }
      if (importerId === null) {
        return fail("FORBIDDEN", "You are not linked to an importer", requestId);
      }
      return ok(await lookupsFor(importerId), requestId);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
}
