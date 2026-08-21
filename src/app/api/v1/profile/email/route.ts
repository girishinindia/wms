import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { requireActor } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { startEmailChange } from "@/lib/profile/contact-change";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  newEmail: z.string().trim().email().max(160),
});

/** POST /api/v1/profile/email — start a email change: OTP to the NEW address. */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const actor = await requireActor();
      const parsed = bodySchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const meta = { requestId, ip: clientIp(request.headers), userAgent: request.headers.get("user-agent") };
      const result = await startEmailChange(actor, parsed.data.newEmail, meta);
      if ("error" in result) {
        return fail("CONFLICT", result.error, requestId, { fields: { newEmail: result.error } });
      }
      return ok(
        {
          sent: true as const,
          expiresInSeconds: result.dispatched.expiresInSeconds,
          resendAfterSeconds: result.dispatched.resendAfterSeconds,
        },
        requestId,
      );
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
