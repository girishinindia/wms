import { type NextRequest } from "next/server";

import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { constraintNameOf, isUniqueViolation } from "@/lib/db-errors";
import { loadImporterProfile } from "@/lib/importer/profile";
import { ImporterUpdateError, updateImporterAsAdmin } from "@/lib/importer/update";
import { updateImporterRequestSchema } from "@/lib/validation/api-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/admin/importers/[id] — one company, for the review screen.
 *
 * The web detail page renders this server-side; a native client cannot.
 * Same payload as `/importer/me` (`loadImporterProfile`), because the
 * reviewer needs exactly what the applicant filled in — plus the same
 * OWN-scope refusal as PATCH below: an importer's own grant belongs on
 * `/importer/me`, never on an id they typed into a URL.
 */
export async function GET(
  _: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { id: rawId } = await context.params;
      const id = Number(rawId);
      if (!Number.isInteger(id) || id <= 0) {
        return fail("NOT_FOUND", "No such importer", requestId);
      }
      const { grant } = await requirePermission("importer.read", {
        entityType: "importer",
        entityId: String(id),
        importerId: id,
      });
      if (grant.scope === "OWN") {
        return fail("FORBIDDEN", "Use your own company profile instead.", requestId);
      }
      const profile = await loadImporterProfile(id);
      if (!profile) return fail("NOT_FOUND", "No such importer", requestId);
      return ok(profile, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}

/**
 * PATCH /api/v1/admin/importers/[id] — a super admin corrects a company.
 *
 * The counterpart to `PATCH /importer/me`, and deliberately a separate
 * route rather than a scope check inside that one: the two have opposite
 * rules. An importer may not touch legal name, entity type, GSTIN or PAN
 * once verified — those are exactly the fields an admin is here to fix —
 * and an importer's id comes from their role assignment while an admin's
 * comes from the URL.
 *
 * Only an ALL-scoped grant qualifies. An IMPORTER holds `importer.update`
 * at OWN, which `requirePermission` alone would accept, so the scope is
 * checked here as well; their own company goes through `/importer/me`,
 * with the locks that belong there.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { id: rawId } = await context.params;
      const id = Number(rawId);
      if (!Number.isInteger(id) || id <= 0) {
        return fail("NOT_FOUND", "No such importer", requestId);
      }

      const { actor, grant } = await requirePermission("importer.update", {
        entityType: "importer",
        entityId: String(id),
        importerId: id,
      });
      if (grant.scope !== "ALL") {
        return fail("FORBIDDEN", "You do not have permission to do that.", requestId);
      }

      const parsed = updateImporterRequestSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }

      const after = await updateImporterAsAdmin(id, parsed.data, actor, {
        requestId,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
      });
      return ok(after, requestId);
    } catch (error) {
      if (error instanceof ImporterUpdateError) {
        return fail(error.kind, error.message, requestId, error.fields ? { fields: error.fields } : undefined);
      }
      // The indexes are still the authority; these are the two that a
      // concurrent write could trip between the check and the update.
      if (isUniqueViolation(error)) {
        const name = constraintNameOf(error);
        return fail(
          "CONFLICT",
          name === "importer_company_name_uk"
            ? "That company name is already registered to another importer"
            : "That GSTIN or PAN is already registered to another importer",
          requestId,
        );
      }
      return toResponse(error, requestId);
    }
  })();
}
