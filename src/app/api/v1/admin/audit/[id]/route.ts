import { type NextRequest } from "next/server";

import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { readAuditEntry } from "@/lib/audit/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/admin/audit/[id] — one entry, in full.
 *
 * Separate from the list because of what is in it: `before` and `after`
 * carry whatever the record held, which for an importer is their
 * contact details, GSTIN and PAN. The list deliberately does not select
 * those columns; this is the one place they are handed over, for one
 * row, to somebody who asked for it.
 *
 * ALL scope only. `audit_log.read` is granted at WAREHOUSE to a
 * warehouse admin and at OWN to an importer, but the two columns that
 * would let those grants be honoured — `actor_warehouse_id` and
 * `actor_path` — are never written, so there is nothing to narrow by. A
 * log filtered by a column that is always NULL either shows everything
 * or nothing, and showing everything is how a branch manager reads
 * every other branch's records.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { id } = await context.params;

      const { grant } = await requirePermission("audit_log.read", {
        entityType: "audit_log",
        entityId: id,
      });
      if (grant.scope !== "ALL") {
        return fail(
          "FORBIDDEN",
          "The audit log is not scoped to a single site, so it is read at platform level only.",
          requestId,
        );
      }

      const entry = await readAuditEntry(id);
      if (!entry) return fail("NOT_FOUND", "No such entry", requestId);

      return ok(entry, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
