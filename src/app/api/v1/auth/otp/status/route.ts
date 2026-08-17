import { type NextRequest } from "next/server";

import { findAccount } from "@/lib/auth/account";
import { purposeFor } from "@/lib/auth/dispatch-otp";
import { resendCooldownRemaining } from "@/lib/auth/otp";
import { otpEnv } from "@/lib/env";
import { handler, ok, toResponse } from "@/lib/api/respond";
import { otpPurposeSchema } from "@/lib/validation/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/auth/otp/status?purpose=...&identifier=...
 *
 * What the verify screen needs to draw its countdown after a reload.
 * Without it the timer restarts at zero on refresh and the user presses
 * "resend" into a cooldown they cannot see, gets a 429, and concludes
 * the site is broken.
 *
 * Leaks nothing: an unknown identifier gets the configured defaults,
 * which is exactly what a real account with no live code would return.
 */
export async function GET(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const env = otpEnv();
      const params = request.nextUrl.searchParams;
      const purpose = otpPurposeSchema.safeParse(params.get("purpose"));
      const identifier = (params.get("identifier") ?? "").trim().toLowerCase();

      const base = {
        expiresInSeconds: env.OTP_TTL_SECONDS,
        codeLength: env.OTP_LENGTH,
        channels: env.OTP_REQUIRE_BOTH_CHANNELS
          ? (["EMAIL", "SMS"] as const)
          : (["EMAIL"] as const),
      };

      if (!purpose.success || !identifier) {
        return ok({ ...base, resendAfterSeconds: 0, channels: [...base.channels] }, requestId);
      }

      const account = await findAccount(identifier);
      if (!account) {
        return ok({ ...base, resendAfterSeconds: 0, channels: [...base.channels] }, requestId);
      }

      const waits = await Promise.all(
        base.channels.map((channel) =>
          resendCooldownRemaining({
            userId: account.id,
            purpose: purposeFor(purpose.data, channel),
            channel,
          }),
        ),
      );

      return ok(
        {
          ...base,
          channels: [...base.channels],
          resendAfterSeconds: Math.max(0, ...waits),
        },
        requestId,
      );
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
