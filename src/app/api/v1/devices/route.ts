import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { resolveSession } from "@/lib/auth/session";
import { clientIp } from "@/lib/auth/ratelimit";
import { auditQuietly } from "@/lib/audit";
import { authEnv } from "@/lib/env";
import { fail, fieldsFrom, handler, ok, toResponse, HandledError } from "@/lib/api/respond";
import { registerDeviceRequestSchema } from "@/lib/validation/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/devices — register this device's push token.
 *
 * Authenticated: a push token is a capability to interrupt someone's
 * phone, so it may only ever be attached to the caller's own account.
 *
 * `push_token` is UNIQUE across the table, which is the important part.
 * FCM reissues the same token to the same install, and two people
 * signing into one shared handset must not both keep receiving each
 * other's notifications — so the token moves to whoever signed in last
 * rather than being duplicated.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const env = authEnv();
      const store = await cookies();
      const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      const session = await resolveSession(
        bearer || store.get(env.AUTH_COOKIE_NAME)?.value,
      );
      if (!session) throw new HandledError("UNAUTHENTICATED", "Sign in to continue.");

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      }

      const parsed = registerDeviceRequestSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const input = parsed.data;

      const rows = await getDb().execute<{ id: number; moved: boolean }>(sql`
        insert into wms.user_device
          (user_id, platform, push_token, device_model, os_version, app_version,
           last_seen_at, is_active)
        values (${session.userId}, ${input.platform}, ${input.pushToken},
                ${input.deviceModel ?? null}, ${input.osVersion ?? null},
                ${input.appVersion ?? null}, now(), true)
        on conflict (push_token) do update
          set user_id = excluded.user_id,
              platform = excluded.platform,
              device_model = excluded.device_model,
              os_version = excluded.os_version,
              app_version = excluded.app_version,
              last_seen_at = now(),
              is_active = true
        returning id, (wms.user_device.user_id is distinct from ${session.userId}) as moved
      `);

      await auditQuietly({
        action: "device.registered", operation: "UPDATE", entityType: "user_device",
        entityId: String(rows[0]?.id ?? 0), entityLabel: input.platform,
        actorUserId: session.userId, actorEmail: session.email,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        requestId,
        metadata: {
          platform: input.platform,
          // Never the whole token: it is a capability, and the audit log
          // is the table most likely to be exported.
          tokenPrefix: input.pushToken.slice(0, 12),
          movedFromAnotherUser: rows[0]?.moved ?? false,
        },
      });

      return ok({ registered: true as const, deviceId: rows[0]?.id ?? 0 }, requestId, 201);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}

/** DELETE — sign-out on mobile should stop the notifications too. */
export async function DELETE(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const env = authEnv();
      const store = await cookies();
      const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      const session = await resolveSession(
        bearer || store.get(env.AUTH_COOKIE_NAME)?.value,
      );
      if (!session) throw new HandledError("UNAUTHENTICATED", "Sign in to continue.");

      const token = request.nextUrl.searchParams.get("pushToken");
      if (!token) return fail("VALIDATION_FAILED", "pushToken is required", requestId);

      // Deactivated, not deleted: which device was notified is worth
      // keeping. Scoped to the caller so nobody can silence someone else.
      await getDb().execute(sql`
        update wms.user_device set is_active = false
         where push_token = ${token} and user_id = ${session.userId}
      `);

      return ok({ ok: true as const }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
