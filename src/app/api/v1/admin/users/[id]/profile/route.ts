import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { getDb } from "@/db";
import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { auditQuietly } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { invalidateUser } from "@/lib/cache/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nameField = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[A-Za-z][A-Za-z .'-]*$/, "Letters only, with spaces or ' -");

const bodySchema = z.object({
  firstName: nameField.optional(),
  lastName: nameField.optional(),
});

/**
 * PATCH /api/v1/admin/users/[id]/profile — a super admin corrects
 * somebody's name. Email, mobile and password are NOT editable here or
 * anywhere else by hand: they change only through the owner's own
 * verified flows (OTP to the new address; old password to set a new one).
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { id } = await context.params;
      const targetUserId = Number(id);
      if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        return fail("VALIDATION_FAILED", "Bad user id", requestId);
      }
      const { actor, grant } = await requirePermission("user.update", {
        entityType: "user",
        entityId: String(targetUserId),
      });
      // OWN scope covers only yourself — and "yourself" is /api/v1/profile.
      if (grant.scope === "OWN" && targetUserId !== actor.session.userId) {
        return fail("FORBIDDEN", "You do not have permission to do that.", requestId);
      }
      const parsed = bodySchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const { firstName, lastName } = parsed.data;
      if (!firstName && !lastName) return fail("VALIDATION_FAILED", "Nothing to change", requestId);

      const rows = await getDb().execute<{ email: string }>(sql`
        update wms.users
           set first_name = coalesce(${firstName ?? null}, first_name),
               last_name = coalesce(${lastName ?? null}, last_name),
               updated_by = ${actor.session.userId}
         where id = ${targetUserId} and deleted_at is null
        returning email::text as email
      `);
      if (rows.length === 0) return fail("NOT_FOUND", "No such user", requestId);
      await invalidateUser(targetUserId);
      await auditQuietly({
        action: "user.profile_updated", operation: "UPDATE", entityType: "user",
        entityId: String(targetUserId), entityLabel: rows[0]!.email,
        actorUserId: actor.session.userId, actorEmail: actor.session.email,
        actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
        after: { firstName, lastName },
        ip: clientIp(request.headers), userAgent: request.headers.get("user-agent"), requestId,
      });
      return ok({ ok: true as const }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
