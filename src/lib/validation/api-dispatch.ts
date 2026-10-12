import { z } from "zod";

/** Pick & pack — request bodies. Business rules live in lib/dispatch/ops and sql/41. */

const size = (max: number) => z.number().positive().max(max).nullable().optional();

export const assignSchema = z.object({ userIds: z.array(z.number().int().positive()).max(20) });

export const holdSchema = z.object({ on: z.boolean(), reason: z.string().max(300).nullable().optional() });

export const scanSchema = z.object({
  step: z.enum(["PICK", "ARRIVE", "VERIFY"]),
  code: z.string().trim().min(1, "Scan or type a code").max(500),
  clientScanId: z.string().max(80).nullable().optional(),
  via: z.enum(["SCAN", "MANUAL"]).optional(),
  device: z.string().max(120).nullable().optional(),
});

export const packScanSchema = scanSchema.omit({ step: true }).extend({ remove: z.boolean().optional() });

export const packageSchema = z.object({
  kind: z.enum(["PACKAGE", "BUNDLE"]).optional(),
  weightKg: size(10_000),
  lengthCm: size(10_000),
  widthCm: size(10_000),
  heightCm: size(10_000),
});

export const packageActionSchema = packageSchema.extend({
  action: z.enum(["CLOSE", "REOPEN", "CANCEL", "UPDATE", "PRINTED"]),
  reason: z.string().max(300).nullable().optional(),
});

export const cancelNoteSchema = z.object({ reason: z.string().trim().min(1, "Say why it is cancelled").max(500) });
