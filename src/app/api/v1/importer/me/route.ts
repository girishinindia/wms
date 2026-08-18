import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { getDb } from "@/db";
import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { auditQuietly } from "@/lib/audit";
import { importerIdOf, requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { loadImporterProfile, patchImporterProfile } from "@/lib/importer/profile";
import { importerProfilePatchSchema } from "@/lib/validation/api-importer";
import { isUniqueViolation } from "@/lib/db-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET / PATCH /api/v1/importer/me — the signed-in importer's own company.
 *
 * `importer.read` / `importer.update` at OWN scope, which is what the
 * IMPORTER role holds. "Own" here means the importer named on the
 * actor's role assignment — never an id from the request. This is the
 * one importer-facing endpoint that does NOT require verification:
 * completing the profile is how you get verified.
 */
export async function GET() {
  return handler(async ({ requestId }) => {
    try {
      const { actor } = await requirePermission("importer.read", { entityType: "importer" });
      const importerId = importerIdOf(actor);
      if (importerId === null) return fail("NOT_FOUND", "You are not linked to an importer", requestId);
      const profile = await loadImporterProfile(importerId);
      if (!profile) return fail("NOT_FOUND", "No such importer", requestId);
      return ok(profile, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}

export async function PATCH(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor } = await requirePermission("importer.update", { entityType: "importer" });
      const importerId = importerIdOf(actor);
      if (importerId === null) return fail("NOT_FOUND", "You are not linked to an importer", requestId);

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      }
      const parsed = importerProfilePatchSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const input = parsed.data as Record<string, unknown>;

      const before = await loadImporterProfile(importerId);
      if (!before) return fail("NOT_FOUND", "No such importer", requestId);
      // Once verified, identity fields are the super admin's to change.
      if (before.status === "ACTIVE") {
        for (const locked of ["legalName", "entityType", "gstin", "pan"]) {
          if (locked in input && input[locked] !== (before.profile as Record<string, unknown>)[locked]) {
            return fail(
              "CONFLICT",
              "Legal name, entity type, GSTIN and PAN are locked after verification. Ask the warehouse to change them.",
              requestId,
            );
          }
        }
      }

      if (input.cityId !== undefined) {
        const city = await getDb().execute<{ id: number }>(sql`
          select id from wms.city where id = ${input.cityId} and is_active and deleted_at is null
        `);
        if (city.length === 0) {
          return fail("VALIDATION_FAILED", "Choose a city from the list", requestId, {
            fields: { cityId: "Not an active city" },
          });
        }
      }

      const touched = await patchImporterProfile(importerId, input, actor.session.userId);
      if (touched.length === 0) return fail("VALIDATION_FAILED", "Nothing to change", requestId);

      const after = await loadImporterProfile(importerId);
      await auditQuietly({
        action: "importer.profile_updated",
        operation: "UPDATE",
        entityType: "importer",
        entityId: String(importerId),
        entityLabel: before.profile.companyName,
        actorUserId: actor.session.userId,
        actorEmail: actor.session.email,
        actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
        before: Object.fromEntries(touched.map((k) => [k, (before.profile as Record<string, unknown>)[k] ?? null])),
        after: Object.fromEntries(touched.map((k) => [k, input[k] ?? null])),
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        requestId,
      });
      return ok(after, requestId);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return fail("CONFLICT", "That GSTIN or PAN is already registered to another importer", requestId);
      }
      return toResponse(error, requestId);
    }
  })();
}
