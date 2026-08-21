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
 * POST /api/v1/notifications/delete — remove mine, for good.
 *
 * A real DELETE, as asked for: the row goes, and with it the
 * `notification_delivery` rows that hang off it (`on delete cascade`) —
 * so the record of which email or push was sent for this notification
 * disappears too. That is the trade the operator chose; the audit row
 * written just before the delete is what keeps the ACT of deleting
 * traceable, with the ids and titles, in a table that cannot be deleted
 * from at all.
 *
 * Guarded on `notification.read`, not `notification.delete`: clearing
 * your own bell is not an administrative power, and `notification.delete`
 * belongs to super admins alone. The authorisation that matters is the
 * WHERE clause — `recipient_user_id` is the session's own id and never
 * comes from the request, so ids belonging to somebody else simply match
 * nothing.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor } = await requirePermission("notification.read", {
        entityType: "notification",
      });
      const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
      if (!parsed.success || (!parsed.data.all && !parsed.data.ids?.length)) {
        return fail("VALIDATION_FAILED", "Send ids or all:true", requestId);
      }
      const { all, ids } = parsed.data;

      // Read first, so the audit row can say WHAT was removed. After the
      // delete there is nothing left to describe.
      const doomed = await getDb().execute<{ id: number; title: string; event_key: string }>(sql`
        select id, title, event_key from wms.notification
         where recipient_user_id = ${actor.session.userId}
           ${all ? sql`` : sql`and id in (${sql.join(ids!.map((i) => sql`${i}`), sql`, `)})`}
         order by id
         limit 500
      `);
      if (doomed.length === 0) return ok({ deleted: 0 }, requestId);

      await auditQuietly({
        action: "notification.deleted",
        operation: "DELETE",
        entityType: "notification",
        entityId: doomed.length === 1 ? String(doomed[0]!.id) : "*",
        entityLabel: doomed.length === 1 ? doomed[0]!.title : `${doomed.length} notifications`,
        actorUserId: actor.session.userId,
        actorEmail: actor.session.email,
        actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
        reason: all ? "cleared all own notifications" : "deleted own notifications",
        before: {
          // Capped: an audit row is a record, not an archive.
          items: doomed.slice(0, 50).map((d) => ({ id: d.id, eventKey: d.event_key, title: d.title })),
        },
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        requestId,
        metadata: { count: doomed.length, deliveryRowsCascaded: true },
      });

      const gone = await getDb().execute<{ id: number }>(sql`
        delete from wms.notification
         where recipient_user_id = ${actor.session.userId}
           and id in (${sql.join(doomed.map((d) => sql`${d.id}`), sql`, `)})
        returning id
      `);

      return ok({ deleted: gone.length }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
