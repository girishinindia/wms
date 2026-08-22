import "server-only";

import { headers } from "next/headers";

import { HandledError } from "@/lib/api/respond";
import { auditQuietly } from "@/lib/audit";
import { requirePermission, type Actor } from "@/lib/auth/guard";

/**
 * The Warehouses area is the super admin's alone.
 *
 * Saying that with a permission check is harder than it looks.
 * `warehouse.read` is held by SEVEN roles — every warehouse manager, at
 * WAREHOUSE scope — so a guard keyed on it admits the whole floor. Even
 * `warehouse.update` is held by WAREHOUSE_ADMIN over their own site.
 *
 * What actually separates a super admin is the SCOPE: only they hold
 * these at ALL. So the scope is the check, and the permission is only
 * which verb is being asked about. The sidebar keys its entries on
 * `warehouse.create`, which nobody else holds at any scope — two
 * independent gates, because a menu that hides a link is decoration and
 * this is the part that refuses.
 */
export async function requirePlatformWarehouse(
  permission: "warehouse.create" | "warehouse.update" | "warehouse.delete" | "warehouse.read",
  entityId?: string,
): Promise<{ actor: Actor }> {
  const { actor, grant } = await requirePermission(permission, {
    entityType: "warehouse",
    ...(entityId ? { entityId } : {}),
  });
  if (grant.scope !== "ALL") {
    /**
     * The refusal is written down here, not left to `requirePermission`.
     *
     * That helper audits the denial it makes itself — "you do not hold
     * this permission" — and a warehouse manager DOES hold
     * `warehouse.read` and `warehouse.update`. They pass it and are
     * stopped one line later by the scope, which would otherwise be the
     * only 403 in the system that leaves no trace. A manager trying to
     * delete a site is precisely the row somebody goes looking for
     * afterwards.
     */
    const headerList = await headers();
    await auditQuietly({
      action: `admin.${permission}`,
      operation: "DENY",
      entityType: "warehouse",
      entityId: entityId ?? "-",
      actorUserId: actor.session.userId,
      actorEmail: actor.session.email,
      actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
      result: "DENIED",
      reason: "Held only at a warehouse scope; this area is platform-wide",
      ip: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: headerList.get("user-agent"),
      metadata: { permission, heldScope: grant.scope },
    });
    throw new HandledError("FORBIDDEN", "You do not have permission to do that.");
  }
  return { actor };
}

/** The page-side twin: true when this actor may see the area at all. */
export function isPlatformWarehouseAdmin(actor: Actor): boolean {
  return actor.permissions.some((p) => p.permission === "warehouse.create" && p.scope === "ALL");
}
