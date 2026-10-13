import { deliveryRoute, parse } from "@/lib/delivery/http";
import { InwardError } from "@/lib/inward/ops";
import {
  cancelDo,
  confirmDeparture,
  loadingComplete,
  lrStep,
  removePackage,
  reopenLoading,
  setDoHold,
} from "@/lib/outward/ops";
import { doActionSchema } from "@/lib/validation/api-outward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/outward/{id}/action — { action, reason?, packageId? }. Who may do which is decided per DO. */
export const POST = deliveryRoute("outward.order.read", async ({ actor, id, body, meta }) => {
  const { action, reason, packageId } = parse(doActionSchema, body);
  const run = () => {
    switch (action) {
      case "HOLD":
        return setDoHold(actor, id!, true, reason ?? null, meta);
      case "RESUME":
        return setDoHold(actor, id!, false, null, meta);
      case "CANCEL":
        return cancelDo(actor, id!, reason ?? "", meta);
      case "LOADED":
        return loadingComplete(actor, id!, meta);
      case "REOPEN":
        return reopenLoading(actor, id!, meta);
      case "DEPART":
        return confirmDeparture(actor, id!, meta);
      case "COLLECTED":
      case "SUBMITTED":
        return lrStep(actor, id!, action, meta);
      case "REMOVE_PACKAGE":
        if (!packageId) throw new InwardError("VALIDATION_FAILED", "Choose the package");
        return removePackage(actor, id!, packageId, meta);
    }
  };
  return { order: await run() };
});
