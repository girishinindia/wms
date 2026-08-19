import { jobRoute } from "@/lib/jobs/handler";
import { requeueDue } from "@/lib/notify/outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/v1/jobs/retry-failed — QStash schedule, every 15 minutes.
 *
 * Re-queues FAILED deliveries whose retry time has come and QUEUED rows
 * that never got a first attempt. Rows at their attempt cap (3) are
 * never selected: after three failures a notification is left alone.
 */
const handler = jobRoute("retry-failed", async () => requeueDue(200));
export { handler as POST, handler as GET };
