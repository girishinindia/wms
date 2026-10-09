import { type NextRequest } from "next/server";

import { fail, fieldsFrom, handler, ok } from "@/lib/api/respond";
import { importerIdOf, requireVerifiedImporter } from "@/lib/auth/guard";
import { jsonBody, metaOf, respondError } from "@/lib/inward/http";
import { propose } from "@/lib/inward/ops";
import { proposeSchema } from "@/lib/validation/api-inward";
import { isUniqueViolation } from "@/lib/db-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/inward-requests/propose — "+ Add new" from the form.
 *
 * { kind: transporter | vehicle | driver, ...fields }. The row is
 * PENDING and stamped with the proposing importer; it can be picked on
 * their own requests at once and is approved by the transporter
 * manager through the register. Keyed on `inward.request.create`
 * rather than `transporter.create`, which importers deliberately do
 * not hold — proposing is part of raising a request, not of keeping
 * the register.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor } = await requireVerifiedImporter("inward.request.create", { entityType: "inward_request" });
      const importerId = importerIdOf(actor);
      if (importerId === null) return fail("FORBIDDEN", "You are not linked to an importer", requestId);
      const body = await jsonBody(request);
      if (body === undefined) return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      const parsed = proposeSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      return ok(await propose(actor, importerId, parsed.data, metaOf(request, requestId)), requestId, 201);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return fail("CONFLICT", "That one is already on the register — search for it instead", requestId);
      }
      return respondError(error, requestId);
    }
  })();
}
