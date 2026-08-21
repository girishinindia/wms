import Link from "next/link";
import { notFound } from "next/navigation";

import ImporterEditDrawer from "@/components/admin/ImporterEditDrawer";
import ImporterLifecycle from "@/components/admin/ImporterLifecycle";
import ImporterReview, { type CityOption } from "@/components/admin/ImporterReview";
import { Card, Denied, Facts, PageHeader, StatusBadge } from "@/components/admin/ui";
import { getDb } from "@/db";
import { loadGeoOptions } from "@/lib/admin/geo";
import { grantFor, importerIdOf, pageGuard } from "@/lib/auth/guard";
import { missingFields } from "@/lib/importer/profile";
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
  // OWN scope covers exactly one company — the actor's own. Anything
  // else is somebody else's customer record.
  if (guard.grant.scope === "OWN" && importerIdOf(guard.actor) !== id) {
    return <Denied what="that importer" />;
  }

  const [rows, cities] = await Promise.all([
    getDb().execute<{
      id: number;
      code: string;
      company_name: string;
      legal_name: string | null;
      trade_name: string | null;
      entity_type: string | null;
      address: string | null;
      landmark: string | null;
      area: string | null;
      city_id: number | null;
      city_name: string | null;
      state_name: string | null;
      state_id: number | null;
      country_id: number | null;
      pincode: string | null;
      gstin: string | null;
      pan: string | null;
      contact_person: string;
      contact_email: string;
      contact_mobile: string;
      alternate_mobile: string | null;
      notes: string | null;
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
      select i.id, i.code, i.company_name, i.legal_name, i.trade_name, i.entity_type, i.address,
             i.landmark, i.area, i.city_id, c.name as city_name, st.name as state_name,
             st.id as state_id, st.country_id,
             i.pincode::text as pincode,
             i.gstin::text as gstin, i.pan::text as pan,
             i.contact_person, i.contact_email::text as contact_email,
             i.contact_mobile::text as contact_mobile,
             i.alternate_mobile::text as alternate_mobile, i.notes,
             i.status::text as status, i.kyc_status, i.origin,
             i.created_at, i.approved_at, i.rejected_at, i.rejection_reason,
             d.email::text as decided_by,
             u.email_verified_at is not null as user_email_verified,
             u.mobile_verified_at is not null as user_mobile_verified
        from wms.importer i
        left join wms.city  c on c.id = i.city_id
        left join wms.state st on st.id = c.state_id
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

  /**
   * Correcting the record is a platform-wide power, so only an ALL-scoped
   * grant gets the button. An IMPORTER also holds `importer.update` — over
   * their own company, through their own profile screen, where legal name,
   * entity type, GSTIN and PAN are locked once verified. This is the door
   * that message tells them to knock on.
   */
  const canEdit = grantFor(guard.actor, "importer.update")?.scope === "ALL";
  const geo = canEdit ? await loadGeoOptions() : { countries: [], states: [], cities: [] };

  const submittedProfile = {
    legalName: row.legal_name ?? "",
    tradeName: row.trade_name ?? "",
    entityType: row.entity_type ?? "",
    address: row.address ?? "",
    landmark: row.landmark ?? "",
    area: row.area ?? "",
    cityId: row.city_id ? String(row.city_id) : "",
    cityLabel: row.city_name ? `${row.city_name}${row.state_name ? `, ${row.state_name}` : ""}` : "",
    pincode: row.pincode ?? "",
    gstin: row.gstin ?? "",
    pan: row.pan ?? "",
  };
  const missing = missingFields({
    companyName: row.company_name,
    legalName: row.legal_name ?? undefined,
    entityType: row.entity_type ?? undefined,
    address: row.address ?? undefined,
    cityId: row.city_id ?? undefined,
    pincode: row.pincode ?? undefined,
    gstin: row.gstin ?? undefined,
    pan: row.pan ?? undefined,
    contactPerson: row.contact_person,
    contactEmail: row.contact_email,
    contactMobile: row.contact_mobile,
  });

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
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <ImporterEditDrawer
                importerId={row.id}
                companyName={row.company_name}
                geo={geo}
                initialCountryId={row.country_id ? String(row.country_id) : ""}
                initialStateId={row.state_id ? String(row.state_id) : ""}
                verified={row.status !== "PENDING"}
                initial={{
                  companyName: row.company_name,
                  legalName: row.legal_name ?? "",
                  tradeName: row.trade_name ?? "",
                  entityType: row.entity_type ?? "",
                  gstin: row.gstin ?? "",
                  pan: row.pan ?? "",
                  address: row.address ?? "",
                  landmark: row.landmark ?? "",
                  area: row.area ?? "",
                  cityId: row.city_id ? String(row.city_id) : "",
                  pincode: row.pincode ?? "",
                  contactPerson: row.contact_person,
                  contactEmail: row.contact_email,
                  contactMobile: row.contact_mobile,
                  alternateMobile: row.alternate_mobile ?? "",
                  notes: row.notes ?? "",
                }}
              />
            ) : null}
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
          initial={submittedProfile}
          kycStatus={row.kyc_status}
          missing={missing}
          rejectionReason={row.rejection_reason}
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
              <p className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-rose-300">
                Reason given
              </p>
              <p className="mt-1.5 text-sm text-rose-100">{row.rejection_reason}</p>
            </div>
          ) : null}
        </Card>
      )}

      <ImporterLifecycle
        importerId={row.id}
        companyName={row.company_name}
        status={row.status}
        canUpdate={grantFor(guard.actor, "importer.update")?.scope === "ALL"}
        canDelete={grantFor(guard.actor, "importer.delete")?.scope === "ALL"}
      />
    </>
  );
}
