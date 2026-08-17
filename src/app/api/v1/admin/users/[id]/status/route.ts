import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { getDb } from "@/db";
import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { auditQuietly } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { revokeAllSessions } from "@/lib/auth/session";
import { setUserStatusRequestSchema } from "@/lib/validation/api-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/v1/admin/users/[id]/status — suspend, or reinstate.
 *
 * Suspending kills the account's live sessions as well as setting the
 * column. `resolveSession` already joins `users` and requires
 * `status = 'ACTIVE'`, so an existing session would stop working at the
 * next request either way — but revoking explicitly leaves a row saying
 * when and why, which "it silently stopped resolving" does not.
 *
 * There is no delete. `protect_super_admin` blocks one super admin
 * removing another, users are soft-deleted everywhere else in this
 * schema, and an account that has touched a goods receipt has to remain
 * resolvable for the audit trail to read correctly.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { id: rawId } = await context.params;
      const targetUserId = Number(rawId);
      if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        return fail("NOT_FOUND", "No such user", requestId);
      }

      const { actor } = await requirePermission("user.update", {
        entityType: "user",
        entityId: String(targetUserId),
      });

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      }

      const parsed = setUserStatusRequestSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const { status, reason } = parsed.data;

      const before = await getDb().execute<{
        id: number;
        email: string;
        status: string;
        is_super: boolean;
      }>(sql`
        select u.id, u.email::text as email, u.status::text as status,
               wms.is_super_admin(u.id) as is_super
          from wms.users u where u.id = ${targetUserId} and u.deleted_at is null
      `);
      if (before.length === 0) return fail("NOT_FOUND", "No such user", requestId);

      // The trigger enforces this too. Caught here so the message names
      // the rule rather than quoting a plpgsql exception.
      if (before[0]!.is_super && targetUserId !== actor.session.userId) {
        return fail(
          "FORBIDDEN",
          "A super admin cannot be suspended by anyone else.",
          requestId,
        );
      }
      if (before[0]!.status === status) {
        return ok({ ok: true as const }, requestId);
      }

      await getDb().execute(sql`
        update wms.users
           set status              = ${status}::wms.record_status,
               deactivation_reason = ${status === "SUSPENDED" ? (reason ?? null) : null},
               deactivated_by      = ${status === "SUSPENDED" ? actor.session.userId : null},
               deactivated_at      = ${status === "SUSPENDED" ? sql`now()` : sql`null`},
               updated_by          = ${actor.session.userId}
         where id = ${targetUserId} and deleted_at is null
      `);

      let revoked = 0;
      if (status === "SUSPENDED") {
        revoked = await revokeAllSessions(targetUserId, `suspended: ${reason ?? "no reason"}`);
      }

      await auditQuietly({
        action: status === "SUSPENDED" ? "user.deactivated" : "user.reactivated",
        operation: "UPDATE",
        entityType: "user",
        entityId: String(targetUserId),
        entityLabel: before[0]!.email,
        actorUserId: actor.session.userId,
        actorEmail: actor.session.email,
        actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
        reason: reason ?? null,
        before: before[0],
        after: { status },
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        requestId,
        metadata: { sessionsRevoked: revoked },
      });

      return ok({ ok: true as const }, requestId);
    } catch (error) {
      if (error instanceof Error && /super.?admin/i.test(error.message)) {
        return fail("FORBIDDEN", "A super admin cannot be suspended by anyone else.", requestId);
      }
      return toResponse(error, requestId);
    }
  })();
}
