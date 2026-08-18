import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { getDb } from "@/db";
import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { auditQuietly } from "@/lib/audit";
import { importerIdOf, requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { loadImporterProfile } from "@/lib/importer/profile";
import { announce } from "@/lib/notify/announce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/importer/me/submit — "my profile is complete, verify me".
 *
 * Refused while anything required is missing (the response names what),
 * and while the company is already ACTIVE. Moves kyc_status to
 * SUBMITTED, clears an earlier rejection, and tells every super admin.
 * Idempotent on repeat: submitting an already-SUBMITTED profile is a
 * no-op that does not alert anyone twice.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor } = await requirePermission("importer.update", { entityType: "importer" });
      const importerId = importerIdOf(actor);
      if (importerId === null) return fail("NOT_FOUND", "You are not linked to an importer", requestId);

      const profile = await loadImporterProfile(importerId);
      if (!profile) return fail("NOT_FOUND", "No such importer", requestId);
      if (profile.status === "ACTIVE") {
        return fail("CONFLICT", "Your company is already verified.", requestId);
      }
      if (!profile.complete) {
        return fail("VALIDATION_FAILED", "Complete the highlighted fields before submitting", requestId, {
          fields: Object.fromEntries(profile.missing.map((k) => [k, "Required"])),
        });
      }
      if (profile.kycStatus === "SUBMITTED" || profile.kycStatus === "UNDER_REVIEW") {
        return ok({ kycStatus: profile.kycStatus, resubmitted: false }, requestId);
      }

      await getDb().execute(sql`
        update wms.importer
           set kyc_status = 'SUBMITTED',
               kyc_submitted_at = now(),
               rejection_reason = null,
               rejected_by = null,
               rejected_at = null,
               updated_by = ${actor.session.userId}
         where id = ${importerId} and deleted_at is null
      `);

      await auditQuietly({
        action: "importer.kyc_submitted",
        operation: "UPDATE",
        entityType: "importer",
        entityId: String(importerId),
        entityLabel: profile.profile.companyName,
        actorUserId: actor.session.userId,
        actorEmail: actor.session.email,
        actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
        before: { kycStatus: profile.kycStatus },
        after: { kycStatus: "SUBMITTED" },
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        requestId,
      });

      // Every super admin, on every channel the rule names. A failure
      // here must not undo the submission; it is logged as ours.
      let notified = { recipients: 0 };
      try {
        notified = await announce({
          eventKey: "importer.kyc_submitted",
          values: {
            company: profile.profile.companyName,
            code: profile.code,
            legal_name: profile.profile.legalName ?? "",
            contact: profile.profile.contactPerson,
            email: profile.profile.contactEmail,
            mobile: profile.profile.contactMobile,
            importer_id: String(importerId),
          },
          // Once per submission; a resubmission after a rejection is a
          // new occurrence and should alert again.
          dedupeSuffix: `importer:${importerId}:submit:${Date.now()}`,
          actorUserId: actor.session.userId,
          entityType: "importer",
          entityId: String(importerId),
          importerId,
          correlationId: requestId,
        });
      } catch (error) {
        console.error("[importer] kyc_submitted announce failed", {
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return ok(
        { kycStatus: "SUBMITTED", resubmitted: profile.kycStatus === "REJECTED", notified: notified.recipients },
        requestId,
      );
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
