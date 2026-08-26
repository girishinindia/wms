import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { getDb } from "@/db";
import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { auditQuietly } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  ids: z.array(z.number().int().positive()).max(300).optional(),
  all: z.boolean().optional(),
  /** Absent means "mark read"; false is how a row is put back. */
  read: z.boolean().optional(),
});

/**
 * POST /api/v1/admin/enquiries/read — mark enquiries read or unread.
 *
 * `enquiry.update` at ALL scope, which in practice means a super admin
 * and nobody else — see 27_enquiry.sql for why there is no narrower
 * grant to make: an enquiry belongs to no warehouse and no importer, so
 * there is nothing for a WAREHOUSE or OWN scope to filter by.
 *
 * Read state is per-TABLE, not per-viewer, unlike a notification: this
 * is a shared inbox, and two super admins should not each have to mark
 * the same message read.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor, grant } = await requirePermission("enquiry.update", {
        entityType: "enquiry",
      });
      if (grant.scope !== "ALL") {
        return fail("FORBIDDEN", "Enquiries are visible at platform level only.", requestId);
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      }

      const parsed = bodySchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Expected ids or all", requestId);
      }
      const { ids, all, read = true } = parsed.data;
      if (!all && (!ids || ids.length === 0)) {
        return fail("VALIDATION_FAILED", "Nothing selected", requestId);
      }

      /**
       * `read_at` and `read_by` move together — the table's
       * `enquiry_read_pair` CHECK refuses a half-recorded read, because
       * "somebody read this" with no somebody is not a fact worth
       * keeping.
       */
      const rows = await getDb().execute<{ id: number }>(sql`
        update wms.enquiry
           set read_at = ${read ? sql`now()` : sql`null`},
               read_by = ${read ? sql`${actor.session.userId}` : sql`null`}
         where deleted_at is null
           ${
             /*
              * `id in (…)` via `sql.join`, never `= any(${ids})`:
              * postgres.js expands a JS array into a parameter list and
              * the driver then refuses it. Same idiom as the two
              * notification routes.
              */
             all ? sql`` : sql`and id in (${sql.join(ids!.map((i) => sql`${i}`), sql`, `)})`
           }
           and (read_at is null) = ${read}
        returning id`);

      await auditQuietly({
        action: "enquiry.updated", operation: "UPDATE", entityType: "enquiry",
        entityId: rows.length === 1 ? String(rows[0]!.id) : `${rows.length} rows`,
        result: "SUCCESS", actorUserId: actor.session.userId,
        ip: clientIp(request.headers), userAgent: request.headers.get("user-agent"),
        requestId, after: { read },
      });

      return ok({ marked: rows.length }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
