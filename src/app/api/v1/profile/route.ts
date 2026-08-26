import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { getDb } from "@/db";
import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { auditQuietly } from "@/lib/audit";
import { requireActor } from "@/lib/auth/guard";
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
 * GET /api/v1/profile — who am I. PATCH — my own name.
 *
 * Email, mobile and password deliberately do NOT change here: each has
 * its own verified flow (profile/email, profile/mobile, profile/password).
 */
export async function GET() {
  return handler(async ({ requestId }) => {
    try {
      const actor = await requireActor();
      const rows = await getDb().execute<{
        first_name: string; last_name: string; email: string; mobile: string;
        email_verified: boolean; mobile_verified: boolean; last_login_at: string | null;
        photo_url: string | null;
      }>(sql`
        select first_name, last_name, email::text as email, mobile::text as mobile,
               email_verified_at is not null as email_verified,
               mobile_verified_at is not null as mobile_verified,
               last_login_at::text as last_login_at,
               photo_url
          from wms.users where id = ${actor.session.userId} and deleted_at is null
      `);
      const r = rows[0];
      if (!r) return fail("NOT_FOUND", "No such account", requestId);
      return ok(
        {
          firstName: r.first_name,
          lastName: r.last_name,
          email: r.email,
          mobile: r.mobile,
          emailVerified: r.email_verified,
          mobileVerified: r.mobile_verified,
          roles: actor.roles.map((x) => x.role),
          lastLoginAt: r.last_login_at,
          // The web profile page reads this straight from the table; a
          // native client can only see what this endpoint returns.
          photoUrl: r.photo_url,
        },
        requestId,
      );
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}

export async function PATCH(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const actor = await requireActor();
      const parsed = bodySchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const { firstName, lastName } = parsed.data;
      if (!firstName && !lastName) return fail("VALIDATION_FAILED", "Nothing to change", requestId);
      await getDb().execute(sql`
        update wms.users
           set first_name = coalesce(${firstName ?? null}, first_name),
               last_name = coalesce(${lastName ?? null}, last_name),
               updated_by = ${actor.session.userId}
         where id = ${actor.session.userId} and deleted_at is null
      `);
      await invalidateUser(actor.session.userId);
      await auditQuietly({
        action: "user.profile_updated", operation: "UPDATE", entityType: "user",
        entityId: String(actor.session.userId), entityLabel: actor.session.email,
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
