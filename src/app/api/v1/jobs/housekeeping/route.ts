import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { pruneSessions } from "@/lib/auth/session";
import { jobRoute } from "@/lib/jobs/handler";
import { announce } from "@/lib/notify/announce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/v1/jobs/housekeeping — QStash schedule, daily.
 *
 *  • prune expired / long-revoked sessions (kept 7 days as evidence);
 *  • drop spent verification tokens older than 7 days;
 *  • nudge importers who registered ≥3 days ago and never submitted
 *    their profile — once a week at most, by the notification's own
 *    dedupe key (event:user:week).
 */
const handler = jobRoute("housekeeping", async () => {
  const sessions = await pruneSessions();

  const tokens = await getDb().execute<{ id: number }>(sql`
    delete from wms.user_verification_token
     where (consumed_at is not null and consumed_at < now() - interval '7 days')
        or (expires_at < now() - interval '7 days')
    returning id
  `);

  const stale = await getDb().execute<{ id: number; code: string; company_name: string; days: number }>(sql`
    select i.id, i.code, i.company_name,
           floor(extract(epoch from (now() - i.created_at)) / 86400)::int as days
      from wms.importer i
     where i.deleted_at is null
       and i.status = 'PENDING'
       and i.kyc_status in ('NOT_STARTED', 'REJECTED')
       and i.created_at < now() - interval '3 days'
     order by i.created_at
     limit 200
  `);
  let nudged = 0;
  for (const imp of stale) {
    const week = Math.floor(Date.now() / (7 * 86400_000));
    const r = await announce({
      eventKey: "importer.kyc_nudge",
      values: { company: imp.company_name, code: imp.code, days: String(imp.days) },
      dedupeSuffix: `week:${week}`,
      importerId: imp.id,
      entityType: "importer",
      entityId: String(imp.id),
    });
    nudged += r.recipients;
  }

  return { sessionsPruned: sessions, tokensPruned: tokens.length, importersNudged: nudged };
});
export { handler as POST, handler as GET };
