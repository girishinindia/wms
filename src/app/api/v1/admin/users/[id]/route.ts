import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { getDb } from "@/db";
import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { applyToUser } from "@/lib/accounts/lifecycle";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { listOverrides } from "@/lib/roles/matrix";
import { actorWarehouseIds, mayActOnUser } from "@/lib/users/authority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/admin/users/[id] — one person, for the review screen:
 * the account row, their live role bindings with the site and company
 * labels resolved, and their permission overrides.
 *
 * Visibility is the LIST's rule re-applied to one id: an ALL-scoped
 * `user.read` sees anyone; anything narrower sees themselves and users
 * wholly within their own sites. Answered as NOT_FOUND, not FORBIDDEN —
 * an id someone may not read should not be confirmable by the shape of
 * the refusal.
 */
export async function GET(
  _: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { id } = await context.params;
      const targetUserId = Number(id);
      if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        return fail("NOT_FOUND", "No such user", requestId);
      }

      const { actor, grant } = await requirePermission("user.read", {
        entityType: "user",
        entityId: String(targetUserId),
      });

      const everyone = grant.scope === "ALL" ? sql`true` : sql`false`;
      const sites = actorWarehouseIds(actor);
      const siteList =
        sites.length > 0
          ? sql.join(sites.map((w) => sql`${w}`), sql`, `)
          : sql`null`;

      const rows = await getDb().execute<{
        id: number;
        email: string;
        first_name: string;
        last_name: string;
        photo_url: string | null;
        mobile: string;
        status: string;
        email_verified: boolean;
        mobile_verified: boolean;
        must_change_password: boolean;
        last_login_at: string | null;
        created_at: string;
        is_super: boolean;
      }>(sql`
        select u.id, u.email::text as email, u.first_name, u.last_name,
               u.photo_url, u.mobile::text as mobile, u.status::text as status,
               u.email_verified_at is not null as email_verified,
               u.mobile_verified_at is not null as mobile_verified,
               u.must_change_password,
               u.last_login_at::text as last_login_at,
               u.created_at::text as created_at,
               wms.is_super_admin(u.id) as is_super
          from wms.users u
         where u.id = ${targetUserId} and u.deleted_at is null
           and (
             ${everyone}
             or u.id = ${actor.session.userId}
             or (
               exists (
                 select 1 from wms.user_role_assignment a
                  where a.user_id = u.id and a.revoked_at is null
                    and a.warehouse_id in (${siteList})
               )
               and not exists (
                 select 1 from wms.user_role_assignment a
                  where a.user_id = u.id and a.revoked_at is null
                    and (a.warehouse_id is null or a.warehouse_id not in (${siteList}))
               )
             )
           )
      `);
      const u = rows[0];
      if (!u) return fail("NOT_FOUND", "No such user", requestId);

      const roleRows = await getDb().execute<{
        id: number;
        role: string;
        role_domain: string;
        warehouse_id: number | null;
        warehouse_label: string | null;
        importer_id: number | null;
        importer_label: string | null;
        assigned_at: string;
      }>(sql`
        select ura.id, ura.role::text as role, ura.role_domain::text as role_domain,
               ura.warehouse_id,
               case when w.id is null then null
                    else (w.code || ' · ' || w.name) end as warehouse_label,
               ura.importer_id, i.company_name as importer_label,
               ura.assigned_at::text as assigned_at
          from wms.user_role_assignment ura
          left join wms.warehouse w on w.id = ura.warehouse_id
          left join wms.importer i on i.id = ura.importer_id
         where ura.user_id = ${targetUserId} and ura.revoked_at is null
         order by ura.assigned_at
      `);

      // The same loader the web drawer uses — one idea of "live".
      const overrides = await listOverrides(targetUserId);

      return ok(
        {
          user: {
            id: Number(u.id),
            email: u.email,
            firstName: u.first_name,
            lastName: u.last_name,
            photoUrl: u.photo_url,
            mobile: u.mobile,
            status: u.status,
            emailVerified: Boolean(u.email_verified),
            mobileVerified: Boolean(u.mobile_verified),
            mustChangePassword: Boolean(u.must_change_password),
            lastLoginAt: u.last_login_at,
            createdAt: u.created_at,
            isSuper: Boolean(u.is_super),
          },
          roles: roleRows.map((r) => ({
            id: Number(r.id),
            role: r.role,
            domain: r.role_domain,
            warehouseLabel: r.warehouse_label,
            importerLabel: r.importer_label,
            assignedAt: r.assigned_at,
          })),
          overrides,
        },
        requestId,
      );
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}

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
