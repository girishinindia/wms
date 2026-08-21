import Link from "next/link";

import CompanyProfileForm from "@/components/admin/CompanyProfileForm";
import { Card, Empty, FactList, PageHeader, Stat, StatusBadge } from "@/components/admin/ui";
import { loadGeoOptions } from "@/lib/admin/geo";
import { loadImporterProfile } from "@/lib/importer/profile";
import { getDb } from "@/db";
import { currentActor, importerGateFor } from "@/lib/auth/guard";
import { listSalesAgents } from "@/lib/sales-agents/ops";
import { isAgentOnly } from "@/lib/sales-agents/scope";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * The dashboard.
 *
 * Counts, and the queue that actually needs a human. Deliberately not a
 * wall of charts: on the day this is used, the only questions are "is
 * anything waiting for me" and "is the system set up enough to work",
 * and the second one matters because an empty `city` table silently
 * blocks importer approval and warehouse creation.
 *
 * One round trip for the counts rather than five. The database sits in
 * ap-south-1 and every separate query is a full round trip; five of them
 * is most of a second of nothing happening.
 */

type Counts = {
  importers_pending: number;
  importers_total: number;
  users_active: number;
  cities: number;
  warehouses: number;
};

export default async function AdminDashboard() {
  const actor = await currentActor();
  const canReadImporters = actor?.permissions.some(
    (p) => p.permission === "importer.read" && p.scope !== "OWN",
  );

  // An importer gets their own dashboard: their company, their people.
  // The platform counts below are nobody's business but the operator's.
  const gate = actor ? await importerGateFor(actor) : { kind: "none" as const };
  if (gate.kind === "importer") {
    /**
     * A sales agent works FOR the company; they are not the company.
     * They land in this branch because their role assignment names the
     * importer they belong to — which is precisely what used to hand
     * them their employer's whole KYC record, GSTIN and PAN included,
     * on the first screen after signing in.
     */
    if (isAgentOnly(actor!)) return <AgentDashboard userId={actor!.session.userId} />;
    return (
      <ImporterDashboard
        importerId={gate.importerId}
        canEdit={actor!.permissions.some((p) => p.permission === "importer.update")}
      />
    );
  }

  const [counts] = await getDb().execute<Counts>(sql`
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
        select id, code, company_name, contact_person, kyc_status, created_at
          from wms.importer
         where status = 'PENDING' and deleted_at is null
         order by (kyc_status = 'SUBMITTED') desc, created_at
         limit 8
      `)
    : [];

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="What is waiting, and whether the master data is ready for it."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Awaiting approval"
          value={counts?.importers_pending ?? 0}
          note="registered; profiles submitted are reviewed first"
          tone={(counts?.importers_pending ?? 0) > 0 ? "warn" : "default"}
        />
        <Stat label="Importers" value={counts?.importers_total ?? 0} note="all statuses" />
        <Stat label="Active users" value={counts?.users_active ?? 0} />
        <Stat
          label="Cities"
          value={counts?.cities ?? 0}
          note={
            (counts?.cities ?? 0) === 0
              ? "none yet — approval is blocked until one exists"
              : "available for addresses"
          }
          tone={(counts?.cities ?? 0) === 0 ? "danger" : "default"}
        />
      </div>

      {(counts?.cities ?? 0) === 0 ? (
        <Card className="mt-4 border-rose-400/25 bg-rose-500/[0.07] p-5">
          <p className="text-sm text-rose-100">No cities have been added yet.</p>
          <p className="mt-1.5 text-xs text-rose-200/70">
            An importer cannot leave <span className="font-mono">PENDING</span> until its
            registered address is complete, and an address needs a city. Warehouses need one
            too. This is the first thing to set up.
          </p>
          <Link
            href="/admin/master/cities"
            className="mt-4 inline-block rounded-xl bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina"
          >
            Add cities
          </Link>
        </Card>
      ) : null}

      {canReadImporters ? (
        <Card className="mt-6">
          <div className="flex items-center justify-between border-b border-verdigris-300/10 px-5 py-4">
            <h2 className="text-sm font-semibold text-verdigris-50">Waiting for review</h2>
            <Link
              href="/admin/importers"
              className="text-xs font-medium text-verdigris-300 transition-colors hover:text-patina"
            >
              All importers
            </Link>
          </div>

          {pending.length === 0 ? (
            <Empty
              title="Nothing waiting."
              hint="New registrations appear here as soon as both the email address and the mobile number are verified."
            />
          ) : (
            <ul className="divide-y divide-verdigris-300/[0.06]">
              {pending.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/admin/importers/${row.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-verdigris-100/[0.03]"
                  >
                    <span className="font-mono text-xs text-verdigris-400">{row.code}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-verdigris-50">
                      {row.company_name}
                    </span>
                    <span className="text-xs text-verdigris-200/55">{row.contact_person}</span>
                    <StatusBadge value={row.kyc_status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </>
  );
}

/**
 * A sales agent's dashboard is their own record and nothing else.
 *
 * Read-only, deliberately: the agent's employer keeps this record, and
 * the fields they may change themselves — name, email, mobile, password
 * — belong to My profile, where each is protected by the flow it needs.
 * Their company is named, because knowing who you work for is not a
 * disclosure; its address, GSTIN and PAN are not.
 */
async function AgentDashboard({ userId }: { userId: number }) {
  const [me] = await listSalesAgents(sql`a.user_id = ${userId}`);
  if (!me) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Card>
          <Empty
            title="No sales profile yet."
            hint="Your company has not finished setting up your agent record. They will see it on their own list."
          />
        </Card>
      </>
    );
  }
  const territory = me.salesAreas
    .map((a) => `${a.cityName}${a.areas.length > 0 ? ` — ${a.areas.join(", ")}` : ""}`)
    .join(" · ");
  return (
    <>
      <PageHeader
        title={`${me.firstName} ${me.lastName}`}
        subtitle={`${me.code} · sales agent at ${me.importerName}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value={me.status} />
            <StatusBadge value={me.isActive ? "ACTIVE" : "INACTIVE"} />
          </div>
        }
      />
      <Card className="p-6">
        <h2 className="mb-4 text-sm font-semibold text-verdigris-50">Your record</h2>
        <FactList
          labelWidth="11rem"
          items={[
            { label: "Mobile", value: me.mobile, mono: true },
            { label: "Email", value: me.email ?? "—" },
            { label: "Joined", value: new Date(me.joiningDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) },
            { label: "City", value: me.cityLabel ?? "—" },
            {
              label: "Address",
              value: [me.address, me.landmark, me.area, me.pincode].filter(Boolean).join(", ") || "—",
            },
            { label: "Territory", value: territory || "None assigned yet" },
          ]}
        />
        <p className="mt-5 text-xs text-verdigris-200/55">
          Your company keeps this record. To change your name, sign-in email, mobile or password,
          use <a href="/admin/profile" className="text-verdigris-300 hover:text-patina">My profile</a>;
          anything else here is theirs to correct.
        </p>
      </Card>
    </>
  );
}

/**
 * The importer's dashboard IS their company profile: fill it in, submit
 * it, watch its verification — and once verified, a count of their
 * sales agents on top. There is no separate "My company" screen.
 */
async function ImporterDashboard({
  importerId,
  canEdit,
}: {
  importerId: number;
  /** False for a SALES_AGENT: they see the company, the owner edits it. */
  canEdit: boolean;
}) {
  const profile = await loadImporterProfile(importerId);
  if (!profile) return <PageHeader title="Dashboard" subtitle="No company is linked to this account." />;
  const [row] = await getDb().execute<{ agents: number; agents_active: number }>(sql`
    select (select count(*) from wms.sales_agent a where a.importer_id = ${importerId} and a.deleted_at is null)::int as agents,
           (select count(*) from wms.sales_agent a where a.importer_id = ${importerId} and a.deleted_at is null and a.is_active)::int as agents_active
  `);
  const geo = await loadGeoOptions();
  const verified = profile.status === "ACTIVE";
  return (
    <>
      <PageHeader
        title={profile.profile.companyName}
        subtitle={`${profile.code} · your company profile`}
        action={
          verified ? (
            <a href="/admin/sales-agents" className="rounded-xl border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45">
              Sales agents · {row?.agents ?? 0} ({row?.agents_active ?? 0} active)
            </a>
          ) : null
        }
      />
      <CompanyProfileForm initial={profile} geo={geo} readOnly={!canEdit} />
    </>
  );
}
