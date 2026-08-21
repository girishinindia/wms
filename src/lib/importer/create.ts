import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { auditQuietly } from "@/lib/audit";
import type { Actor } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { sendEmail } from "@/lib/notify/email";
import { absoluteUrl } from "@/lib/url";
import { PROFILE_REQUIRED } from "@/lib/validation/api-importer";

/**
 * A super admin creating an importer, rather than waiting for one to
 * register.
 *
 * Everything is written in ONE statement — company, login, role binding.
 * Not for elegance: `wms.importer`, `wms.users` and
 * `wms.user_role_assignment` each carry unique indexes, and building
 * them one at a time is how the sales-agent screen ended up leaving half
 * a record behind when the second insert lost a race. A single statement
 * either commits all three or none, with no compensation to get wrong.
 *
 * Where the row lands depends on what the admin typed: with the KYC
 * fields complete it can be ACTIVE and VERIFIED immediately, and the
 * importer signs in to a working portal. Without them it is PENDING, and
 * the importer completes and submits their own profile — the flow that
 * already exists, untouched.
 */

export type CreateImporterInput = {
  companyName: string;
  legalName?: string;
  tradeName?: string | null;
  entityType?: string;
  address?: string;
  landmark?: string | null;
  area?: string | null;
  cityId?: number;
  pincode?: string;
  gstin?: string | null;
  pan?: string | null;
  contactPerson: string;
  contactEmail: string;
  contactMobile: string;
  alternateMobile?: string | null;
  notes?: string | null;
  createLogin: boolean;
  verifyNow: boolean;
};

export class ImporterConflictError extends Error {
  constructor(public fields: Record<string, string>) {
    super("Duplicate details");
  }
}

/** Everything a create would collide with, found before anything is written. */
export async function findImporterConflicts(
  input: Pick<CreateImporterInput, "companyName" | "contactEmail" | "contactMobile" | "gstin" | "pan">,
  wantLogin: boolean,
): Promise<Record<string, string>> {
  const fields: Record<string, string> = {};

  const company = await getDb().execute<{ hit: boolean }>(sql`
    select true as hit from wms.importer
     where deleted_at is null and lower(company_name) = lower(${input.companyName})
     limit 1
  `);
  if (company.length > 0) fields.companyName = "A company with this name is already registered";

  if (input.gstin || input.pan) {
    const idDup = await getDb().execute<{ gstin: string | null; pan: string | null }>(sql`
      select gstin::text as gstin, pan::text as pan from wms.importer
       where deleted_at is null
         and ((${input.gstin ?? null}::text is not null and gstin::text = ${input.gstin ?? null})
           or (${input.pan ?? null}::text is not null and pan::text = ${input.pan ?? null}))
    `);
    for (const d of idDup) {
      if (input.gstin && d.gstin === input.gstin) fields.gstin = "Already registered to another importer";
      if (input.pan && d.pan === input.pan) fields.pan = "Already registered to another importer";
    }
  }

  // The login's addresses are unique across EVERY user, not just importers.
  if (wantLogin) {
    const user = await getDb().execute<{ email_hit: boolean; mobile_hit: boolean }>(sql`
      select bool_or(email = ${input.contactEmail}::citext) as email_hit,
             bool_or(mobile = ${input.contactMobile}::wms.mobile_in) as mobile_hit
        from wms.users where deleted_at is null
    `);
    if (user[0]?.email_hit) fields.contactEmail = "An account with this email already exists";
    if (user[0]?.mobile_hit) fields.contactMobile = "An account with this mobile already exists";
  }
  return fields;
}

/** True when the row carries everything `importer_complete_before_active`
 *  and the review screen expect. */
export function isProfileComplete(input: CreateImporterInput): boolean {
  const asProfile: Record<string, unknown> = {
    legalName: input.legalName,
    entityType: input.entityType,
    address: input.address,
    cityId: input.cityId,
    pincode: input.pincode,
    gstin: input.gstin,
    pan: input.pan,
  };
  return PROFILE_REQUIRED.every((k) => {
    const v = asProfile[k];
    return v !== undefined && v !== null && v !== "";
  });
}

export async function createImporterAsAdmin(
  input: CreateImporterInput,
  actor: Actor,
  meta: { requestId: string; ip: string | null; userAgent: string | null },
): Promise<{
  id: number;
  code: string;
  status: string;
  kycStatus: string;
  login: string;
  tempPassword: string | null;
}> {
  const conflicts = await findImporterConflicts(input, input.createLogin);
  if (Object.keys(conflicts).length > 0) throw new ImporterConflictError(conflicts);

  const complete = isProfileComplete(input);
  const verified = complete && input.verifyNow;
  const status = verified ? "ACTIVE" : "PENDING";
  const kyc = verified ? "VERIFIED" : "NOT_STARTED";

  const temp = input.createLogin ? randomBytes(9).toString("base64url") : null;
  const hash = temp ? await hashPassword(temp) : null;
  const [first, ...restOfName] = input.contactPerson.trim().split(/\s+/);
  const lastName = restOfName.join(" ") || first!;

  const rows = await getDb().execute<{ id: number; code: string; user_id: number | null }>(sql`
    with new_importer as (
      insert into wms.importer
        (company_name, legal_name, trade_name, entity_type, address, landmark, area,
         city_id, pincode, gstin, pan,
         contact_person, contact_email, contact_mobile, alternate_mobile,
         origin, status, kyc_status, notes, created_by,
         approved_by, approved_at)
      values (${input.companyName}, ${input.legalName ?? null}, ${input.tradeName ?? null},
              ${input.entityType ?? null}, ${input.address ?? null}, ${input.landmark ?? null},
              ${input.area ?? null}, ${input.cityId ?? null}, ${input.pincode ?? null}::wms.pincode_in,
              ${input.gstin ?? null}::wms.gstin, ${input.pan ?? null}::wms.pan_no,
              ${input.contactPerson}, ${input.contactEmail}::citext,
              ${input.contactMobile}::wms.mobile_in, ${input.alternateMobile ?? null}::wms.mobile_in,
              'CREATED_BY_ADMIN', ${status}::wms.record_status, ${kyc}, ${input.notes ?? null},
              ${actor.session.userId},
              ${verified ? actor.session.userId : null},
              ${verified ? sql`now()` : sql`null`})
      returning id, code
    ),
    new_user as (
      insert into wms.users
        (email, first_name, last_name, mobile, password_hash, password_changed_at,
         email_verified_at, mobile_verified_at, status, must_change_password, created_by)
      select ${input.contactEmail}::citext, ${first}, ${lastName},
             ${input.contactMobile}::wms.mobile_in, ${hash}, now(), now(), now(),
             'ACTIVE', true, ${actor.session.userId}
       where ${input.createLogin}
      returning id
    ),
    bound as (
      insert into wms.user_role_assignment
        (user_id, role, role_domain, importer_id, assigned_by, note)
      select new_user.id, 'IMPORTER', 'IMPORTER', new_importer.id, ${actor.session.userId},
             'Created by a super admin'
        from new_user, new_importer
      returning user_id
    )
    select new_importer.id, new_importer.code,
           (select id from new_user) as user_id
      from new_importer
  `);

  const row = rows[0]!;
  let login = input.createLogin ? "created" : "skipped";

  if (temp && input.createLogin) {
    const outcome = await sendEmail({
      toEmail: input.contactEmail,
      toName: input.contactPerson,
      subject: "Your Genius WMS account",
      message:
        `${input.companyName} has been set up on Genius WMS (${row.code}).\n\n` +
        `Sign in with this email address and the temporary password below, then set your own.\n\n` +
        `Temporary password: ${temp}\n\n` +
        (verified
          ? `Your company is already verified — everything in the portal is open to you.`
          : `Once you are in, complete your company profile and submit it for verification.`),
      actionUrl: absoluteUrl("/sign-in"),
      actionLabel: "Sign in",
    });
    login = outcome.status === "SENT" ? "emailed" : "created";
  }

  await auditQuietly({
    action: "importer.created",
    operation: "INSERT",
    entityType: "importer",
    entityId: String(row.id),
    entityLabel: input.companyName,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    reason: verified ? "created and verified by a super admin" : "created by a super admin",
    after: { ...input, code: row.code, status, kycStatus: kyc, login },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });

  return {
    id: Number(row.id),
    code: row.code,
    status,
    kycStatus: kyc,
    login,
    tempPassword: temp,
  };
}
