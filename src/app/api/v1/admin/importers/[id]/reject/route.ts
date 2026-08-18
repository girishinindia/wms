import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { getDb } from "@/db";
import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { auditQuietly } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { announce } from "@/lib/notify/announce";
import { rejectImporterRequestSchema } from "@/lib/validation/api-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/admin/importers/[id]/reject
 *
 * The reason is mandatory in three separate places, which is not an
 * accident: the request schema, the table's own
 * `status <> 'REJECTED' or rejection_reason is not null` check, and the
 * audit helper's rule about DENIED and DELETE rows. A rejection with no
 * reason is a support call every time, and the applicant cannot fix
 * something nobody told them about.
 *
 * The account itself is left alone. The IMPORTER role assignment cannot
 * be revoked anyway — `ura_protect_immutable` blocks UPDATE and DELETE
 * on an immutable role for everyone including a super admin — and it
 * should not be: a rejection is usually "this paperwork is wrong", and
 * the applicant needs to be able to sign in and come back.
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

      const parsed = rejectImporterRequestSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const { reason } = parsed.data;

      const before = await getDb().execute<{
        id: number;
        code: string;
        company_name: string;
        status: string;
      }>(sql`
        select id, code, company_name, status::text as status
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

      const rows = await getDb().execute<{ id: number; code: string }>(sql`
        update wms.importer
           -- The company stays PENDING: a rejection is "fix these and
           -- resubmit", not the end. kyc_status carries the verdict and
           -- the reason is shown to the importer on their profile.
           set rejection_reason = ${reason},
               rejected_by      = ${actor.session.userId},
               rejected_at      = now(),
               kyc_status       = 'REJECTED',
               updated_by       = ${actor.session.userId}
         where id = ${id} and deleted_at is null and status = 'PENDING'
        returning id, code
      `);
      if (rows.length === 0) {
        return fail("CONFLICT", "Somebody else decided this one first.", requestId);
      }

      await auditQuietly({
        action: "importer.rejected",
        operation: "REJECT",
        entityType: "importer",
        entityId: String(id),
        entityLabel: `${before[0]!.code} ${before[0]!.company_name}`,
        actorUserId: actor.session.userId,
        actorEmail: actor.session.email,
        actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
        reason,
        before: before[0],
        after: { status: "REJECTED" },
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        requestId,
        correlationId: requestId,
      });

      try {
        await announce({
          eventKey: "importer.rejected",
          values: {
            company: before[0]!.company_name,
            code: before[0]!.code,
            reason,
          },
          dedupeSuffix: String(id),
          actorUserId: actor.session.userId,
          entityType: "importer",
          entityId: String(id),
          importerId: id,
          correlationId: requestId,
        });
      } catch (notifyError) {
        console.error("[admin] importer.rejected announce failed", {
          requestId,
          id,
          notifyError,
        });
      }

      return ok({ ok: true as const }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
