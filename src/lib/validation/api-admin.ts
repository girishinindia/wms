import { z } from "@/lib/openapi/zod";

/**
 * Request bodies for the admin API.
 *
 * Separate from `api-auth.ts` for the same reason that file is separate
 * from the form schemas: these endpoints are authenticated, none of them
 * carries a captcha, and the generated client should group them apart.
 */

const ENTITY_TYPES = [
  "PROPRIETORSHIP",
  "PARTNERSHIP",
  "LLP",
  "PRIVATE_LIMITED",
  "PUBLIC_LIMITED",
  "HUF",
  "TRUST",
  "SOCIETY",
  "GOVERNMENT",
] as const;

/** Mirrors the `pincode_in` domain: six digits, not starting with zero. */
const pincode = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, "Pincode must be 6 digits and cannot start with 0")
  .openapi({ example: "400001" });

/** Mirrors the `gstin` domain exactly, so a bad value is refused here
 *  with a field message rather than by the database with a 500. */
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
    "That does not look like a valid GSTIN",
  )
  .openapi({ example: "27AAACG1234A1Z5" });

const pan = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "That does not look like a valid PAN")
  .openapi({ example: "AAACG1234A" });

/**
 * An empty string from a form field means "not provided", not "invalid".
 *
 * An unfilled optional input posts `""`, and running that through a
 * regex-validated schema fails with "does not look like a valid GSTIN"
 * on a field the user deliberately left blank.
 */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), schema.optional());

/**
 * Address lines, landmarks, localities and similar free text.
 *
 * Starts with a letter or digit; after that letters, digits, spaces and
 * the punctuation real addresses use ( , . - / ( ) ' & ). "99-100" and
 * "12/3, MG Road" pass; "@@$# fvf 56768" does not.
 */
const addressText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9 ,.\-/()'&]*$/,
      "Only letters, digits, spaces and , . - / ( ) ' & are allowed",
    );

// ── Cities ────────────────────────────────────────────────────────
/**
 * Several at once, on purpose.
 *
 * The table starts empty and a working system needs dozens of rows
 * before anything else can be created. Adding them one modal at a time
 * is the kind of task people abandon halfway, leaving a half-populated
 * master table that looks finished.
 */
export const createCitiesRequestSchema = z
  .object({
    stateId: z.number().int().positive(),
    names: z
      .array(z.string().trim().min(2).max(80))
      .min(1, "Enter at least one city")
      .max(200, "Add at most 200 at a time"),
  })
  .openapi("CreateCitiesRequest");

export const createCitiesResponseSchema = z
  .object({
    created: z.number().int(),
    /** Already present for this state; not an error, just nothing to do. */
    skipped: z.array(z.string()),
  })
  .openapi("CreateCitiesResponse");

export const updateCityRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.isActive !== undefined, {
    message: "Nothing to change",
  })
  .openapi("UpdateCityRequest");

// ── Importers ─────────────────────────────────────────────────────
/**
 * The fields `importer_complete_before_active` requires.
 *
 * The check constraint says a row may only leave PENDING once legal
 * name, entity type, address, city and pincode are all present — which
 * means approval is not a button, it is a form. Modelling it as
 * "approve, and here is the missing data" rather than "approve" is the
 * difference between a working screen and one that returns a constraint
 * violation the user cannot act on.
 */
export const approveImporterRequestSchema = z
  .object({
    /**
     * All optional now: the importer completes their own profile and
     * submits it, and approval simply confirms what is there. A super
     * admin may still correct a field on the way through. Whatever is
     * not sent is kept from the row, and the database's
     * `importer_complete_before_active` check is the final word.
     */
    legalName: z.string().trim().min(2).max(160).optional(),
    entityType: z.enum(ENTITY_TYPES).optional(),
    address: addressText(6, 400).optional(),
    cityId: z.number().int().positive().optional(),
    pincode: pincode.optional(),
    gstin: optional(gstin),
    pan: optional(pan),
    creditLimit: z.number().min(0).max(99_999_999).optional(),
    creditDays: z.number().int().min(0).max(365).optional(),
    notes: optional(z.string().trim().max(1000)),
  })
  .openapi("ApproveImporterRequest");

export const approveImporterResponseSchema = z
  .object({
    id: z.number().int(),
    code: z.string(),
    status: z.literal("ACTIVE"),
    kycStatus: z.string(),
  })
  .openapi("ApproveImporterResponse");

/**
 * A super admin creating an importer outright, instead of waiting for a
 * self-registration.
 *
 * Only the company name and the contact are required: an admin taking
 * details over the phone should not be blocked for want of a GSTIN. The
 * KYC fields are optional, and what is supplied decides where the row
 * lands — complete means it can be verified on the spot, incomplete
 * means the importer finishes it themselves through the normal flow.
 */
export const createImporterRequestSchema = z
  .object({
    companyName: z.string().trim().min(2).max(160),
    legalName: z.string().trim().min(2).max(160).optional(),
    tradeName: optional(z.string().trim().max(160)),
    entityType: z.enum(ENTITY_TYPES).optional(),
    address: addressText(6, 400).optional(),
    landmark: optional(addressText(2, 160)),
    area: optional(addressText(2, 160)),
    cityId: z.number().int().positive().optional(),
    pincode: pincode.optional(),
    gstin: optional(gstin),
    pan: optional(pan),
    contactPerson: z.string().trim().min(2).max(120),
    contactEmail: z.string().trim().email().max(160),
    contactMobile: z
      .string()
      .trim()
      .regex(/^[6-9][0-9]{9}$/, "Enter a 10-digit Indian mobile number"),
    alternateMobile: optional(
      z.string().trim().regex(/^[6-9][0-9]{9}$/, "Enter a 10-digit Indian mobile number"),
    ),
    notes: optional(z.string().trim().max(1000)),
    /** A portal login for the contact person. Default yes — an importer
     *  with no login cannot do anything. */
    createLogin: z.boolean().default(true),
    /** Verify on the spot. Only honoured when the KYC fields are
     *  complete; the database's own check has the last word. */
    verifyNow: z.boolean().default(true),
  })
  .openapi("CreateImporterRequest");

export const createImporterResponseSchema = z
  .object({
    id: z.number().int(),
    code: z.string(),
    status: z.string(),
    kycStatus: z.string(),
    login: z.string(),
    tempPassword: z.string().nullable(),
  })
  .openapi("CreateImporterResponse");

/**
 * On an update, an empty box means "remove what is there".
 *
 * The opposite of what it means on a create, where an empty optional
 * field was simply never filled in. `optional()` above maps "" to
 * undefined — right for a create, wrong here, because it would make a
 * mistyped PAN impossible to clear. So "" becomes null, the column is
 * set to null, and the field counts as touched for the audit row.
 */
const clearable = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" || v === null ? null : v), schema.nullable().optional());

/**
 * A super admin correcting an importer's record — any subset of fields.
 *
 * Everything is optional because this is a PATCH, and everything the
 * database allows to be null is `clearable`. Company name and the three
 * contact columns are NOT NULL, so they can be changed but not emptied.
 *
 * Status, KYC state and credit terms are deliberately absent: those move
 * through approve, reject and lifecycle, where each has its own rules and
 * its own notification.
 */
export const updateImporterRequestSchema = z
  .object({
    companyName: z.string().trim().min(2).max(160).optional(),
    legalName: clearable(z.string().trim().min(2).max(160)),
    tradeName: clearable(z.string().trim().min(1).max(160)),
    entityType: clearable(z.enum(ENTITY_TYPES)),
    address: clearable(addressText(6, 400)),
    landmark: clearable(addressText(2, 160)),
    area: clearable(addressText(2, 160)),
    cityId: clearable(z.number().int().positive()),
    pincode: clearable(pincode),
    gstin: clearable(gstin),
    pan: clearable(pan),
    contactPerson: z.string().trim().min(2).max(120).optional(),
    contactEmail: z.string().trim().email().max(160).optional(),
    contactMobile: z
      .string()
      .trim()
      .regex(/^[6-9][0-9]{9}$/, "Enter a 10-digit Indian mobile number")
      .optional(),
    alternateMobile: clearable(
      z.string().trim().regex(/^[6-9][0-9]{9}$/, "Enter a 10-digit Indian mobile number"),
    ),
    notes: clearable(z.string().trim().max(1000)),
  })
  .openapi("UpdateImporterRequest");

export const rejectImporterRequestSchema = z
  .object({
    /**
     * Required, and not only because the schema demands it: the row is
     * what the applicant is told, and "rejected" with no reason
     * generates a support call every time.
     */
    reason: z.string().trim().min(10, "Give a reason of at least 10 characters").max(500),
  })
  .openapi("RejectImporterRequest");

// ── Users and roles ───────────────────────────────────────────────
export const roleKeySchema = z.enum([
  "SUPER_ADMIN",
  "WAREHOUSE_ADMIN",
  "TRANSPORTER_MANAGER",
  "INWARD_MANAGER",
  "STORAGE_MANAGER",
  "PACKAGE_MANAGER",
  "DISPATCH_MANAGER",
  "IMPORTER",
  "SALES_AGENT",
]);

export const assignRoleRequestSchema = z
  .object({
    role: roleKeySchema,
    /** Required for a WAREHOUSE-domain role, forbidden otherwise. The
     *  database enforces this; it is checked here for a better message. */
    warehouseId: z.number().int().positive().optional(),
    importerId: z.number().int().positive().optional(),
    note: optional(z.string().trim().max(300)),
  })
  .openapi("AssignRoleRequest");

export const revokeRoleRequestSchema = z
  .object({
    assignmentId: z.number().int().positive(),
    reason: z.string().trim().min(5, "Give a reason").max(300),
  })
  .openapi("RevokeRoleRequest");

export const setUserStatusRequestSchema = z
  .object({
    status: z.enum(["ACTIVE", "SUSPENDED"]),
    /** The schema requires one whenever the status is SUSPENDED. */
    reason: optional(z.string().trim().max(300)),
  })
  .refine((v) => v.status !== "SUSPENDED" || (v.reason ?? "").length >= 5, {
    message: "Suspending an account needs a reason",
    path: ["reason"],
  })
  .openapi("SetUserStatusRequest");

export const okAdminResponseSchema = z
  .object({ ok: z.literal(true) })
  .openapi("OkAdminResponse");

export { ENTITY_TYPES, pincode, gstin, pan, optional, addressText };
