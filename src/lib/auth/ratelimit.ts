import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { ratelimitEnv } from "@/lib/env";

/**
 * Rate limiting, on Upstash.
 *
 * The design decision that matters here is **what the key is**.
 *
 * Key on IP alone and a botnet walks straight past it, because each
 * node gets its own budget. Key on the account alone and anyone who
 * knows an email address can lock that person out by failing five
 * logins — a denial-of-service handed to the attacker for free.
 *
 * So both, independently, and a request must satisfy both. The
 * per-account budget stops credential stuffing against one victim; the
 * per-IP budget stops one source sweeping many accounts. Neither can be
 * used to lock somebody out, because exhausting the account budget
 * requires already being rate-limited on the IP.
 *
 * A sliding window rather than a fixed one: a fixed window lets an
 * attacker send the full budget at 59s and again at 61s, which is twice
 * the intended rate at the moment it matters most.
 */

let redis: Redis | undefined;
const limiters = new Map<string, Ratelimit>();

function client(): Redis {
  const env = ratelimitEnv();
  redis ??= new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  return redis;
}

function limiter(name: string, tokens: number, windowSeconds: number): Ratelimit {
  const key = `${name}:${tokens}:${windowSeconds}`;
  let existing = limiters.get(key);
  if (!existing) {
    existing = new Ratelimit({
      redis: client(),
      limiter: Ratelimit.slidingWindow(tokens, `${windowSeconds} s`),
      prefix: `wms:rl:${name}`,
      analytics: false,
    });
    limiters.set(key, existing);
  }
  return existing;
}

export type LimitResult = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the budget refills. 0 when allowed. */
  retryAfter: number;
  /** Which budget refused — useful in the audit row. */
  scope?: "ip" | "account";
};

const ALLOWED: LimitResult = { allowed: true, remaining: -1, retryAfter: 0 };

async function check(
  name: string,
  identifier: string,
  tokens: number,
  windowSeconds: number,
  scope: "ip" | "account",
): Promise<LimitResult> {
  const result = await limiter(name, tokens, windowSeconds).limit(identifier);
  return {
    allowed: result.success,
    remaining: result.remaining,
    retryAfter: result.success ? 0 : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
    scope: result.success ? undefined : scope,
  };
}

/**
 * Login and other credential checks. Both budgets, evaluated together.
 *
 * `Promise.all` and not sequential: checking the IP first and returning
 * early would leave the account budget unconsumed, so an attacker
 * rotating IPs never spends it.
 */
export async function limitAuthAttempt(params: {
  ip?: string | null;
  /** Email or mobile as submitted, lowercased by the caller. */
  account?: string | null;
}): Promise<LimitResult> {
  const env = ratelimitEnv();
  if (!env.RATELIMIT_ENABLED) return ALLOWED;

  const checks: Array<Promise<LimitResult>> = [];
  if (params.ip) {
    checks.push(
      check("auth-ip", params.ip, env.RATELIMIT_AUTH_ATTEMPTS, env.RATELIMIT_AUTH_WINDOW, "ip"),
    );
  }
  if (params.account) {
    checks.push(
      check(
        "auth-account",
        params.account,
        env.RATELIMIT_AUTH_ATTEMPTS,
        env.RATELIMIT_AUTH_WINDOW,
        "account",
      ),
    );
  }
  if (checks.length === 0) return ALLOWED;

  const results = await Promise.all(checks);
  const refused = results.find((r) => !r.allowed);
  return refused ?? results.reduce((a, b) => (a.remaining <= b.remaining ? a : b));
}

/**
 * OTP sends, per account per day.
 *
 * Separate from the login budget because the cost is different: every
 * send spends real SMS credit, so the limit is a daily cap rather than a
 * per-minute one. The per-send cooldown lives in the database
 * (`resendCooldownRemaining`) so it survives a Redis eviction.
 */
export async function limitOtpSend(account: string): Promise<LimitResult> {
  const env = ratelimitEnv();
  if (!env.RATELIMIT_ENABLED) return ALLOWED;
  return check("otp-day", account, env.RATELIMIT_OTP_PER_DAY, 86_400, "account");
}

/**
 * Best-effort wrapper: if Upstash is unreachable, allow the request.
 *
 * FAIL OPEN, deliberately, and it is a real trade. Failing closed turns
 * a Redis blip into "nobody can log in" — an outage caused by the
 * defence rather than the attack. What survives an Upstash outage is
 * account lockout (`users.failed_login_count` / `locked_until`), which
 * lives in Postgres and is the control that actually stops credential
 * stuffing. The limiter is the cheap first line, not the last one.
 */
export async function limitOrAllow(
  run: () => Promise<LimitResult>,
): Promise<LimitResult & { degraded?: boolean }> {
  try {
    return await run();
  } catch {
    return { ...ALLOWED, degraded: true };
  }
}

/**
 * The caller's IP, from the proxy headers Vercel sets.
 *
 * `x-forwarded-for` is client-controlled on a server you host yourself,
 * so this is only trustworthy behind a proxy that overwrites it —
 * which Vercel does. The FIRST entry is the original client; taking the
 * last gives you the proxy and rate-limits your own edge.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? null;
}
