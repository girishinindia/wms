import { sql } from "drizzle-orm";

import NotificationsTable, { type NotificationRow } from "@/components/admin/NotificationsTable";
import { Denied, PageHeader } from "@/components/admin/ui";
import { getDb } from "@/db";
import { currentActor } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * /admin/notifications — everything the bell shows ten of.
 *
 * Own rows only, and "own" is the session's user id in the WHERE clause,
 * never a parameter — the same rule the bell and the API follow.
 */
export default async function NotificationsPage() {
  const actor = await currentActor();
  if (!actor) return <Denied what="notifications" />;

  const rows = await getDb().execute<{
    id: number;
    event_key: string;
    title: string;
    body: string;
    action_url: string | null;
    created_at: string;
    read_at: string | null;
  }>(sql`
    select id, event_key, title, body, action_url,
           created_at::text as created_at, read_at::text as read_at
      from wms.notification
     where recipient_user_id = ${actor.session.userId}
     order by created_at desc
     limit 300
  `);

  const items: NotificationRow[] = rows.map((r) => ({
    id: Number(r.id),
    eventKey: r.event_key,
    title: r.title,
    body: r.body,
    actionUrl: r.action_url,
    createdAt: r.created_at,
    readAt: r.read_at,
  }));
  const unread = items.filter((i) => i.readAt === null).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={
          items.length === 0
            ? "Nothing has been sent to this account yet."
            : `${items.length} kept · ${unread} unread`
        }
      />
      <NotificationsTable rows={items} unread={unread} />
    </>
  );
}
