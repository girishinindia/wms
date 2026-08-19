import { jobRoute } from "@/lib/jobs/handler";
import { attemptDelivery } from "@/lib/notify/outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/v1/jobs/deliver  {deliveryId} — called by QStash.
 *
 * One send attempt for one `notification_delivery` row. The row's own
 * attempt counter decides whether there is a next one (max 3); a
 * duplicated message finds the row already SENT and does nothing.
 */
export const POST = jobRoute("deliver", async (body) => {
  const deliveryId = Number(body.deliveryId);
  if (!Number.isInteger(deliveryId) || deliveryId <= 0) return { skipped: "no deliveryId" };
  const outcome = await attemptDelivery(deliveryId);
  return outcome
    ? { deliveryId, status: outcome.status, errorCode: outcome.errorCode ?? null }
    : { deliveryId, status: "NOOP" };
});
