import "server-only";

import type { NextRequest } from "next/server";

import { fail, handler, ok } from "@/lib/api/respond";
import { requirePermission, type Actor } from "@/lib/auth/guard";
import { idFrom, metaOf, respondError } from "@/lib/inward/http";
import { scopeFor, type InwardScope, type Meta } from "@/lib/inward/ops";

/**
 * The shared shape of every carton route: resolve the request id, hold
 * `inward.goods.<verb>`, work out the scope from that grant (ALL for the
 * super admin, the actor's own warehouses for the warehouse side), run.
 * Who may actually do what to THIS request is then decided by
 * `cartonCan` inside the carton functions.
 */
export function cartonRoute(
  verb: "update" | "create",
  run: (ctx: {
    actor: Actor;
    scope: InwardScope;
    id: number;
    cartonId: number | null;
    request: NextRequest;
    meta: Meta;
  }) => Promise<unknown>,
) {
  return (request: NextRequest, context: { params: Promise<{ id: string; cartonId?: string }> }) =>
    handler(async ({ requestId }) => {
      try {
        const params = await context.params;
        const id = idFrom(params.id);
        if (id === null) return fail("NOT_FOUND", "No such inward request", requestId);
        const cartonId = params.cartonId === undefined ? null : idFrom(params.cartonId);
        if (params.cartonId !== undefined && cartonId === null) return fail("NOT_FOUND", "No such carton", requestId);
        const { actor, grant } = await requirePermission(`inward.goods.${verb}`, {
          entityType: "inward_request",
          entityId: String(id),
        });
        const result = await run({ actor, scope: scopeFor(actor, grant), id, cartonId, request, meta: metaOf(request, requestId) });
        if (result instanceof Response) return result;
        return ok(result, requestId);
      } catch (error) {
        return respondError(error, requestId);
      }
    })();
}
