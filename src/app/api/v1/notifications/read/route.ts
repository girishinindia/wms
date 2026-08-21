import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { getDb } from "@/db";
import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  ids: z.array(z.number().int().positive()).max(300).optional(),
  all: z.boolean().optional(),
  /** false marks them UNREAD again — the notifications screen offers it. */
  read: z.boolean().default(true),
});

/**
 * POST /api/v1/notifications/read — mark mine read (or unread with
 * `read:false`): `{ids}` or `{all:true}`.
 *
 * The authorisation is the WHERE clause: `recipient_user_id` is the
 * session's own id and never comes from the request, so "own" cannot be
 * widened by sending somebody else's ids.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor } = await requirePermission("notification.read", { entityType: "notification" });
      const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
      if (!parsed.success || (!parsed.data.all && !parsed.data.ids?.length)) {
        return fail("VALIDATION_FAILED", "Send ids or all:true", requestId);
      }
      const markRead = parsed.data.read;
      const rows = await getDb().execute<{ id: number }>(sql`
        update wms.notification
           set read_at = ${markRead ? sql`now()` : sql`null`}
         where recipient_user_id = ${actor.session.userId}
           ${markRead ? sql`and read_at is null` : sql`and read_at is not null`}
           ${parsed.data.all ? sql`` : sql`and id in (${sql.join(parsed.data.ids!.map((i) => sql`${i}`), sql`, `)})`}
        returning id
      `);
      return ok({ marked: rows.length }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
