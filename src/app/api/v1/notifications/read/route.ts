import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { getDb } from "@/db";
import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  ids: z.array(z.number().int().positive()).max(200).optional(),
  all: z.boolean().optional(),
});

/** POST /api/v1/notifications/read — mark mine read: `{ids}` or `{all:true}`. */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor } = await requirePermission("notification.read", { entityType: "notification" });
      const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
      if (!parsed.success || (!parsed.data.all && !parsed.data.ids?.length)) {
        return fail("VALIDATION_FAILED", "Send ids or all:true", requestId);
      }
      const rows = await getDb().execute<{ id: number }>(sql`
        update wms.notification set read_at = now()
         where recipient_user_id = ${actor.session.userId} and read_at is null
           ${parsed.data.all ? sql`` : sql`and id in (${sql.join(parsed.data.ids!.map((i) => sql`${i}`), sql`, `)})`}
        returning id
      `);
      return ok({ marked: rows.length }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
