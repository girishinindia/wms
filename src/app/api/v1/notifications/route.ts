import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { getDb } from "@/db";
import { handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/notifications — my in-app notifications, newest first.
 *
 * `notification.read` at OWN: every role holds it, and "own" is the
 * recipient column, never a parameter. Returns the unread count with the
 * page so the bell needs one call.
 */
export async function GET(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor } = await requirePermission("notification.read", { entityType: "notification" });
      const limit = Math.min(50, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 20)));
      const unreadOnly = request.nextUrl.searchParams.get("unread") === "1";
      const rows = await getDb().execute<{
        id: number; event_key: string; title: string; body: string; action_url: string | null;
        created_at: string; read_at: string | null;
      }>(sql`
        select id, event_key, title, body, action_url, created_at::text as created_at, read_at::text as read_at
          from wms.notification
         where recipient_user_id = ${actor.session.userId}
           ${unreadOnly ? sql`and read_at is null` : sql``}
         order by created_at desc
         limit ${limit}
      `);
      const [{ unread }] = await getDb().execute<{ unread: number }>(sql`
        select count(*)::int as unread from wms.notification
         where recipient_user_id = ${actor.session.userId} and read_at is null
      `);
      return ok(
        {
          unread,
          items: rows.map((r) => ({
            id: r.id, eventKey: r.event_key, title: r.title, body: r.body,
            actionUrl: r.action_url, createdAt: r.created_at, readAt: r.read_at,
          })),
        },
        requestId,
      );
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
