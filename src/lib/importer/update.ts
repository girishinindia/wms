import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { auditQuietly } from "@/lib/audit";
import type { Actor } from "@/lib/auth/guard";
import { loadImporterProfile, patchImporterProfile, type ImporterProfile } from "@/lib/importer/profile";
import { ACTIVE_REQUIRED } from "@/lib/validation/api-importer";

/** For the sentence, not the field map — "without a legal name" reads
 *  better to the person who just emptied the box than "without
 *  legalName". */
const REQUIRED_LABEL: Record<string, string> = {
  legalName: "a legal name",
  entityType: "an entity type",
  address: "an address",
  cityId: "a city",
  pincode: "a pincode",
};

/**
 * A super admin correcting an importer's record.
 *
 * The portal already told importers this endpoint existed: once a company
 * is verified, `PATCH /importer/me` refuses legal name, entity type,
 * GSTIN and PAN with "Ask the warehouse to change them." Until now the
 * warehouse had nowhere to change them from. This is that place.
 *
 * Everything the review and life-cycle screens own — status, KYC state,
 * approval, suspension, deletion — stays with them. This writes the
 * record and nothing else, and answers with field-level messages rather
 * than letting a unique index or a check constraint answer with a 500.
 */

export type UpdateImporterInput = Record<string, unknown>;

/** One error for the route to translate, carrying the field map when it
 *  has one. `kind` maps straight onto the API's error codes. */
export class ImporterUpdateError extends Error {
  constructor(
    readonly kind: "NOT_FOUND" | "CONFLICT" | "VALIDATION_FAILED",
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ImporterUpdateError";
  }
}

/**
 * Every unique index this change could trip, checked against every OTHER
 * importer. Excluding the row itself matters: saving a form without
 * touching the company name must not report the company's own name as a
 * duplicate of itself.
 */
export async function findUpdateConflicts(
  id: number,
  input: UpdateImporterInput,
): Promise<Record<string, string>> {
  const fields: Record<string, string> = {};

  if (typeof input.companyName === "string") {
    const hit = await getDb().execute<{ hit: boolean }>(sql`
      select true as hit from wms.importer
       where deleted_at is null and id <> ${id}
         and lower(company_name) = lower(${input.companyName})
       limit 1
    `);
    if (hit.length > 0) fields.companyName = "Already registered to another importer";
  }

  const gstin = typeof input.gstin === "string" ? input.gstin : null;
  const pan = typeof input.pan === "string" ? input.pan : null;
  if (gstin || pan) {
    const dup = await getDb().execute<{ gstin: string | null; pan: string | null }>(sql`
      select gstin::text as gstin, pan::text as pan from wms.importer
       where deleted_at is null and id <> ${id}
         and ((${gstin}::text is not null and gstin::text = ${gstin})
           or (${pan}::text is not null and pan::text = ${pan}))
    `);
    for (const d of dup) {
      if (gstin && d.gstin === gstin) fields.gstin = "Already registered to another importer";
      if (pan && d.pan === pan) fields.pan = "Already registered to another importer";
    }
  }

  return fields;
}

/**
 * True while a self-registration has not yet been linked to its login.
 *
 * `pendingImporterFor` finds that importer by `contact_email` alone,
 * because until the account is verified the role assignment that would
 * link them does not exist yet. Changing the address in that window
 * orphans the company. It is a narrow window and a rare edit, so it is
 * refused rather than handled.
 */
async function linkedByEmailOnly(id: number): Promise<boolean> {
  const rows = await getDb().execute<{ unlinked: boolean }>(sql`
    select (i.origin = 'SELF_REGISTERED' and ura.user_id is null) as unlinked
      from wms.importer i
      left join lateral (
        select user_id from wms.user_role_assignment
         where importer_id = i.id and role = 'IMPORTER' and revoked_at is null
         limit 1
      ) ura on true
     where i.id = ${id} and i.deleted_at is null
  `);
  return rows[0]?.unlinked === true;
}

export async function updateImporterAsAdmin(
  id: number,
  input: UpdateImporterInput,
  actor: Actor,
  meta: { requestId: string; ip: string | null; userAgent: string | null },
): Promise<ImporterProfile> {
  const before = await loadImporterProfile(id);
  if (!before) throw new ImporterUpdateError("NOT_FOUND", "No such importer");

  if (
    typeof input.contactEmail === "string" &&
    input.contactEmail.toLowerCase() !== before.profile.contactEmail.toLowerCase() &&
    (await linkedByEmailOnly(id))
  ) {
    throw new ImporterUpdateError(
      "VALIDATION_FAILED",
      "This registration is still matched to its sign-up by this email address. It can be changed once the account has been verified.",
      { contactEmail: "Locked until the account is verified" },
    );
  }

  // Asked before the write so a retired city comes back as a field
  // message instead of a foreign-key violation nobody can read.
  if (typeof input.cityId === "number") {
    const city = await getDb().execute<{ id: number }>(sql`
      select id from wms.city where id = ${input.cityId} and is_active and deleted_at is null
    `);
    if (city.length === 0) {
      throw new ImporterUpdateError("VALIDATION_FAILED", "Choose a city that is in use", {
        cityId: "Not an active city",
      });
    }
  }

  const conflicts = await findUpdateConflicts(id, input);
  if (Object.keys(conflicts).length > 0) {
    throw new ImporterUpdateError(
      "CONFLICT",
      "Some details are already in use — see the highlighted fields",
      conflicts,
    );
  }

  /**
   * `importer_complete_before_active` allows a row to be incomplete only
   * while it is PENDING. Emptying the legal name of a verified company
   * would therefore be refused by the database, in language written for
   * a DBA. Answer first, in language written for the person who did it.
   *
   * Measured against ACTIVE_REQUIRED, which is what the check constraint
   * actually says — not PROFILE_REQUIRED, which adds GSTIN and PAN. Old
   * verified companies exist without either, and holding an edit to a
   * rule their row never had to pass would lock them out of being
   * corrected at all.
   */
  if (before.status !== "PENDING") {
    const merged = { ...before.profile, ...input } as Record<string, unknown>;
    const missing = ACTIVE_REQUIRED.filter((k) => {
      const v = merged[k];
      return v === undefined || v === null || v === "";
    });
    if (missing.length > 0) {
      throw new ImporterUpdateError(
        "VALIDATION_FAILED",
        `A verified company cannot be left without ${missing.map((k) => REQUIRED_LABEL[k] ?? k).join(", ")}.`,
        Object.fromEntries(missing.map((k) => [k, "Required while the company is verified"])),
      );
    }
  }

  // `notes` is deliberately absent from ImporterProfile — it is an
  // internal remark and GET /importer/me must not hand it to the
  // importer — so its old value is read here, only for the audit row.
  const notesBefore =
    "notes" in input
      ? ((
          await getDb().execute<{ notes: string | null }>(sql`
            select notes from wms.importer where id = ${id}
          `)
        )[0]?.notes ?? null)
      : undefined;

  const touched = await patchImporterProfile(id, input, actor.session.userId);
  if (touched.length === 0) throw new ImporterUpdateError("VALIDATION_FAILED", "Nothing to change");

  const after = await loadImporterProfile(id);
  if (!after) throw new ImporterUpdateError("NOT_FOUND", "No such importer");

  const valueOf = (source: ImporterProfile, key: string, notes: string | null | undefined) =>
    key === "notes" ? notes ?? null : (source.profile as Record<string, unknown>)[key] ?? null;

  await auditQuietly({
    action: "importer.updated",
    operation: "UPDATE",
    entityType: "importer",
    entityId: String(id),
    entityLabel: `${before.code} ${before.profile.companyName}`,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    reason: "record corrected by a super admin",
    before: Object.fromEntries(touched.map((k) => [k, valueOf(before, k, notesBefore)])),
    after: Object.fromEntries(
      touched.map((k) => [k, valueOf(after, k, (input.notes as string | null | undefined) ?? null)]),
    ),
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });

  return after;
}
