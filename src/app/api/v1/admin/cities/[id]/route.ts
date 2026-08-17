import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { getDb } from "@/db";
import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { auditQuietly } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { isUniqueViolation } from "@/lib/db-errors";
import { updateCityRequestSchema } from "@/lib/validation/api-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/v1/admin/cities/[id] — rename, or retire.
 *
 * There is no DELETE. `warehouse`, `importer`, `importer_client` and
 * `transporter` all hold a foreign key to `city`, so deleting one either
 * fails or orphans an address that was correct when it was entered.
 * `is_active = false` takes it out of the pickers and leaves every
 * existing address intact, which is what "we do not use that city any
 * more" actually means.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { actor } = await requirePermission("master.city.update", {
        entityType: "master.city",
      });

      const { id: rawId } = await context.params;
      const id = Number(rawId);
      if (!Number.isInteger(id) || id <= 0) {
        return fail("NOT_FOUND", "No such city", requestId);
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      }

      const parsed = updateCityRequestSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const { name, isActive } = parsed.data;

      const before = await getDb().execute<{
        id: number;
        name: string;
        is_active: boolean;
        state_id: number;
      }>(sql`
        select id, name, is_active, state_id
          from wms.city where id = ${id} and deleted_at is null
      `);
      if (before.length === 0) return fail("NOT_FOUND", "No such city", requestId);

      const rows = await getDb().execute<{ id: number; name: string; is_active: boolean }>(sql`
        update wms.city
           set name = coalesce(${name ?? null}, name),
               is_active = coalesce(${isActive ?? null}, is_active),
               updated_by = ${actor.session.userId}
         where id = ${id} and deleted_at is null
        returning id, name, is_active
      `);

      await auditQuietly({
        action: "master.city.updated",
        operation: "UPDATE",
        entityType: "master.city",
        entityId: String(id),
        entityLabel: rows[0]?.name ?? null,
        actorUserId: actor.session.userId,
        actorEmail: actor.session.email,
        actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
        before: before[0],
        after: rows[0],
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        requestId,
      });

      return ok({ ok: true as const }, requestId);
    } catch (error) {
      // A rename onto an existing name in the same state hits the unique
      // index. Reported on the field rather than as a 500, which is what
      // a bare constraint violation would surface as — and it did, until
      // this stopped matching on the outer message. Drizzle wraps the
      // driver error, so the SQLSTATE is on `cause` and the outer text is
      // always just `Failed query: …`.
      if (isUniqueViolation(error)) {
        return fail("CONFLICT", "That state already has a city with this name", requestId, {
          fields: { name: "Already exists in this state" },
        });
      }
      return toResponse(error, requestId);
    }
  })();
}
