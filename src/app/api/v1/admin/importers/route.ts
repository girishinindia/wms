import { sql, type SQL } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { getDb } from "@/db";
import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { constraintNameOf, isUniqueViolation } from "@/lib/db-errors";
import { createImporterAsAdmin, ImporterConflictError } from "@/lib/importer/create";
import { createImporterRequestSchema } from "@/lib/validation/api-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The review-flow tabs, exactly as the web list draws them: a rejection
 * keeps status PENDING and marks kyc_status REJECTED, so "submitted"
 * and "rejected" are KYC facets of PENDING, not statuses of their own.
 */
const TABS: Record<string, SQL> = {
  PENDING: sql`and i.status = 'PENDING' and i.kyc_status not in ('SUBMITTED', 'REJECTED')`,
  SUBMITTED: sql`and i.status = 'PENDING' and i.kyc_status = 'SUBMITTED'`,
  REJECTED: sql`and i.status = 'PENDING' and i.kyc_status = 'REJECTED'`,
  ACTIVE: sql`and i.status = 'ACTIVE'`,
  SUSPENDED: sql`and i.status = 'SUSPENDED'`,
};

/**
 * GET /api/v1/admin/importers — the companies list, for the review
 * screen. The web page renders this query server-side; a native client
 * cannot, so the same rows come out here: same tab facets, same
 * "submitted first, then pending, then newest" order, same 200 cap.
 *
 * OWN scope is refused: that grant is an importer reading their own
 * company, which is `/importer/me` — never a list of everyone else's.
 */
export async function GET(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { grant } = await requirePermission("importer.read", {
        entityType: "importer",
      });
      if (grant.scope === "OWN") {
        return fail("FORBIDDEN", "Use your own company profile instead.", requestId);
      }

      const raw = (request.nextUrl.searchParams.get("status") ?? "").toUpperCase();
      const facet = TABS[raw];

      const rows = await getDb().execute<{
        id: number;
        code: string;
        company_name: string;
        contact_person: string;
        contact_mobile: string;
        city_label: string | null;
        status: string;
        kyc_status: string;
        rejection_reason: string | null;
        created_at: string;
      }>(sql`
        select i.id, i.code, i.company_name, i.contact_person,
               i.contact_mobile::text as contact_mobile,
               case when c.id is null then null
                    else (c.name || ', ' || s.name) end as city_label,
               i.status::text as status, i.kyc_status, i.rejection_reason,
               i.created_at::text as created_at
          from wms.importer i
          left join wms.city c on c.id = i.city_id
          left join wms.state s on s.id = c.state_id
         where i.deleted_at is null
           ${facet ?? sql``}
         order by (i.status = 'PENDING' and i.kyc_status = 'SUBMITTED') desc,
                  (i.status = 'PENDING') desc, i.created_at desc
         limit 200
      `);

      return ok(
        {
          importers: rows.map((r) => ({
            id: Number(r.id),
            code: r.code,
            companyName: r.company_name,
            contactPerson: r.contact_person,
            contactMobile: r.contact_mobile,
            cityLabel: r.city_label,
            status: r.status,
            kycStatus: r.kyc_status,
            rejectionReason: r.rejection_reason,
            createdAt: r.created_at,
          })),
        },
        requestId,
      );
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}

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
