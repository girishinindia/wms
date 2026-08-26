import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { handler, ok, toResponse } from "@/lib/api/respond";
import { grantFor, currentActor } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/admin/enquiries — how many are waiting to be read.
 *
 * The count only. The list itself is server-rendered on the screen,
 * like every other admin table here; this exists for the sidebar badge,
 * which asks once a minute forever and has no business pulling a
 * hundred rows of a stranger's contact details to count them.
 *
 * Answers `{ unread: 0 }` rather than 403 to anybody who cannot read
 * enquiries. The badge polls from the shared store, which runs for
 * every signed-in user; a 403 once a minute for everyone who is not a
 * super admin would fill the log with denials that mean nothing, and
 * zero is the honest answer to "how many enquiries should I show you".
 */
export async function GET() {
  return handler(async ({ requestId }) => {
    try {
      const actor = await currentActor();
      const grant = actor ? grantFor(actor, "enquiry.read") : null;
      if (!actor || !grant || grant.scope !== "ALL") {
        return ok({ unread: 0 }, requestId);
      }

      /**
       * Counted straight off `enquiry_unread_idx`, whose predicate is
       * exactly this WHERE clause — so read and deleted rows are not
       * in the index at all and the answer stays cheap however many
       * enquiries accumulate.
       */
      const [row] = await getDb().execute<{ unread: number }>(sql`
        select count(*)::int as unread
          from wms.enquiry
         where read_at is null and deleted_at is null`);

      return ok({ unread: row?.unread ?? 0 }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
