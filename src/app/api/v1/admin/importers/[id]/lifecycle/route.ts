import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { getDb } from "@/db";
import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { applyToImporter } from "@/lib/accounts/lifecycle";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  action: z.enum(["suspend", "reactivate", "delete"]),
  reason: z.string().trim().min(3).max(300).optional(),
});

/**
 * POST /api/v1/admin/importers/[id]/lifecycle — suspend, reactivate or
 * delete a company. Its owner login, its sales agents and their logins
 * follow (lifecycle.ts). Suspend/reactivate need `importer.update`,
 * delete needs `importer.delete`.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { id } = await context.params;
      const importerId = Number(id);
      if (!Number.isInteger(importerId) || importerId <= 0) {
        return fail("VALIDATION_FAILED", "Bad importer id", requestId);
      }
      const parsed = bodySchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return fail("VALIDATION_FAILED", "Send action (suspend | reactivate | delete)", requestId);
      const { action, reason } = parsed.data;
      const { actor, grant } = await requirePermission(
        action === "delete" ? "importer.delete" : "importer.update",
        { entityType: "importer", entityId: String(importerId), importerId },
      );
      // An importer holds importer.update at OWN, over their own row.
      // Suspending or deleting your own company is not that.
      if (grant.scope === "OWN") return fail("FORBIDDEN", "You do not have permission to do that.", requestId);

      const rows = await getDb().execute<{ status: string; company_name: string }>(sql`
        select status::text as status, company_name from wms.importer where id = ${importerId} and deleted_at is null
      `);
      if (rows.length === 0) return fail("NOT_FOUND", "No such importer", requestId);
      const current = rows[0]!.status;
      if (action === "suspend" && current !== "ACTIVE") {
        return fail("CONFLICT", "Only an active (verified) company can be suspended.", requestId);
      }
      if (action === "reactivate" && current !== "SUSPENDED") {
        return fail("CONFLICT", "This company is not suspended.", requestId);
      }
      await applyToImporter(
        importerId,
        action === "delete" ? "DELETE" : action === "suspend" ? "SUSPEND" : "REACTIVATE",
        actor,
        { requestId, ip: clientIp(request.headers), userAgent: request.headers.get("user-agent") },
        reason ?? null,
      );
      return ok({ ok: true as const, action }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
