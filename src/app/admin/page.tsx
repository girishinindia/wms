import Link from "next/link";

import { Card, Empty, PageHeader, Stat, StatusBadge } from "@/components/admin/ui";
import { getDb } from "@/db";
import { currentActor } from "@/lib/auth/guard";
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
         order by created_at
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
          note="importers registered and verified"
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
