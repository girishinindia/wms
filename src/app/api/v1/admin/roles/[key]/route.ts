import { type NextRequest } from "next/server";

import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { applyMatrix, RoleError } from "@/lib/roles/matrix";
import { roleMatrixRequestSchema } from "@/lib/validation/api-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/v1/admin/roles/[key] — rewrite what a role means.
 *
 * The most dangerous endpoint in the system, and the guards say so:
 *
 *   · `role.update`, which only a super admin holds — `role_permission`
 *     has no warehouse column, so a warehouse admin editing
 *     STORAGE_MANAGER would change it at every site in the company.
 *   · Rule 1: no line may grant more than the caller holds.
 *   · Rule 2: no role at or above the caller's own level, and none
 *     that is protected.
 *   · A reason, recorded on the audit row beside both sides of the diff.
 *
 * All-or-nothing: every line is checked before any line is written, so a
 * refusal never leaves a role meaning something nobody chose.
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ key: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { key } = await context.params;
      const { actor } = await requirePermission("role.update", {
        entityType: "role",
        entityId: key,
      });

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      }

      const parsed = roleMatrixRequestSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }

      const result = await applyMatrix(actor, key, parsed.data.changes, parsed.data.reason, {
        requestId,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
      });

      return ok(result, requestId);
    } catch (error) {
      if (error instanceof RoleError) {
        return fail(error.kind, error.message, requestId, { fields: error.fields });
      }
      return toResponse(error, requestId);
    }
  })();
}
