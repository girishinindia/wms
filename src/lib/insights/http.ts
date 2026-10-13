import "server-only";

import type { NextRequest } from "next/server";

import { handler, ok } from "@/lib/api/respond";
import { requireActor, type Actor } from "@/lib/auth/guard";
import { respondError } from "@/lib/inward/http";

/** A signed-in route; who may see what is decided per dashboard / report by its lens. */
export function insightsRoute(run: (ctx: { actor: Actor; request: NextRequest; params: Record<string, string>; requestId: string }) => Promise<unknown>) {
  return (request: NextRequest, context: { params: Promise<Record<string, string>> }) =>
    handler(async ({ requestId }) => {
      try {
        const params = ((await context?.params) ?? {}) as Record<string, string>;
        const actor = await requireActor();
        const result = await run({ actor, request, params, requestId });
        if (result instanceof Response) return result;
        return ok(result, requestId);
      } catch (error) {
        return respondError(error, requestId);
      }
    })();
}
