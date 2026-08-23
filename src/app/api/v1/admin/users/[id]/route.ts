import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { getDb } from "@/db";
import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { applyToUser } from "@/lib/accounts/lifecycle";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { mayActOnUser } from "@/lib/users/authority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/v1/admin/users/[id] — soft-delete a login, and with it the
 * company it owns (IMPORTER) or the profile that points at it
 * (SALES_AGENT). See lifecycle.ts. A super admin can never be deleted
 * this way; the database enforces it as well as this handler.
 */
export async function DELETE(
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
      const { actor } = await requirePermission("user.delete", {
        entityType: "user",
        entityId: String(targetUserId),
      });
      const rows = await getDb().execute<{ is_super: boolean }>(sql`
        select wms.is_super_admin(u.id) as is_super from wms.users u
         where u.id = ${targetUserId} and u.deleted_at is null
      `);
      if (rows.length === 0) return fail("NOT_FOUND", "No such user", requestId);
      if (rows[0]!.is_super) return fail("FORBIDDEN", "A super admin cannot be deleted.", requestId);
      if (targetUserId === actor.session.userId) {
        return fail("CONFLICT", "You cannot delete your own account from here.", requestId);
      }
      // Nobody holds user.delete below ALL today, so this changes
      // nothing yet. It is here so that granting it at WAREHOUSE
      // tomorrow does not quietly hand one branch the power to delete
      // another's staff.
      const reach = await mayActOnUser(actor, targetUserId, "user.delete", "delete it");
      if (reach !== true) return fail("FORBIDDEN", reach.reason, requestId);
      const reason = request.nextUrl.searchParams.get("reason") ?? "Deleted from the users screen";
      const linked = await applyToUser(targetUserId, "DELETE", actor, {
        requestId, ip: clientIp(request.headers), userAgent: request.headers.get("user-agent"),
      }, reason);
      return ok({ ok: true as const, ...linked }, requestId);
    } catch (error) {
      if (error instanceof Error && /super.?admin/i.test(error.message)) {
        return fail("FORBIDDEN", "A super admin cannot be deleted.", requestId);
      }
      return toResponse(error, requestId);
    }
  })();
}
