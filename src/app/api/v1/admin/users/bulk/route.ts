import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { getDb } from "@/db";
import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { applyToUser } from "@/lib/accounts/lifecycle";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { mayActOnUser } from "@/lib/users/authority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  action: z.enum(["activate", "deactivate", "delete"]),
  ids: z.array(z.number().int().positive()).min(1).max(200),
  reason: z.string().trim().max(300).optional(),
});

/**
 * POST /api/v1/admin/users/bulk — activate, deactivate or delete several
 * logins. Super admins and the caller's own account are skipped with a
 * reason, never refused as a whole. Each one cascades — lifecycle.ts.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const parsed = bodySchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return fail("VALIDATION_FAILED", "Send action and ids", requestId);
      const { action, ids } = parsed.data;

      /**
       * A reason is not optional as far as the database is concerned.
       *
       * `users_check` refuses a SUSPENDED row whose `deactivation_reason`
       * is null, and the Deactivate button on the users screen sends no
       * reason at all — so every bulk deactivate answered "Deactivated 0.
       * Skipped N — Failed query…". Found by pressing the button. The
       * single-row toggle beside it has always defaulted the same way.
       */
      const reason =
        parsed.data.reason ??
        (action === "deactivate"
          ? "Deactivated from the users screen"
          : action === "delete"
            ? "Deleted from the users screen"
            : undefined);

      const { actor } = await requirePermission(action === "delete" ? "user.delete" : "user.update", {
        entityType: "user",
      });
      const rows = await getDb().execute<{ id: number; is_super: boolean }>(sql`
        select u.id, wms.is_super_admin(u.id) as is_super from wms.users u
         where u.id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) and u.deleted_at is null
      `);
      const found = new Map(rows.map((r) => [Number(r.id), r.is_super]));
      const done: number[] = [];
      const skipped: { id: number; reason: string }[] = [];
      const meta = { requestId, ip: clientIp(request.headers), userAgent: request.headers.get("user-agent") };
      for (const id of ids) {
        if (!found.has(id)) { skipped.push({ id, reason: "not found" }); continue; }
        if (found.get(id)) { skipped.push({ id, reason: "super admin accounts cannot be changed here" }); continue; }
        if (id === actor.session.userId && action !== "activate") {
          skipped.push({ id, reason: "that is your own account" }); continue;
        }
        // Skipped rather than refused, like the two above it: a bulk
        // action over a mixed selection should do what it can and say
        // what it did not, not fail the lot.
        const reach = await mayActOnUser(
          actor,
          id,
          action === "delete" ? "user.delete" : "user.update",
          "change it",
        );
        if (reach !== true) { skipped.push({ id, reason: "not one of your warehouses" }); continue; }
        try {
          await applyToUser(
            id,
            action === "delete" ? "DELETE" : action === "deactivate" ? "SUSPEND" : "REACTIVATE",
            actor, meta, reason ?? null,
          );
          done.push(id);
        } catch (e) {
          skipped.push({ id, reason: e instanceof Error ? e.message.slice(0, 120) : "failed" });
        }
      }
      return ok({ action, done, skipped, notes: [] }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
