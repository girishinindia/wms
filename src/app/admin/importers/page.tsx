import ImporterCreateDrawer from "@/components/admin/ImporterCreateDrawer";
import ImportersTable from "@/components/admin/ImportersTable";
import { Card, Denied, PageHeader } from "@/components/admin/ui";
import { getDb } from "@/db";
import { loadGeoOptions } from "@/lib/admin/geo";
import { grantFor, pageGuard } from "@/lib/auth/guard";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * The importer list, pending first.
 *
 * Ordered by status rather than by date, because the only reason to open
 * this screen is to find what is waiting. A newest-first list buries a
 * three-day-old registration under two dozen active accounts on the day
 * it starts to matter.
 */
export default async function ImportersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const guard = await pageGuard("importer.read");
  if (!guard.ok) return <Denied what="importers" />;
  /**
   * OWN scope is not this screen.
   *
   * An IMPORTER genuinely holds `importer.read` — over their own company,
   * which is their dashboard. The sidebar has always known that, but the
   * page did not: anyone who typed the URL got the whole list, with every
   * company's contact email in it. The nav is not an access control.
   */
  if (guard.grant.scope === "OWN") return <Denied what="the importer list" />;

  const { status } = await searchParams;
  const filter = status?.toUpperCase();
  /**
   * The tabs follow the review flow, not the raw status column: a
   * rejection keeps the row PENDING (so it can be fixed and resubmitted)
   * and marks kyc_status REJECTED, so "Rejected" and "Submitted" are KYC
   * states while "Pending", "Active" and "Suspended" are record states.
   */
  const TABS: Record<string, ReturnType<typeof sql>> = {
    PENDING: sql`and status = 'PENDING' and kyc_status not in ('SUBMITTED', 'REJECTED')`,
    SUBMITTED: sql`and status = 'PENDING' and kyc_status = 'SUBMITTED'`,
    REJECTED: sql`and status = 'PENDING' and kyc_status = 'REJECTED'`,
    ACTIVE: sql`and status = 'ACTIVE'`,
    SUSPENDED: sql`and status = 'SUSPENDED'`,
  };
  const active = filter && TABS[filter] ? filter : null;

  const rows = await getDb().execute<{
    id: number;
    code: string;
    company_name: string;
    contact_person: string;
    contact_email: string;
    contact_mobile: string;
    status: string;
    kyc_status: string;
    created_at: string;
  }>(sql`
    select id, code, company_name, contact_person,
           contact_email::text as contact_email, contact_mobile::text as contact_mobile,
           status::text as status, kyc_status, created_at
      from wms.importer
     where deleted_at is null
       ${active ? TABS[active]! : sql``}
     order by (status = 'PENDING' and kyc_status = 'SUBMITTED') desc, (status = 'PENDING') desc, created_at desc
     limit 200
  `);

  // Only a platform-wide grant means "create any company".
  const canCreate = grantFor(guard.actor, "importer.create")?.scope === "ALL";
  const geo = canCreate ? await loadGeoOptions() : { countries: [], states: [], cities: [] };

  const tabs = [
    { label: "All", value: null },
    { label: "Submitted for verification", value: "SUBMITTED" },
    { label: "Profile incomplete", value: "PENDING" },
    { label: "Returned", value: "REJECTED" },
    { label: "Active", value: "ACTIVE" },
    { label: "Suspended", value: "SUSPENDED" },
  ];

  return (
    <>
      <PageHeader
        title="Importers"
        subtitle="Self-registrations arrive as pending; the importer completes their profile and submits it, then you verify."
        action={canCreate ? <ImporterCreateDrawer geo={geo} /> : null}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const isOn = active === tab.value;
          return (
            <a
              key={tab.label}
              href={tab.value ? `/admin/importers?status=${tab.value}` : "/admin/importers"}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                isOn
                  ? "border-verdigris-300/40 bg-verdigris-500/15 text-verdigris-50"
                  : "border-verdigris-300/12 text-verdigris-200/60 hover:border-verdigris-300/30 hover:text-verdigris-100"
              }`}
            >
              {tab.label}
            </a>
          );
        })}
      </div>

      <Card>
        <ImportersTable
          rows={rows.map((r) => ({
            id: r.id,
            code: r.code,
            companyName: r.company_name,
            contactPerson: r.contact_person,
            contactEmail: r.contact_email,
            contactMobile: r.contact_mobile,
            status: r.status,
            kycStatus: r.kyc_status,
            createdAt: String(r.created_at),
          }))}
        />
      </Card>
    </>
  );
}
