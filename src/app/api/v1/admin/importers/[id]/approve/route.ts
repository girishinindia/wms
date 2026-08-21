import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { getDb } from "@/db";
import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { constraintNameOf, isUniqueViolation } from "@/lib/db-errors";
import { auditQuietly } from "@/lib/audit";
import { loadImporterProfile, missingFields } from "@/lib/importer/profile";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { announce } from "@/lib/notify/announce";
import { approveImporterRequestSchema } from "@/lib/validation/api-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/admin/importers/[id]/approve
 *
 * Approval is not a button, it is a form, and the database is what says
 * so. `importer_complete_before_active` allows a row to be incomplete
 * only while it is PENDING:
 *
 *   status = 'PENDING'
 *     OR (legal_name, entity_type, address, city_id, pincode all present)
 *
 * Sign-up collects a company name, a contact and two verified channels —
 * nothing more, because asking a stranger for a registered address
 * before they have an account is how a sign-up form loses people. The
 * rest arrives here, with the KYC documents, and the check is what
 * guarantees an ACTIVE importer is always a complete one.
 *
 * The `status = 'PENDING'` predicate on the UPDATE is doing real work:
 * it makes a double-submitted approval a no-op that reports a conflict,
 * rather than a second approval that overwrites the first decision and
 * re-notifies the applicant.
 */
export async function POST(
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

      const { actor } = await requirePermission("importer.approve", {
        entityType: "importer",
        entityId: String(id),
        importerId: id,
      });

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      }

      const parsed = approveImporterRequestSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const input = parsed.data;

      const before = await getDb().execute<{
        id: number;
        code: string;
        company_name: string;
        contact_person: string;
        status: string;
        kyc_status: string;
      }>(sql`
        select id, code, company_name, contact_person,
               status::text as status, kyc_status
          from wms.importer where id = ${id} and deleted_at is null
      `);
      if (before.length === 0) return fail("NOT_FOUND", "No such importer", requestId);
      if (before[0]!.status !== "PENDING") {
        return fail(
          "CONFLICT",
          `This importer is already ${before[0]!.status.toLowerCase()}.`,
          requestId,
        );
      }

      // Checked before the update so a retired city comes back as a field
      // message rather than a foreign-key violation the user cannot read.
      if (input.cityId !== undefined) {
        const city = await getDb().execute<{ id: number; is_active: boolean }>(sql`
          select id, is_active from wms.city
           where id = ${input.cityId} and deleted_at is null
        `);
        if (city.length === 0 || !city[0]!.is_active) {
          return fail("VALIDATION_FAILED", "Choose a city that is in use", requestId, {
            fields: { cityId: "Not an active city" },
          });
        }
      }

      // The importer completes their own profile now; approval confirms
      // it. Anything sent here overrides a field, anything not sent is
      // kept. Whatever the merge produces must be complete — the
      // database's importer_complete_before_active check is the last
      // line, and this answers first with the field names.
      const current = await loadImporterProfile(id);
      if (!current) return fail("NOT_FOUND", "No such importer", requestId);
      const merged = { ...current.profile, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
      const missing = missingFields(merged as typeof current.profile);
      if (missing.length > 0) {
        return fail(
          "VALIDATION_FAILED",
          "The importer has not completed their profile yet — " + missing.join(", ") + " missing.",
          requestId,
          { fields: Object.fromEntries(missing.map((k) => [k, "Required before approval"])) },
        );
      }

      const rows = await getDb().execute<{
        id: number;
        code: string;
        status: string;
        kyc_status: string;
        contact_email: string;
      }>(sql`
        update wms.importer
           set legal_name       = coalesce(${input.legalName ?? null}, legal_name),
               entity_type      = coalesce(${input.entityType ?? null}, entity_type),
               address          = coalesce(${input.address ?? null}, address),
               city_id          = coalesce(${input.cityId ?? null}, city_id),
               pincode          = coalesce(${input.pincode ?? null}::wms.pincode_in, pincode),
               gstin            = coalesce(${input.gstin ?? null}::wms.gstin, gstin),
               pan              = coalesce(${input.pan ?? null}::wms.pan_no, pan),
               credit_limit     = coalesce(${input.creditLimit ?? null}, credit_limit),
               credit_days      = coalesce(${input.creditDays ?? null}, credit_days),
               notes            = coalesce(${input.notes ?? null}, notes),
               status           = 'ACTIVE',
               kyc_status       = 'VERIFIED',
               kyc_submitted_at = coalesce(kyc_submitted_at, now()),
               approved_by      = ${actor.session.userId},
               approved_at      = now(),
               updated_by       = ${actor.session.userId}
         where id = ${id} and deleted_at is null and status = 'PENDING'
        returning id, code, status::text as status, kyc_status,
                  contact_email::text as contact_email
      `);

      // Lost the race with another approval between the read and the write.
      if (rows.length === 0) {
        return fail("CONFLICT", "Somebody else decided this one first.", requestId);
      }
      const row = rows[0]!;

      await auditQuietly({
        action: "importer.approved",
        operation: "APPROVE",
        entityType: "importer",
        entityId: String(id),
        entityLabel: `${row.code} ${before[0]!.company_name}`,
        actorUserId: actor.session.userId,
        actorEmail: actor.session.email,
        actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
        before: before[0],
        after: { status: row.status, kycStatus: row.kyc_status, ...input },
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        requestId,
        correlationId: requestId,
      });

      // Best effort, and deliberately after the audit row. A provider
      // outage must not roll back an approval that has already happened —
      // the decision is the fact, the message about it is not.
      try {
        await announce({
          eventKey: "importer.approved",
          values: {
            company: before[0]!.company_name,
            code: row.code,
            contact: before[0]!.contact_person,
            decided_on: new Date().toISOString().slice(0, 10),
          },
          dedupeSuffix: String(id),
          actorUserId: actor.session.userId,
          entityType: "importer",
          entityId: String(id),
          importerId: id,
          correlationId: requestId,
        });
      } catch (notifyError) {
        console.error("[admin] importer.approved announce failed", {
          requestId,
          id,
          notifyError,
        });
      }

      return ok(
        { id: row.id, code: row.code, status: "ACTIVE" as const, kycStatus: row.kyc_status },
        requestId,
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        return fail(
          "CONFLICT",
          constraintNameOf(error) === "importer_company_name_uk"
            ? "That company name is already registered to another importer"
            : "That GSTIN or PAN is already registered to another importer",
          requestId,
        );
      }
      return toResponse(error, requestId);
    }
  })();
}
