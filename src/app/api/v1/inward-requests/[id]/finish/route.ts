import { requirePermission } from "@/lib/auth/guard";
import { cartonRoute } from "@/lib/inward/carton-http";
import { cartonOverview } from "@/lib/inward/cartons";
import { jsonBody } from "@/lib/inward/http";
import { decideRequest, InwardError, scopeFor } from "@/lib/inward/ops";
import { cartonFinishSchema } from "@/lib/validation/api-inward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/inward-requests/{id}/finish — { confirm? }
 *
 * The dock is done with this container: the request is COMPLETED. When
 * cartons were never scanned the first call refuses and says how many;
 * sending { confirm: true } completes it anyway (they stay "missing").
 */
export const POST = cartonRoute("update", async ({ actor, scope, id, request, meta }) => {
  const parsed = cartonFinishSchema.safeParse((await jsonBody(request)) ?? {});
  const confirm = parsed.success && parsed.data.confirm === true;
  const overview = await cartonOverview(actor, scope, id);
  if (!overview.can.finish) throw new InwardError("CONFLICT", "This request cannot be finished from here");
  const { missing, hold } = overview.totals;
  if (missing > 0 && !confirm) {
    throw new InwardError(
      "CONFLICT",
      `${missing} carton${missing === 1 ? " was" : "s were"} never scanned${hold ? ` and ${hold} ${hold === 1 ? "is" : "are"} on hold` : ""}. Finish anyway?`,
      { missing: String(missing), hold: String(hold) },
    );
  }
  const { grant } = await requirePermission("inward.request.approve", { entityType: "inward_request", entityId: String(id) });
  return decideRequest(actor, scopeFor(actor, grant), id, "COMPLETE", null, meta);
});
