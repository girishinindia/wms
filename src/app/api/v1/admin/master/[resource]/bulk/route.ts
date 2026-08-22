import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { invalidateGeo } from "@/lib/admin/geo";
import { resolveResource } from "@/lib/admin/master-registry";

import { deleteOne, dropPublicCache, setActive } from "@/lib/admin/master-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/admin/master/{resource}/bulk — one action, many rows.
 *
 * Row by row rather than one statement, deliberately. A single
 * `delete … where id in (…)` either succeeds for all or fails for all,
 * and "one of your twelve is still referenced" would fail the other
 * eleven with a message about a constraint. Per row, each outcome is
 * known and reported, each is audited, and the ones that could not be
 * done say why. Twelve small statements against a database two
 * milliseconds away is not a cost worth designing around.
 *
 * Capped at 200 ids per call so a runaway client cannot turn this into
 * a long transaction-free loop; the table only ever offers a page.
 */
const bodySchema = z.object({
  action: z.enum(["activate", "deactivate", "delete"]),
  ids: z.array(z.number().int().positive()).min(1).max(200),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ resource: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { resource: slug } = await context.params;
      const resource = resolveResource(slug);
      if (!resource) return fail("NOT_FOUND", "No such master table", requestId);

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      }
      const parsed = bodySchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the request", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const { action, ids } = parsed.data;

      const { actor } = await requirePermission(
        `${resource.permission}.${action === "delete" ? "delete" : "update"}`,
        { entityType: resource.table },
      );

      const meta = {
        requestId,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
      };

      const done: number[] = [];
      const skipped: { id: number; reason: string }[] = [];
      const notes: { id: number; note: string }[] = [];

      for (const id of [...new Set(ids)]) {
        const outcome =
          action === "delete"
            ? await deleteOne(resource, id, actor, meta)
            : await setActive(resource, id, action === "activate", actor, meta);

        if (outcome.ok) {
          done.push(id);
          if ("wasInUse" in outcome && outcome.wasInUse) {
            notes.push({ id, note: `${outcome.wasInUse} still use it` });
          }
        } else if (outcome.reason === "not_found") {
          skipped.push({ id, reason: "not found" });
        } else {
          skipped.push({ id, reason: `in use by ${outcome.detail}` });
        }
      }

      await invalidateGeo();
      dropPublicCache(resource);
      return ok({ action, done, skipped, notes }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
