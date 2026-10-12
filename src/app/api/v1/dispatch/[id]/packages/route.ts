import { deliveryRoute, parse } from "@/lib/delivery/http";
import { createPackage } from "@/lib/dispatch/ops";
import { packageSchema } from "@/lib/validation/api-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/dispatch/{id}/packages — open a new package / bundle (gets its PK- code). */
export const POST = deliveryRoute("package.read", async ({ actor, id, body, meta }) => ({
  work: await createPackage(actor, id!, parse(packageSchema, body), meta),
}));
