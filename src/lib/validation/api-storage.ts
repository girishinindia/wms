import { z } from "zod";

/** POST /storage/warehouses/{id}/store */
export const storeCartonsSchema = z.object({
  galaId: z.number().int().positive(),
  scans: z
    .array(
      z.object({
        code: z.string().trim().min(1, "Empty scan").max(1000),
        clientScanId: z.string().trim().max(80).nullable().optional(),
        via: z.enum(["SCAN", "MANUAL"]).optional(),
        device: z.string().trim().max(120).nullable().optional(),
        move: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(200),
});

/** POST /storage/floors/{id}/galas */
export const addGalasSchema = z.object({ count: z.number().int().min(1).max(50) });

/** PATCH /storage/floors/{id}, /storage/galas/{id} */
export const setActiveSchema = z.object({ active: z.boolean() });
