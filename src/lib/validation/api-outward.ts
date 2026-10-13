import { z } from "zod";

/** Outward — request bodies. Business rules live in lib/outward/ops and sql/42. */

const text = (max: number) => z.string().max(max).nullable().optional();
const idOpt = z.number().int().positive().nullable().optional();

export const transportSchema = z.object({
  transporterId: idOpt,
  transportName: text(120),
  transporterMobile: text(20),
  transporterGstin: text(20),
  vehicleId: idOpt,
  vehicleNo: text(20),
  vehicleType: text(60),
  driverId: idOpt,
  driverName: text(120),
  driverMobile: text(20),
  transportMode: z.enum(["ROAD", "RAIL", "AIR", "COURIER", "HAND"]).nullable().optional(),
  remarks: text(500),
  tallyVoucherNo: text(40),
});

export const createDoSchema = transportSchema.extend({
  noteId: z.number().int().positive(),
  packageIds: z.array(z.number().int().positive()).max(500).nullable().optional(),
});

export const doActionSchema = z.object({
  action: z.enum(["HOLD", "RESUME", "CANCEL", "LOADED", "REOPEN", "DEPART", "COLLECTED", "SUBMITTED", "REMOVE_PACKAGE"]),
  reason: text(300),
  packageId: idOpt,
});

export const loadScanSchema = z.object({
  code: z.string().trim().min(1, "Scan or type a code").max(500),
  clientScanId: z.string().max(80).nullable().optional(),
  via: z.enum(["SCAN", "MANUAL"]).optional(),
  device: z.string().max(120).nullable().optional(),
});

export const lrCheckSchema = z.object({
  lrId: z.number().int().positive(),
  ok: z.boolean(),
  reason: text(300),
});

export const closeShortSchema = z.object({ reason: z.string().trim().min(1, "Say why the rest does not go").max(300) });

export const doSeriesSchema = z.object({
  prefix: z.string().trim().min(1, "Enter a prefix").max(10),
  separator: z.enum(["/", "-"]),
  withYear: z.boolean(),
  withWarehouse: z.boolean(),
  padding: z.number().int().min(1).max(10),
  nextNo: z.number().int().min(1, "Next number must be 1 or more").max(9_999_999_999),
});
