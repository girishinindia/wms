import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/admin/roles — the role list, for a native client.
 *
 * Keys, names, levels, how many people hold each and how many
 * permissions each carries — what the web index shows before a role is
 * opened. `role.read` at ALL, as the sidebar gates it: `role_permission`
 * is platform-wide truth and a scoped read of it means nothing.
 */
export async function GET() {
  return handler(async ({ requestId }) => {
    try {
      const { grant } = await requirePermission("role.read", {
        entityType: "role",
      });
      if (grant.scope !== "ALL") {
        return fail("FORBIDDEN", "Roles are platform-level only.", requestId);
      }

      const rows = await getDb().execute<{
        key: string;
        name: string;
        domain: string;
        level: number;
        description: string | null;
        holders: number;
        permissions: number;
      }>(sql`
        select r.key, r.name, r.domain::text as domain, r.level, r.description,
               (select count(distinct ura.user_id)::int
                  from wms.user_role_assignment ura
                  join wms.users u on u.id = ura.user_id and u.deleted_at is null
                 where ura.role = r.key and ura.revoked_at is null) as holders,
               (select count(*)::int from wms.role_permission rp
                 where rp.role = r.key) as permissions
          from wms.role r
         order by r.level desc, r.name
      `);

      return ok(
        {
          roles: rows.map((r) => ({
            key: r.key,
            name: r.name,
            domain: r.domain,
            level: Number(r.level),
            description: r.description,
            holders: Number(r.holders),
            permissions: Number(r.permissions),
          })),
        },
        requestId,
      );
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
