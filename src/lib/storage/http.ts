import "server-only";

import type { NextRequest } from "next/server";

import { fail, handler, ok } from "@/lib/api/respond";
import { requirePermission, type Actor } from "@/lib/auth/guard";
import { idFrom, jsonBody, metaOf, respondError } from "@/lib/inward/http";
import { InwardError, type Meta } from "@/lib/inward/ops";

/**
 * The shared shape of the storage routes: hold `permission` (beyond OWN —
 * an importer's read of their own goods never reaches these), resolve the
 * id in the path, run. Which warehouse the person may touch is decided
 * inside, from the same grant.
 */
export function storageRoute(
  permission: string,
  run: (ctx: { actor: Actor; id: number | null; body: unknown; request: NextRequest; meta: Meta }) => Promise<unknown>,
) {
  // Next always passes the context; a route without a [segment] gets empty
  // params, so they are read defensively.
  return (request: NextRequest, context: { params: Promise<Record<string, string>> }) =>
    handler(async ({ requestId }) => {
      try {
        const params = ((await context?.params) ?? {}) as Record<string, string>;
        const raw = params.id;
        const id = raw === undefined ? null : idFrom(raw);
        if (raw !== undefined && id === null) return fail("NOT_FOUND", "Not found", requestId);
        const { actor, grant } = await requirePermission(permission, { entityType: "storage" });
        if (grant.scope === "OWN") throw new InwardError("FORBIDDEN", "You do not have permission to do that.");
        const body = request.method === "GET" ? undefined : await jsonBody(request);
        const result = await run({ actor, id, body, request, meta: metaOf(request, requestId) });
        return ok(result, requestId);
      } catch (error) {
        return respondError(error, requestId);
      }
    })();
}
