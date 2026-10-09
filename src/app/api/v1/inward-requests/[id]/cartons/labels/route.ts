import { cartonRoute } from "@/lib/inward/carton-http";
import { cartonLabels, type LabelFilter } from "@/lib/inward/cartons";
import { idFrom } from "@/lib/inward/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/inward-requests/{id}/cartons/labels — what each sticker
 * shows and the text of its QR.
 *
 *   ?filter=all | pending | label_pending
 *   ?filter=line&lineId=12
 *   ?filter=range&from=1&to=100
 *   ?filter=ids&ids=4,5,6
 */
export const GET = cartonRoute("update", ({ actor, scope, id, request }) => {
  const q = request.nextUrl.searchParams;
  const kind = q.get("filter") ?? "all";
  const filter: LabelFilter =
    kind === "pending"
      ? { kind: "pending" }
      : kind === "label_pending"
        ? { kind: "label_pending" }
        : kind === "line"
          ? { kind: "line", lineId: idFrom(q.get("lineId") ?? "") ?? 0 }
          : kind === "range"
            ? { kind: "range", from: Number(q.get("from")) || 1, to: Number(q.get("to")) || 1 }
            : kind === "ids"
              ? {
                  kind: "ids",
                  ids: (q.get("ids") ?? "")
                    .split(",")
                    .map((x) => idFrom(x.trim()))
                    .filter((x): x is number => x !== null)
                    .slice(0, 5000),
                }
              : { kind: "all" };
  return cartonLabels(actor, scope, id, filter);
});
