import { z } from "zod";

/** Delivery notes — request bodies. Business rules live in lib/delivery/ops. */

const text = (max: number) => z.string().max(max).nullable().optional();

export const deliveryHeaderSchema = z.object({
  clientId: z.number().int().positive().nullable().optional(),
  buyerName: text(120),
  buyerMobile: text(40),
  buyerAddress: text(600),
  buyerGstin: text(15),
  destination: text(120),
  transportName: text(120),
  paymentMode: text(40),
  billing: z.enum(["WITH_BILL", "WITHOUT_BILL"]).nullable().optional(),
  billAmount: z.number().min(0).max(1_000_000_000).nullable().optional(),
  priority: z.enum(["NORMAL", "URGENT"]).optional(),
  packing: z.enum(["CARTON", "BUNDLE", "LOOSE"]).optional(),
  bundles: z.number().int().min(0).max(9999).nullable().optional(),
  instructions: text(1000),
});

export const startDraftSchema = z.object({ copyFrom: z.number().int().positive().nullable().optional() });

export const holdLineSchema = z.object({
  warehouseId: z.number().int().positive(),
  key: z.string().min(1).max(80),
  cartons: z.number().int().min(0).max(100000),
});

export const clientCreateSchema = z.object({
  name: z.string().trim().min(1, "Enter the buyer's name").max(120),
  mobile: z.string().trim().min(1, "Enter the mobile number").max(20),
  address: text(600),
  gstin: text(15),
  pincode: text(6),
});

const confirmSchema = z
  .object({
    method: z.string().max(20),
    person: z.string().max(120),
    note: z.string().max(500).nullable().optional(),
  })
  .nullable()
  .optional();

export const approveSchema = z.object({ confirm: confirmSchema });
export const rejectSchema = z.object({ reason: z.string().max(500), confirm: confirmSchema });

export const editNoteSchema = deliveryHeaderSchema.extend({
  lines: z
    .array(z.object({ key: z.string().min(1).max(80), cartons: z.number().int().min(0).max(100000) }))
    .min(1, "Keep at least one item")
    .max(300),
});

export const seriesSchema = z.object({
  prefix: z.string().max(12).optional(),
  orderPrefix: z.string().max(12).optional(),
  nextNo: z.number().int().min(1).max(99_999_999).optional(),
  nextOrderNo: z.number().int().min(1).max(99_999_999).optional(),
});

export const autoApproveSchema = z.object({ on: z.boolean() });
