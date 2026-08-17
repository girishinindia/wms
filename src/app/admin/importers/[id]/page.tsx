import Link from "next/link";
import { notFound } from "next/navigation";

import ImporterReview, { type CityOption } from "@/components/admin/ImporterReview";
import { Card, Denied, Facts, PageHeader, StatusBadge } from "@/components/admin/ui";
import { getDb } from "@/db";
import { grantFor, pageGuard } from "@/lib/auth/guard";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * One importer, and the decision about it.
 *
 * The verified contact details come first because they are the part that
 * has already been proved — both channels were confirmed with a code
 * before the row was created — and the reviewer is checking the KYC
 * paperwork against them.
 */
export default async function ImporterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const guard = await pageGuard("importer.read");
  if (!guard.ok) return <Denied what="importers" />;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const [rows, cities] = await Promise.all([
    getDb().execute<{
      id: number;
      code: string;
      company_name: string;
      legal_name: string | null;
      entity_type: string | null;
      address: string | null;
      city_name: string | null;
      pincode: string | null;
      gstin: string | null;
      pan: string | null;
      contact_person: string;
      contact_email: string;
      contact_mobile: string;
      status: string;
      kyc_status: string;
      origin: string;
      created_at: string;
      approved_at: string | null;
      rejected_at: string | null;
      rejection_reason: string | null;
      decided_by: string | null;
      user_email_verified: boolean | null;
      user_mobile_verified: boolean | null;
    }>(sql`
      select i.id, i.code, i.company_name, i.legal_name, i.entity_type, i.address,
             c.name as city_name, i.pincode::text as pincode,
             i.gstin::text as gstin, i.pan::text as pan,
             i.contact_person, i.contact_email::text as contact_email,
             i.contact_mobile::text as contact_mobile,
             i.status::text as status, i.kyc_status, i.origin,
             i.created_at, i.approved_at, i.rejected_at, i.rejection_reason,
             d.email::text as decided_by,
             u.email_verified_at is not null as user_email_verified,
             u.mobile_verified_at is not null as user_mobile_verified
        from wms.importer i
        left join wms.city  c on c.id = i.city_id
        left join wms.users d on d.id = coalesce(i.approved_by, i.rejected_by)
        -- The account that registered: the only live IMPORTER assignment
        -- for this importer. There is exactly one at sign-up.
        left join lateral (
          select uu.email_verified_at, uu.mobile_verified_at
            from wms.user_role_assignment ura
            join wms.users uu on uu.id = ura.user_id
           where ura.importer_id = i.id and ura.role = 'IMPORTER'
             and ura.revoked_at is null
           order by ura.assigned_at
           limit 1
        ) u on true
       where i.id = ${id} and i.deleted_at is null
    `),
    getDb().execute<{ id: number; name: string; state_name: string }>(sql`
      select c.id, c.name, s.name as state_name
        from wms.city c
        join wms.state s on s.id = c.state_id
       where c.is_active and c.deleted_at is null
       order by s.name, c.name
    `),
  ]);

  const row = rows[0];
  if (!row) notFound();

  const cityOptions: CityOption[] = cities.map((c) => ({
    id: c.id,
    name: c.name,
    stateName: c.state_name,
  }));

  const verified = (ok: boolean | null) =>
    ok ? (
      <span className="text-verdigris-300">verified</span>
    ) : (
      <span className="text-amber-300">not verified</span>
    );

  return (
    <>
      <Link
        href="/admin/importers"
        className="mb-4 inline-block text-xs font-medium text-verdigris-300 transition-colors hover:text-patina"
      >
        ← All importers
      </Link>

      <PageHeader
        title={row.company_name}
        subtitle={`${row.code} · registered ${new Date(row.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} · ${row.origin === "SELF_REGISTERED" ? "self-registered" : "created by an admin"}`}
        action={
          <div className="flex gap-2">
            <StatusBadge value={row.status} />
            <StatusBadge value={row.kyc_status} />
          </div>
        }
      />

      <Card className="mb-6 p-6">
        <h2 className="mb-4 text-sm font-semibold text-verdigris-50">
          From sign-up, already verified
        </h2>
        <Facts
          items={[
            { label: "Contact", value: row.contact_person },
            {
              label: "Email",
              value: (
                <>
                  {row.contact_email}{" "}
                  <span className="text-xs">{verified(row.user_email_verified)}</span>
                </>
              ),
            },
            {
              label: "Mobile",
              value: (
                <>
                  {row.contact_mobile}{" "}
                  <span className="text-xs">{verified(row.user_mobile_verified)}</span>
                </>
              ),
            },
          ]}
        />
      </Card>

      {row.status === "PENDING" ? (
        <ImporterReview
          importerId={row.id}
          companyName={row.company_name}
          cities={cityOptions}
          canDecide={grantFor(guard.actor, "importer.approve") !== null}
        />
      ) : (
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold text-verdigris-50">Record</h2>
          <Facts
            items={[
              { label: "Legal name", value: row.legal_name ?? "—" },
              { label: "Entity type", value: row.entity_type?.replace(/_/g, " ") ?? "—" },
              { label: "GSTIN", value: row.gstin ?? "—" },
              { label: "PAN", value: row.pan ?? "—" },
              {
                label: "Address",
                value: row.address
                  ? `${row.address}, ${row.city_name ?? ""} ${row.pincode ?? ""}`.trim()
                  : "—",
              },
              {
                label: row.rejected_at ? "Rejected" : "Approved",
                value: (
                  <>
                    {new Date(row.rejected_at ?? row.approved_at ?? row.created_at).toLocaleString(
                      "en-IN",
                      { day: "2-digit", month: "short", year: "numeric" },
                    )}
                    {row.decided_by ? (
                      <span className="block text-xs text-verdigris-200/45">
                        by {row.decided_by}
                      </span>
                    ) : null}
                  </>
                ),
              },
            ]}
          />

          {row.rejection_reason ? (
            <div className="mt-5 rounded-xl border border-rose-400/25 bg-rose-500/[0.06] p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-rose-300">
                Reason given
              </p>
              <p className="mt-1.5 text-sm text-rose-100">{row.rejection_reason}</p>
            </div>
          ) : null}
        </Card>
      )}
    </>
  );
}
