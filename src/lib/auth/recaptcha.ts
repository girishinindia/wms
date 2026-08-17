import "server-only";

import { recaptchaEnv } from "@/lib/env";

/**
 * reCAPTCHA v3 — score-based, no challenge.
 *
 * v3 never shows the user anything. The page runs `grecaptcha.execute`,
 * gets a token, and posts it with the form; Google returns a score from
 * 0.0 (near-certain bot) to 1.0 (near-certain human) and it is up to us
 * what to do with it. `RECAPTCHA_MIN_SCORE` is that policy, and the fact
 * that a threshold exists at all is what distinguishes v3 from v2 —
 * there is no checkbox and no pass/fail.
 *
 * Two consequences worth designing around:
 *
 *   1. The score is not a verdict. Google's own guidance is to use it as
 *      one signal among several. So a low score here does not delete an
 *      account or lock anything out; it refuses one request, and the
 *      rate limiter and lockout do the durable work.
 *
 *   2. Tokens expire after two minutes and are single-use. A user who
 *      leaves the form open and then submits gets `timeout-or-duplicate`
 *      — which is a stale page, not an attack, and must read to them as
 *      "please try again" rather than "access denied".
 */

const ENDPOINT = "https://www.google.com/recaptcha/api/siteverify";

export type RecaptchaResult =
  | { ok: true; score: number | null; skipped: boolean }
  | { ok: false; reason: "LOW_SCORE"; score: number }
  | { ok: false; reason: "STALE_TOKEN" | "INVALID" | "UNAVAILABLE"; detail?: string };

type SiteVerifyResponse = {
  success: boolean;
  score?: number;
  action?: string;
  challenge_ts?: string;
  hostname?: string;
  "error-codes"?: string[];
};

/**
 * @param token    from grecaptcha.execute() on the client
 * @param action   the action name the client used, e.g. "register".
 *                 Checked, because a token minted on a low-value page
 *                 can otherwise be replayed against a high-value one.
 * @param ip       the caller's address; improves Google's scoring
 */
export async function verifyRecaptcha(
  token: string | undefined | null,
  action: string,
  ip?: string | null,
): Promise<RecaptchaResult> {
  const env = recaptchaEnv();

  if (!env.RECAPTCHA_ENABLED) {
    // Off by configuration. Reported as `skipped` rather than silently
    // succeeding, so a handler can log that the check did not run — the
    // alternative is discovering months later that it was never on.
    return { ok: true, score: null, skipped: true };
  }

  if (!token) return { ok: false, reason: "INVALID", detail: "no token submitted" };

  let body: SiteVerifyResponse | undefined;
  try {
    const params = new URLSearchParams({
      secret: env.RECAPTCHA_SECRET_KEY!,
      response: token,
    });
    if (ip) params.set("remoteip", ip);

    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(8_000),
    });
    body = (await response.json()) as SiteVerifyResponse;
  } catch (error) {
    // Google unreachable. FAIL OPEN, deliberately: an outage at their
    // end must not take our sign-up down, and every request that gets
    // through is still rate-limited and still needs a valid password or
    // OTP. Failing closed here trades a bot problem for an outage.
    return {
      ok: false,
      reason: "UNAVAILABLE",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (!body.success) {
    const codes = body["error-codes"] ?? [];
    if (codes.includes("timeout-or-duplicate")) {
      return { ok: false, reason: "STALE_TOKEN" };
    }
    return { ok: false, reason: "INVALID", detail: codes.join(", ") || "rejected" };
  }

  // A token is bound to the action the client asked for. Without this
  // check, a token from a public contact form is a valid token for
  // password reset.
  if (body.action && body.action !== action) {
    return {
      ok: false,
      reason: "INVALID",
      detail: `token was minted for '${body.action}', not '${action}'`,
    };
  }

  const score = body.score ?? 0;
  if (score < env.RECAPTCHA_MIN_SCORE) {
    return { ok: false, reason: "LOW_SCORE", score };
  }
  return { ok: true, score, skipped: false };
}

/**
 * Should the request proceed?
 *
 * Separated from `verifyRecaptcha` because the policy is not the same
 * everywhere: a low score on registration should stop the request, while
 * Google being unreachable should not. Callers get the structured result
 * and this helper for the common case.
 */
export function shouldBlock(result: RecaptchaResult): boolean {
  if (result.ok) return false;
  // UNAVAILABLE is the fail-open case; a stale token is user error.
  return result.reason === "LOW_SCORE" || result.reason === "INVALID";
}
