import "server-only";

import type { NextRequest } from "next/server";
import type { z } from "zod";

import { fail, fieldsFrom, handler, ok } from "@/lib/api/respond";
import { requirePermission, requireVerifiedImporter, type Actor, type Grant } from "@/lib/auth/guard";
import { idFrom, jsonBody, metaOf, respondError } from "@/lib/inward/http";
import { InwardError, type Meta } from "@/lib/inward/ops";

/**
 * The shape of every delivery-note route: hold `permission`, resolve the
 * id in the path, read the body, run. `verified` adds the importer gate
 * (a company still on its profile step cannot make delivery notes).
 * Who may do what to THIS note is decided inside lib/delivery/ops.
 */
export function deliveryRoute(
  permission: string,
  run: (ctx: { actor: Actor; grant: Grant; id: number | null; body: unknown; request: NextRequest; meta: Meta }) => Promise<unknown>,
  options: { verified?: boolean } = {},
) {
  return (request: NextRequest, context: { params: Promise<Record<string, string>> }) =>
    handler(async ({ requestId }) => {
      try {
        const params = ((await context?.params) ?? {}) as Record<string, string>;
        const raw = params.id;
        const id = raw === undefined ? null : idFrom(raw);
        if (raw !== undefined && id === null) return fail("NOT_FOUND", "Not found", requestId);
        const { actor, grant } = options.verified
          ? await requireVerifiedImporter(permission, { entityType: "delivery_note" })
          : await requirePermission(permission, { entityType: "delivery_note" });
        const body = request.method === "GET" || request.method === "DELETE" ? undefined : await jsonBody(request);
        const result = await run({ actor, grant, id, body, request, meta: metaOf(request, requestId) });
        if (result instanceof Response) return result;
        return ok(result, requestId);
      } catch (error) {
        return respondError(error, requestId);
      }
    })();
}

/** Parse a body or throw the field errors. */
export function parse<T>(schema: z.ZodType<T>, body: unknown, message = "Check the highlighted fields"): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const fields = fieldsFrom(r.error);
    throw new InwardError("VALIDATION_FAILED", Object.values(fields)[0] ?? message, fields);
  }
  return r.data;
}

export function queryNumber(request: NextRequest, key: string): number | null {
  const v = request.nextUrl.searchParams.get(key);
  return v === null ? null : idFrom(v);
}
