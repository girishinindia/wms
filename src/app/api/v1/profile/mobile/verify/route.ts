import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { requireActor } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { verifyContactChange } from "@/lib/profile/contact-change";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ code: z.string().trim().min(4).max(10) });

/**
 * POST /api/v1/profile/mobile/verify — confirm the code sent to the new
 * address. On success the mobile is updated, every session is revoked and
 * the client returns to sign-in.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const actor = await requireActor();
      const parsed = bodySchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Enter the code", requestId, { fields: fieldsFrom(parsed.error) });
      }
      const meta = { requestId, ip: clientIp(request.headers), userAgent: request.headers.get("user-agent") };
      const result = await verifyContactChange(actor, "mobile", parsed.data.code, meta);
      if ("error" in result) {
        return fail("VALIDATION_FAILED", result.error, requestId, { fields: { code: result.error } });
      }
      return ok({ ok: true as const, signedOut: true as const, mobile: result.address }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
