import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/admin/enquiries/list — the enquiries themselves.
 *
 * A sibling of `GET /admin/enquiries`, which stays exactly as it is:
 * that one is the BADGE — it answers `{unread: 0}` to everyone so the
 * shared poller never fills the log with denials. This one is the
 * SCREEN, and the screen is super-admin territory: a hard 403 for
 * anything below an ALL-scoped `enquiry.read`, same as the web page.
 *
 * Same query as the web list: newest first, soft-deleted rows gone,
 * capped at 300.
 */
export async function GET() {
  return handler(async ({ requestId }) => {
    try {
      const { grant } = await requirePermission("enquiry.read", {
        entityType: "enquiry",
      });
      if (grant.scope !== "ALL") {
        return fail("FORBIDDEN", "Enquiries are visible at platform level only.", requestId);
      }

      const rows = await getDb().execute<{
        id: number;
        name: string;
        email: string;
        mobile: string;
        subject: string;
        message: string;
        created_at: string;
        read_at: string | null;
        replied_at: string | null;
      }>(sql`
        select id, name, email::text as email, mobile::text as mobile,
               subject, message,
               created_at::text as created_at, read_at::text as read_at,
               replied_at::text as replied_at
          from wms.enquiry
         where deleted_at is null
         order by created_at desc
         limit 300
      `);

      return ok(
        {
          enquiries: rows.map((r) => ({
            id: Number(r.id),
            name: r.name,
            email: r.email,
            mobile: r.mobile,
            subject: r.subject,
            message: r.message,
            createdAt: r.created_at,
            readAt: r.read_at,
            repliedAt: r.replied_at,
          })),
        },
        requestId,
      );
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
