import { z } from "@/lib/openapi/zod";

import { addressText, optional, pincode } from "./api-admin";

/**
 * A warehouse, as the form sends it.
 *
 * The table has thirty-three columns and this covers the twenty-four a
 * person fills in; `code` is not among them. Codes come from
 * `warehouse_code_seq` as WH-0001, the same way importers and sales
 * agents get theirs — a NOT NULL UNIQUE column typed by hand is a
 * collision waiting for two people to add a warehouse on the same
 * afternoon.
 */

const mobile = z
  .string()
  .trim()
  .regex(/^[6-9][0-9]{9}$/, "Enter a 10-digit Indian mobile number")
  .openapi({ example: "9876543210" });

/** Blank means "not given". Numbers arrive from inputs as strings. */
const optionalNumber = (max: number, min = 0) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : typeof v === "string" ? Number(v) : v),
    z.number().finite().min(min).max(max).optional(),
  );

const optionalInt = (max: number) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : typeof v === "string" ? Number(v) : v),
    z.number().int().min(0).max(max).optional(),
  );

/**
 * A map link, and only a map link.
 *
 * The value is rendered as an anchor on the detail screen, so an
 * unchecked string here is a stored redirect — `javascript:` and `data:`
 * both survive a naive "does it look like a URL" test. Only http(s) is
 * allowed through.
 */
const gmapUrl = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z
    .string()
    .trim()
    .max(500)
    .refine((v) => /^https?:\/\//i.test(v), "Paste a link starting with http:// or https://")
    .optional(),
);

const core = {
  name: z
    .string()
    .trim()
    .min(2)
    .max(160)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 ,.&()/'-]*$/, "Only letters, digits, spaces and , . & ( ) / ' - are allowed")
    .refine((v) => /[A-Za-z]/.test(v), "A name needs at least one letter"),
  warehouseTypeId: z.number().int().positive(),
  address: addressText(6, 400),
  landmark: optional(addressText(2, 160)),
  area: optional(addressText(2, 160)),
  cityId: z.number().int().positive(),
  pincode,

  latitude: optionalNumber(90, -90),
  longitude: optionalNumber(180, -180),
  gmapUrl,

  totalAreaSqft: optionalNumber(100_000_000),
  usableAreaSqft: optionalNumber(100_000_000),
  storageCapacityCbm: optionalNumber(100_000_000),
  palletPositions: optionalInt(10_000_000),
  dockCount: optionalInt(1000),
  maxVehicleLengthFt: optionalNumber(500),
  floorCount: optionalInt(200),

  hasRacking: z.boolean().default(true),
  hasCctv: z.boolean().default(false),
  hasWeighbridge: z.boolean().default(false),

  contactPerson: optional(z.string().trim().min(2).max(120)),
  contactMobile: optional(mobile),
  alternateMobile: optional(mobile),

  isActive: z.boolean().default(true),
  notes: optional(z.string().trim().max(1000)),
};

/** `usable <= total` is a CHECK on the table. Answered here first, with
 *  the field named, so the database never has to say it. */
const areasAgree = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((value: unknown, ctx: z.RefinementCtx) => {
    const v = value as { totalAreaSqft?: number; usableAreaSqft?: number };
    if (
      typeof v.totalAreaSqft === "number" &&
      typeof v.usableAreaSqft === "number" &&
      v.usableAreaSqft > v.totalAreaSqft
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["usableAreaSqft"],
        message: "Usable area cannot exceed the total area",
      });
    }
  });

export const createWarehouseSchema = areasAgree(z.object(core).openapi("CreateWarehouseRequest"));

export const updateWarehouseSchema = areasAgree(
  z
    .object({
      ...Object.fromEntries(
        Object.entries(core).map(([k, v]) => [
          k,
          // `.default()` makes a field non-optional on a PATCH, which
          // would silently reset every checkbox the form did not send.
          v instanceof z.ZodDefault ? v.removeDefault().optional() : v.optional(),
        ]),
      ),
    })
    .openapi("UpdateWarehouseRequest"),
);

export const warehouseResponseSchema = z
  .object({
    id: z.number().int(),
    code: z.string(),
    name: z.string(),
    isActive: z.boolean(),
  })
  .openapi("WarehouseResponse");

// ── Gallery ───────────────────────────────────────────────────────

export const warehouseImageSchema = z
  .object({
    id: z.number().int(),
    warehouseId: z.number().int(),
    url: z.string().url(),
    caption: z.string().nullable(),
    width: z.number().int(),
    height: z.number().int(),
    bytes: z.number().int(),
    sortOrder: z.number().int(),
    createdAt: z.string(),
  })
  .openapi("WarehouseImage");

export const warehouseImageListSchema = z
  .object({ images: z.array(warehouseImageSchema) })
  .openapi("WarehouseImageList");
