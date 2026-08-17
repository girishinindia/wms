import Link from "next/link";

import { Card, Cell, Denied, Empty, PageHeader, Row, StatusBadge, Table } from "@/components/admin/ui";
import { getDb } from "@/db";
import { pageGuard } from "@/lib/auth/guard";
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

  const { status } = await searchParams;
  const filter = status?.toUpperCase();
  const valid = ["PENDING", "ACTIVE", "REJECTED", "SUSPENDED"];
  const active = filter && valid.includes(filter) ? filter : null;

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
       ${active ? sql`and status = ${active}::wms.record_status` : sql``}
     order by (status = 'PENDING') desc, created_at desc
     limit 200
  `);

  const tabs = [
    { label: "All", value: null },
    { label: "Pending", value: "PENDING" },
    { label: "Active", value: "ACTIVE" },
    { label: "Rejected", value: "REJECTED" },
  ];

  return (
    <>
      <PageHeader
        title="Importers"
        subtitle="Self-registrations arrive as pending and stay there until the KYC details are filled in."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const isOn = active === tab.value;
          return (
            <Link
              key={tab.label}
              href={tab.value ? `/admin/importers?status=${tab.value}` : "/admin/importers"}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                isOn
                  ? "border-verdigris-300/40 bg-verdigris-500/15 text-verdigris-50"
                  : "border-verdigris-300/12 text-verdigris-200/60 hover:border-verdigris-300/30 hover:text-verdigris-100"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <Card>
        {rows.length === 0 ? (
          <Empty
            title="No importers here."
            hint="A registration appears once the applicant has verified both their email address and their mobile number."
          />
        ) : (
          <Table head={["Code", "Company", "Contact", "Status", "KYC", "Registered"]}>
            {rows.map((row) => (
              <Row key={row.id}>
                <Cell className="font-mono text-xs text-verdigris-300">
                  <Link href={`/admin/importers/${row.id}`} className="hover:text-patina">
                    {row.code}
                  </Link>
                </Cell>
                <Cell className="font-medium">
                  <Link href={`/admin/importers/${row.id}`} className="hover:text-patina">
                    {row.company_name}
                  </Link>
                </Cell>
                <Cell className="text-verdigris-200/60">
                  <span className="block">{row.contact_person}</span>
                  <span className="block text-xs text-verdigris-200/40">
                    {row.contact_email}
                  </span>
                </Cell>
                <Cell>
                  <StatusBadge value={row.status} />
                </Cell>
                <Cell>
                  <StatusBadge value={row.kyc_status} />
                </Cell>
                <Cell className="whitespace-nowrap text-xs text-verdigris-200/50">
                  {new Date(row.created_at).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
