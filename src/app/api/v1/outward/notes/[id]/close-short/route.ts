import { deliveryRoute, parse } from "@/lib/delivery/http";
import { closeShort } from "@/lib/outward/ops";
import { closeShortSchema } from "@/lib/validation/api-outward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/outward/notes/{id}/close-short — { reason }: what has not left is no longer asked for; picked cartons go back. */
export const POST = deliveryRoute("outward.short_close.approve", async ({ actor, id, body, meta }) =>
  closeShort(actor, id!, parse(closeShortSchema, body).reason, meta),
);
