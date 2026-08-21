import { type NextRequest } from "next/server";

import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { constraintNameOf, isUniqueViolation } from "@/lib/db-errors";
import { createImporterAsAdmin, ImporterConflictError } from "@/lib/importer/create";
import { createImporterRequestSchema } from "@/lib/validation/api-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/admin/importers — a super admin creates an importer.
 *
 * The other way in is self-registration; this is the counter version,
 * for a customer who signed up by phone. Same table, same statuses, and
 * `origin = 'CREATED_BY_ADMIN'` records which door they came through.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor, grant } = await requirePermission("importer.create", {
        entityType: "importer",
      });
      // OWN or WAREHOUSE scope cannot mean "create any company".
      if (grant.scope !== "ALL") {
        return fail("FORBIDDEN", "You do not have permission to do that.", requestId);
      }

      const parsed = createImporterRequestSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }

      const created = await createImporterAsAdmin(parsed.data, actor, {
        requestId,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
      });
      // The temporary password is returned ONCE so the admin can pass it
      // on; it is not stored anywhere readable.
      return ok(created, requestId, 201);
    } catch (error) {
      if (error instanceof ImporterConflictError) {
        return fail("CONFLICT", "Some details are already in use — see the highlighted fields", requestId, {
          fields: error.fields,
        });
      }
      if (isUniqueViolation(error)) {
        const name = constraintNameOf(error);
        return fail(
          "CONFLICT",
          name === "importer_company_name_uk"
            ? "That company name is already registered"
            : name === "users_email_uk"
              ? "An account with that email already exists"
              : name === "users_mobile_uk"
                ? "An account with that mobile already exists"
                : "Those details are already registered",
          requestId,
        );
      }
      return toResponse(error, requestId);
    }
  })();
}
