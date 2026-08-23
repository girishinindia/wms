import { type NextRequest } from "next/server";

import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { addOverride, listOverrides, RoleError } from "@/lib/roles/matrix";
import { mayManageUser } from "@/lib/users/authority";
import { overrideRequestSchema } from "@/lib/validation/api-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One person's exceptions to what their roles grant.
 *
 * Guarded by `role.assign` and `mayManageUser`, which is what lets a
 * warehouse admin make an exception for their own people without being
 * able to touch another branch's — or an importer's, whose roles are
 * fixed and whose exceptions therefore are too.
 *
 * An ALLOW is bounded by rule 1 in `roles/authority.ts`: nobody hands
 * out what they do not hold. A DENY needs no such check — taking
 * something away is never an escalation.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { id: raw } = await context.params;
      const userId = Number(raw);
      if (!Number.isInteger(userId) || userId <= 0) {
        return fail("NOT_FOUND", "No such user", requestId);
      }
      await requirePermission("user.read", { entityType: "user", entityId: String(userId) });
      return ok({ overrides: await listOverrides(userId) }, requestId);
    } catch (error) {
      if (error instanceof RoleError) return fail(error.kind, error.message, requestId);
      return toResponse(error, requestId);
    }
  })();
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { id: raw } = await context.params;
      const userId = Number(raw);
      if (!Number.isInteger(userId) || userId <= 0) {
        return fail("NOT_FOUND", "No such user", requestId);
      }

      const { actor } = await requirePermission("role.assign", {
        entityType: "user",
        entityId: String(userId),
      });

      // The same question the role panel asks: is this account one of
      // yours to touch? It also refuses importers and sales agents.
      const may = await mayManageUser(actor, userId);
      if (may !== true) return fail("FORBIDDEN", may.reason, requestId);

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      }

      const parsed = overrideRequestSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }

      await addOverride(actor, userId, parsed.data, {
        requestId,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
      });

      return ok({ ok: true as const }, requestId, 201);
    } catch (error) {
      if (error instanceof RoleError) {
        return fail(error.kind, error.message, requestId, { fields: error.fields });
      }
      return toResponse(error, requestId);
    }
  })();
}
