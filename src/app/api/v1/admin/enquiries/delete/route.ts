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
});

/**
 * POST /api/v1/admin/enquiries/delete — remove enquiries from the list.
 *
 * A SOFT delete, unlike the notifications screen, and the difference is
 * deliberate. A notification is a copy of something the system already
 * knows and can regenerate. An enquiry is the ONLY record that a
 * stranger tried to reach the business — usually with a phone number
 * nobody wrote down anywhere else — and a mis-click on "Delete all"
 * would destroy it with nothing to restore from.
 *
 * So the row leaves every list and every count and stays on disk, and
 * the audit entry below carries who wrote in and what about, so the
 * fact of the message survives even if somebody later clears the table
 * out properly.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor, grant } = await requirePermission("enquiry.delete", {
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
      const { ids, all } = parsed.data;
      if (!all && (!ids || ids.length === 0)) {
        return fail("VALIDATION_FAILED", "Nothing selected", requestId);
      }

      /**
       * `returning` the identity, not the message.
       *
       * Enough for the audit row to say who was lost track of, without
       * copying the body of a stranger's message into a table that
       * cannot be edited or deleted and is read by every super admin.
       */
      const rows = await getDb().execute<{
        id: number; name: string; email: string; mobile: string; subject: string;
      }>(sql`
        update wms.enquiry
           set deleted_at = now(), deleted_by = ${actor.session.userId}
         where deleted_at is null
           ${
             /*
              * `id in (…)` built with `sql.join`, NOT `= any(${ids})`.
              *
              * postgres.js expands a JS array into a parameter LIST, so
              * `any(${ids})` becomes `any(($2))` with the ids spread
              * across separate parameters — which fails at the driver
              * with "the string argument must be of type string". The
              * two notification routes use exactly this idiom for the
              * same reason.
              */
             all ? sql`` : sql`and id in (${sql.join(ids!.map((i) => sql`${i}`), sql`, `)})`
           }
        returning id, name, email::text as email, mobile, subject`);

      // DELETE operations must carry a reason — the schema insists,
      // because a deletion with no stated cause is the one everybody
      // argues about later.
      await auditQuietly({
        action: "enquiry.deleted", operation: "DELETE", entityType: "enquiry",
        entityId: rows.length === 1 ? String(rows[0]!.id) : `${rows.length} rows`,
        result: "SUCCESS", reason: "Removed from the enquiry list by a super admin",
        actorUserId: actor.session.userId,
        actorEmail: actor.session.email,
        actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
        ip: clientIp(request.headers), userAgent: request.headers.get("user-agent"),
        requestId,
        /**
         * An OBJECT wrapping the list, never the bare array.
         *
         * The audit writer feeds `before` through `jsonb_diff` and then
         * `jsonb_object_keys`, and `jsonb_object_keys` refuses anything
         * that is not a JSON object. Passing the array straight through
         * made the whole insert fail — and because `auditQuietly`
         * swallows its own errors on purpose, so a broken log cannot
         * break a real request, the delete succeeded and the audit row
         * simply was not there. Silent, and only visible by looking.
         */
        before: {
          count: rows.length,
          enquiries: rows.map((r) => ({
            id: Number(r.id), name: r.name, email: r.email,
            mobile: r.mobile, subject: r.subject,
          })),
        },
      });

      return ok({ deleted: rows.length }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
