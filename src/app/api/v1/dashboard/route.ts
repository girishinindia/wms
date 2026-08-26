import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { handler, ok, toResponse } from "@/lib/api/respond";
import { importerGateFor, requireActor } from "@/lib/auth/guard";
import { loadImporterProfile } from "@/lib/importer/profile";
import { listSalesAgents } from "@/lib/sales-agents/ops";
import { isAgentOnly } from "@/lib/sales-agents/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/dashboard — the signed-in landing, as data.
 *
 * The web dashboard queries the database inside the PAGE
 * (`src/app/admin/(overview)/page.tsx`), which a native client cannot
 * render — so this endpoint answers the same three questions the page
 * answers, for the same three kinds of caller, deciding the branch the
 * same way:
 *
 *   - an agent-only user gets THEIR OWN record and nothing else — the
 *     same isAgentOnly() cut that keeps an agent's first screen from
 *     handing them their employer's GSTIN and PAN;
 *   - an importer gets their company summary (never the platform
 *     counts, which are nobody's business but the operator's);
 *   - everyone else gets the operator counts, and the pending-importer
 *     queue only when they hold importer.read beyond OWN.
 *
 * The response is a tagged union on `kind` so the client switches once
 * and renders, instead of inferring the caller's shape from which
 * fields happen to be null.
 */
export async function GET() {
  return handler(async ({ requestId }) => {
    try {
      const actor = await requireActor();

      const gate = await importerGateFor(actor);
      if (gate.kind === "importer") {
        if (isAgentOnly(actor)) {
          const [me] = await listSalesAgents(
            sql`a.user_id = ${actor.session.userId}`,
          );
          if (!me) {
            // The company has not finished setting the agent record up.
            // A kind of its own, so the client renders the explanation
            // rather than an empty card.
            return ok({ kind: "agent" as const, record: null }, requestId);
          }
          return ok(
            {
              kind: "agent" as const,
              record: {
                code: me.code,
                firstName: me.firstName,
                lastName: me.lastName,
                importerName: me.importerName,
                // One badge, not two — same collapse as the web page:
                // a suspended or closed record says so; otherwise the
                // on-off switch has the last word.
                status:
                  me.status !== "ACTIVE"
                    ? me.status
                    : me.isActive
                      ? "ACTIVE"
                      : "INACTIVE",
                mobile: me.mobile,
                email: me.email,
                joiningDate: me.joiningDate,
                cityLabel: me.cityLabel,
                address: [me.address, me.landmark, me.area, me.pincode]
                  .filter(Boolean)
                  .join(", "),
                territory: me.salesAreas.map((a) => ({
                  city: a.cityName,
                  areas: a.areas,
                })),
              },
            },
            requestId,
          );
        }

        const profile = await loadImporterProfile(gate.importerId);
        if (!profile) {
          return ok({ kind: "importer" as const, company: null }, requestId);
        }
        const [agents] = await getDb().execute<{
          agents: number;
          agents_active: number;
        }>(sql`
          select
            (select count(*) from wms.sales_agent a
              where a.importer_id = ${gate.importerId} and a.deleted_at is null)::int as agents,
            (select count(*) from wms.sales_agent a
              where a.importer_id = ${gate.importerId} and a.deleted_at is null
                and a.is_active)::int as agents_active
        `);
        return ok(
          {
            kind: "importer" as const,
            company: {
              companyName: profile.profile.companyName,
              code: profile.code,
              status: profile.status,
              kycStatus: profile.kycStatus,
              rejectionReason: profile.rejectionReason,
              complete: profile.complete,
              // What is still empty, by field key, so the client can say
              // "3 details left" and name them — same list the web form
              // derives.
              missing: profile.missing,
              contactPerson: profile.profile.contactPerson,
              cityLabel: profile.cityLabel,
              agents: agents?.agents ?? 0,
              agentsActive: agents?.agents_active ?? 0,
            },
          },
          requestId,
        );
      }

      // The operator view. One round trip for the counts, same as the
      // page — the database is a full round trip away and five separate
      // counts is most of a second of nothing happening.
      const canReadImporters = actor.permissions.some(
        (p) => p.permission === "importer.read" && p.scope !== "OWN",
      );
      const [counts] = await getDb().execute<{
        importers_pending: number;
        importers_total: number;
        users_active: number;
        cities: number;
        warehouses: number;
      }>(sql`
        select
          (select count(*) from wms.importer where status = 'PENDING' and deleted_at is null)
            ::int as importers_pending,
          (select count(*) from wms.importer where deleted_at is null)::int as importers_total,
          (select count(*) from wms.users where status = 'ACTIVE' and deleted_at is null)
            ::int as users_active,
          (select count(*) from wms.city where is_active and deleted_at is null)::int as cities,
          (select count(*) from wms.warehouse where is_active and deleted_at is null)::int as warehouses
      `);

      const pending = canReadImporters
        ? await getDb().execute<{
            id: number;
            code: string;
            company_name: string;
            contact_person: string;
            kyc_status: string;
            created_at: string;
          }>(sql`
            select id, code, company_name, contact_person, kyc_status,
                   created_at::text as created_at
              from wms.importer
             where status = 'PENDING' and deleted_at is null
             order by (kyc_status = 'SUBMITTED') desc, created_at
             limit 8
          `)
        : [];

      return ok(
        {
          kind: "admin" as const,
          counts: {
            importersPending: counts?.importers_pending ?? 0,
            importersTotal: counts?.importers_total ?? 0,
            usersActive: counts?.users_active ?? 0,
            cities: counts?.cities ?? 0,
            warehouses: counts?.warehouses ?? 0,
          },
          pending: pending.map((r) => ({
            id: Number(r.id),
            code: r.code,
            companyName: r.company_name,
            contactPerson: r.contact_person,
            kycStatus: r.kyc_status,
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
