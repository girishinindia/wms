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
    legalName: z.string().trim().min(2).max(160),
    entityType: z.enum(ENTITY_TYPES),
    address: z.string().trim().min(6).max(400),
    cityId: z.number().int().positive(),
    pincode,
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

export { ENTITY_TYPES };
