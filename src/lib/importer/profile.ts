import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db";
import { PROFILE_REQUIRED } from "@/lib/validation/api-importer";

/**
 * The importer's own company profile — reading it, patching it, and
 * deciding whether it is complete enough to submit.
 *
 * "Complete" is defined once, in `PROFILE_REQUIRED`, and mirrors the
 * database's `importer_complete_before_active` check plus GSTIN and PAN.
 * The API, the form and the review screen all ask this module, so they
 * cannot disagree about which field is missing.
 */

export type ImporterProfile = {
  id: number;
  code: string;
  status: string;
  kycStatus: string;
  rejectionReason: string | null;
  profile: {
    companyName: string;
    legalName?: string;
    tradeName?: string;
    entityType?: string;
    address?: string;
    landmark?: string;
    area?: string;
    cityId?: number;
    pincode?: string;
    gstin?: string;
    pan?: string;
    contactPerson: string;
    contactEmail: string;
    contactMobile: string;
    alternateMobile?: string;
  };
  cityLabel: string | null;
  stateId: number | null;
  countryId: number | null;
  complete: boolean;
  missing: string[];
};

const COLUMNS: Record<string, string> = {
  companyName: "company_name",
  legalName: "legal_name",
  tradeName: "trade_name",
  entityType: "entity_type",
  address: "address",
  landmark: "landmark",
  area: "area",
  cityId: "city_id",
  pincode: "pincode",
  gstin: "gstin",
  pan: "pan",
  contactPerson: "contact_person",
  contactEmail: "contact_email",
  contactMobile: "contact_mobile",
  alternateMobile: "alternate_mobile",
};

/** The typed casts the domains need. Anything not listed is plain text. */
const CASTS: Record<string, string> = {
  pincode: "::wms.pincode_in",
  gstin: "::wms.gstin",
  pan: "::wms.pan_no",
  contactEmail: "::citext",
  contactMobile: "::wms.mobile_in",
  alternateMobile: "::wms.mobile_in",
};

export function missingFields(profile: ImporterProfile["profile"]): string[] {
  return PROFILE_REQUIRED.filter((k) => {
    const v = (profile as Record<string, unknown>)[k];
    return v === undefined || v === null || v === "";
  });
}

export async function loadImporterProfile(importerId: number): Promise<ImporterProfile | null> {
  const rows = await getDb().execute<Record<string, unknown>>(sql`
    select i.id, i.code, i.status::text as status, i.kyc_status, i.rejection_reason,
           i.company_name, i.legal_name, i.trade_name, i.entity_type, i.address, i.landmark,
           i.area, i.city_id, i.pincode::text as pincode, i.gstin::text as gstin, i.pan::text as pan,
           i.contact_person, i.contact_email::text as contact_email,
           i.contact_mobile::text as contact_mobile, i.alternate_mobile::text as alternate_mobile,
           c.name as city_label, s.id as state_id, s.country_id
      from wms.importer i
      left join wms.city c on c.id = i.city_id
      left join wms.state s on s.id = c.state_id
     where i.id = ${importerId} and i.deleted_at is null
  `);
  const r = rows[0];
  if (!r) return null;
  const str = (k: string) => (r[k] === null || r[k] === undefined ? undefined : String(r[k]).trim());
  const profile: ImporterProfile["profile"] = {
    companyName: String(r.company_name),
    legalName: str("legal_name"),
    tradeName: str("trade_name"),
    entityType: str("entity_type"),
    address: str("address"),
    landmark: str("landmark"),
    area: str("area"),
    cityId: r.city_id === null ? undefined : Number(r.city_id),
    pincode: str("pincode"),
    gstin: str("gstin"),
    pan: str("pan"),
    contactPerson: String(r.contact_person),
    contactEmail: String(r.contact_email),
    contactMobile: String(r.contact_mobile),
    alternateMobile: str("alternate_mobile"),
  };
  const missing = missingFields(profile);
  return {
    id: Number(r.id),
    code: String(r.code),
    status: String(r.status),
    kycStatus: String(r.kyc_status),
    rejectionReason: (r.rejection_reason as string | null) ?? null,
    profile,
    cityLabel: (r.city_label as string | null) ?? null,
    stateId: r.state_id === null ? null : Number(r.state_id),
    countryId: r.country_id === null ? null : Number(r.country_id),
    complete: missing.length === 0,
    missing,
  };
}

/**
 * Write the fields present in `input`. Returns the columns touched so
 * the caller can audit exactly those.
 */
export async function patchImporterProfile(
  importerId: number,
  input: Record<string, unknown>,
  actorUserId: number,
): Promise<string[]> {
  const sets: SQL[] = [];
  const touched: string[] = [];
  for (const [key, column] of Object.entries(COLUMNS)) {
    if (!(key in input)) continue;
    const value = input[key];
    touched.push(key);
    const cast = CASTS[key];
    sets.push(
      cast
        ? sql`${sql.raw(column)} = ${value ?? null}${sql.raw(cast)}`
        : sql`${sql.raw(column)} = ${value ?? null}`,
    );
  }
  if (sets.length === 0) return [];
  sets.push(sql`updated_by = ${actorUserId}`);
  await getDb().execute(sql`
    update wms.importer set ${sql.join(sets, sql`, `)}
     where id = ${importerId} and deleted_at is null
  `);
  return touched;
}
