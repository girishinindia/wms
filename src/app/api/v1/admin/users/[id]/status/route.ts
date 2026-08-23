import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { getDb } from "@/db";
import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { applyToUser } from "@/lib/accounts/lifecycle";
import { mayActOnUser } from "@/lib/users/authority";
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
      /**
       * A WAREHOUSE-scoped `user.update` sails through
       * `requirePermission`, because a create and a list legitimately
       * name no warehouse. Here the warehouse is a property of the
       * TARGET, so it has to be checked against them: without this line
       * one branch's admin could suspend another branch's.
       */
      const reach = await mayActOnUser(
        actor,
        targetUserId,
        "user.update",
        status === "SUSPENDED" ? "suspend it" : "reinstate it",
      );
      if (reach !== true) return fail("FORBIDDEN", reach.reason, requestId);

      if (before[0]!.status === status) {
        return ok({ ok: true as const }, requestId);
      }

      // The login, and whatever it owns: an IMPORTER's company (and its
      // agents), a SALES_AGENT's profile. One life-cycle — see lifecycle.ts.
      const linked = await applyToUser(
        targetUserId,
        status === "SUSPENDED" ? "SUSPEND" : "REACTIVATE",
        actor,
        { requestId, ip: clientIp(request.headers), userAgent: request.headers.get("user-agent") },
        reason ?? null,
      );

      return ok({ ok: true as const, ...linked }, requestId);
    } catch (error) {
      if (error instanceof Error && /super.?admin/i.test(error.message)) {
        return fail("FORBIDDEN", "A super admin cannot be suspended by anyone else.", requestId);
      }
      return toResponse(error, requestId);
    }
  })();
}
