import { z } from "@/lib/openapi/zod";

/**
 * Inward request bodies — the importer announcing goods.
 *
 * A DRAFT may be as empty as the person likes: the save schema only
 * checks the shape of whatever was sent. `submitRequirements` is the
 * list that must be whole before the dock is told, and it names each
 * missing field so the form can jump to it rather than say "incomplete".
 */

const id = z.number().int().positive();
const optionalId = id.nullable().optional();

/** TCLU1234567 — four owner letters, six digits, one check digit. */
export const containerNumber = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}[0-9]{7}$/, "A container number is 4 letters and 7 digits — TCLU1234567");

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "That is not a real date");

const blank = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), schema.nullable().optional());

export const inwardLineSchema = z.object({
  itemId: optionalId,
  description: z.string().trim().min(2, "Describe the item").max(200, "Keep it under 200 characters"),
  cartonQty: z.number().int().positive("At least one carton").max(1_000_000),
  piecesPerCarton: z.number().int().positive("At least one piece per carton").max(1_000_000),
  unitId: optionalId,
  kgPerCarton: z.number().positive("Weight per carton must be above zero").max(100_000),
  imageUrl: blank(z.string().trim().url().max(500)),
});

export const inwardSaveSchema = z.object({
  warehouseId: id,
  containerNumber: blank(containerNumber),
  containerTypeId: optionalId,
  portId: optionalId,
  expectedArrival: blank(isoDate),
  remarks: blank(z.string().trim().max(1000, "Keep remarks under 1000 characters")),
  transporterId: optionalId,
  vehicleId: optionalId,
  driverId: optionalId,
  items: z.array(inwardLineSchema).max(200, "At most 200 lines on one request").default([]),
});

export type InwardSaveInput = z.infer<typeof inwardSaveSchema>;
export type InwardLineInput = z.infer<typeof inwardLineSchema>;

export const inwardDecisionSchema = z.object({
  action: z.enum(["ACKNOWLEDGE", "NEEDS_CHANGES", "IN_PROCESS", "COMPLETE"]),
  note: blank(z.string().trim().min(3, "Say what needs to change").max(1000)),
});

export const inwardListQuerySchema = z.object({
  status: z
    .enum(["DRAFT", "SUBMITTED", "NEEDS_CHANGES", "ACKNOWLEDGED", "IN_PROCESS", "COMPLETED", "CANCELLED", "OPEN"])
    .optional(),
  warehouseId: z.coerce.number().int().positive().optional(),
  importerId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ── The importer's catalogue ──────────────────────────────────────
export const itemSaveSchema = z.object({
  description: z.string().trim().min(2, "Describe the item").max(200),
  unitId: optionalId,
  piecesPerCarton: z.number().int().positive().max(1_000_000).nullable().optional(),
  kgPerCarton: z.number().positive().max(100_000).nullable().optional(),
  hsnCode: blank(z.string().trim().regex(/^[0-9]{4,8}$/, "An HSN code is 4 to 8 digits")),
  isActive: z.boolean().optional(),
});
export type ItemSaveInput = z.infer<typeof itemSaveSchema>;

// ── Proposing a carrier from the form ─────────────────────────────
const mobile = z.string().trim().regex(/^[6-9][0-9]{9}$/, "Enter a 10-digit Indian mobile number");

export const proposeTransporterSchema = z.object({
  kind: z.literal("transporter"),
  warehouseId: id,
  name: z.string().trim().min(2).max(120),
  contactPerson: z.string().trim().min(2).max(80),
  contactMobile: mobile,
  gstin: blank(z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "That is not a valid GSTIN")),
  address: blank(z.string().trim().max(300)),
});

export const proposeVehicleSchema = z.object({
  kind: z.literal("vehicle"),
  transporterId: id,
  vehicleTypeId: id,
  registrationNumber: z.preprocess(
    (v) => (typeof v === "string" ? v.replace(/[\s-]+/g, "").toUpperCase() : v),
    z.string().regex(/^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/, "MH04AB1234 — letters and digits only"),
  ),
  capacityKg: z.number().positive().max(100_000).nullable().optional(),
  rcNumber: blank(z.string().trim().toUpperCase().max(25)),
});

export const proposeDriverSchema = z.object({
  kind: z.literal("driver"),
  transporterId: id,
  name: z.string().trim().min(2).max(80),
  mobile,
  licenceNumber: z.string().trim().toUpperCase().min(5).max(20),
  aadhaarNumber: blank(z.string().trim().regex(/^[0-9]{12}$/, "Aadhaar is 12 digits")),
});

export const proposeSchema = z.discriminatedUnion("kind", [
  proposeTransporterSchema,
  proposeVehicleSchema,
  proposeDriverSchema,
]);
export type ProposeInput = z.infer<typeof proposeSchema>;
