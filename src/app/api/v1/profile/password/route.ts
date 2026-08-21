import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { getDb } from "@/db";
import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { auditQuietly } from "@/lib/audit";
import { setPassword } from "@/lib/auth/account";
import { requireActor } from "@/lib/auth/guard";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { clientIp } from "@/lib/auth/ratelimit";
import { revokeAllSessions } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    /** Not required while `must_change_password` is set — the temporary
     *  password was just used to sign in and is being replaced. */
    oldPassword: z.string().max(200).optional(),
    newPassword: z.string().min(8, "At least 8 characters").max(200),
    confirmPassword: z.string().max(200),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "The passwords do not match",
  });

/**
 * POST /api/v1/profile/password — change my own password.
 *
 * Old password required (and verified) unless the account is on a forced
 * change. Every session is then revoked — including this one — so the
 * client redirects to sign-in. Anyone else holding the old password is
 * signed out at the same moment, which is the point of changing it.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const actor = await requireActor();
      const parsed = bodySchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const { oldPassword, newPassword } = parsed.data;
      const userId = actor.session.userId;

      const rows = await getDb().execute<{ password_hash: string; must_change: boolean }>(sql`
        select password_hash, must_change_password as must_change
          from wms.users where id = ${userId} and deleted_at is null
      `);
      const row = rows[0];
      if (!row) return fail("NOT_FOUND", "No such account", requestId);

      if (!row.must_change) {
        if (!oldPassword) {
          return fail("VALIDATION_FAILED", "Enter your current password", requestId, {
            fields: { oldPassword: "Required" },
          });
        }
        if (!(await verifyPassword(oldPassword, row.password_hash))) {
          return fail("VALIDATION_FAILED", "The current password is wrong", requestId, {
            fields: { oldPassword: "Wrong password" },
          });
        }
      }
      if (oldPassword && oldPassword === newPassword) {
        return fail("VALIDATION_FAILED", "The new password must be different", requestId, {
          fields: { newPassword: "Same as the current one" },
        });
      }

      await setPassword(userId, await hashPassword(newPassword));
      const revoked = await revokeAllSessions(userId, "password changed by the user");

      await auditQuietly({
        action: "user.password_changed",
        operation: "UPDATE",
        entityType: "user",
        entityId: String(userId),
        entityLabel: actor.session.email,
        actorUserId: userId,
        actorEmail: actor.session.email,
        actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
        reason: row.must_change ? "forced first-login change" : "self-service change",
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        requestId,
        metadata: { sessionsRevoked: revoked },
      });

      return ok({ ok: true as const, signedOut: true as const }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
