import "server-only";

import type { NextRequest } from "next/server";
import type { z } from "zod";

import { fail, fieldsFrom, handler, ok } from "@/lib/api/respond";
import { requirePermission, requireVerifiedImporter, type Actor } from "@/lib/auth/guard";
import { idFrom, jsonBody, metaOf, respondError } from "@/lib/inward/http";
import { InwardError, type Meta } from "@/lib/inward/ops";

/**
 * The shape of every review route — the delivery-note helper's, with
 * `review` on the denial audit. `verified` adds the importer gate: a
 * company still on its profile step has nothing to review yet.
 * Who may touch WHICH review is decided in lib/reviews/ops.
 */
export function reviewRoute(
  permission: string,
  run: (ctx: { actor: Actor; id: number | null; body: unknown; request: NextRequest; meta: Meta }) => Promise<unknown>,
  options: { verified?: boolean } = {},
) {
  return (request: NextRequest, context: { params: Promise<Record<string, string>> }) =>
    handler(async ({ requestId }) => {
      try {
        const params = ((await context?.params) ?? {}) as Record<string, string>;
        const raw = params.id;
        const id = raw === undefined ? null : idFrom(raw);
        if (raw !== undefined && id === null) return fail("NOT_FOUND", "Not found", requestId);
        const { actor } = options.verified
          ? await requireVerifiedImporter(permission, { entityType: "review" })
          : await requirePermission(permission, { entityType: "review" });
        const body = request.method === "GET" || request.method === "DELETE" ? undefined : await jsonBody(request);
        const result = await run({ actor, id, body, request, meta: metaOf(request, requestId) });
        if (result instanceof Response) return result;
        return ok(result, requestId);
      } catch (error) {
        return respondError(error, requestId);
      }
    })();
}

/**
 * Parse a body or throw the field errors. Typed on the schema's OUTPUT,
 * because both review schemas fill defaults (`showName`, `note`).
 */
export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const fields = fieldsFrom(r.error);
    throw new InwardError("VALIDATION_FAILED", Object.values(fields)[0] ?? "Check the highlighted fields", fields);
  }
  return r.data;
}
