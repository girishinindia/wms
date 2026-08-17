import "server-only";

import { z } from "zod";

/**
 * Server environment, validated once.
 *
 * Two rules this file exists to enforce:
 *
 * 1. A missing or malformed variable fails with the variable's NAME, at
 *    the first request that needs it. The alternative is `undefined`
 *    travelling into a provider call and coming back as a 401 from
 *    Brevo three days later, which tells you nothing.
 *
 * 2. Validation is LAZY. `next build` imports every route module to read
 *    its config; validating at import time turns a missing key into a
 *    failed build rather than a readable error at runtime. That
 *    already happened once here with DATABASE_URL.
 *
 * `server-only` is the third guard: if this module is ever pulled into a
 * client component the build fails, instead of an API key ending up in a
 * browser bundle.
 */

/** Trim, and treat an empty string as absent — dotenv gives "" for `KEY=`. */
const str = z.string().trim().min(1);
const optionalStr = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const intFromStr = (fallback: number) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : Number(v)))
    .pipe(z.number().int());

const boolFromStr = (fallback: boolean) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) =>
      v === undefined || v === "" ? fallback : /^(1|true|yes|on)$/i.test(v),
    );

// ── Email (Brevo) ─────────────────────────────────────────────────
const emailSchema = z.object({
  BREVO_API_KEY: str.startsWith("xkeysib-", "Brevo keys start with xkeysib-"),
  EMAIL_FROM: str.email(),
  EMAIL_FROM_NAME: str,
  /** Where an admin copy goes. Falls back to EMAIL_ADMIN. */
  EMAIL_ADMIN_NOTIFY: optionalStr,
  EMAIL_ADMIN: optionalStr,
});

// ── SMS (SmsGatewayHub, DLT) ──────────────────────────────────────
const smsSchema = z.object({
  SMS_API_KEY: str,
  /** DLT-approved sender id. Exactly 6 characters for transactional. */
  SMS_SENDER_ID: str.length(6, "a DLT sender id is exactly 6 characters"),
  SMS_ENTITY_ID: str.regex(/^\d+$/, "the DLT entity id is numeric"),
  SMS_CHANNEL: intFromStr(2),
  SMS_DCS: intFromStr(0),
  SMS_FLASH: intFromStr(0),
  // SMS_ROUTE is deliberately absent. It is not part of the SendSMS
  // payload, and the value in .env is `clickhere` — a copy-paste from
  // the dashboard rather than a route number. Validating it would fail
  // the boot over a variable nothing reads.
  /**
   * Send for real in non-production. Off by default: a test run that
   * quietly spends live SMS credits is a bad default, and DLT rejections
   * cost reputation with the operator.
   */
  SMS_FORCE_SEND: boolFromStr(false),

  // The five DLT template ids are NOT here. They live in
  // wms.notification_template alongside the approved wording, because
  // the id and the text are one fact and splitting them across two
  // systems is how they drift. That is also the project's own recorded
  // decision, in .env under "REMOVED - do not re-add".
});

// ── OTP policy ────────────────────────────────────────────────────
const otpSchema = z.object({
  OTP_LENGTH: intFromStr(6).pipe(z.number().min(4).max(10)),
  OTP_TTL_SECONDS: intFromStr(600).pipe(z.number().min(60)),
  OTP_MAX_ATTEMPTS: intFromStr(5).pipe(z.number().min(1)),
  OTP_RESEND_COOLDOWN_SECONDS: intFromStr(60).pipe(z.number().min(0)),
  OTP_MAX_RESENDS_PER_DAY: intFromStr(10).pipe(z.number().min(1)),
  OTP_REQUIRE_BOTH_CHANNELS: boolFromStr(true),
});

/**
 * "7d", "30m", "60s" -> seconds. The .env uses this form throughout and
 * it is worth keeping: `AUTH_SESSION_ABSOLUTE_TTL=30d` says what it
 * means, where `2592000` invites a typo nobody spots.
 */
const durationSeconds = (fallback: number) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return fallback;
      const m = /^(\d+)\s*(s|m|h|d)?$/.exec(v);
      if (!m) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `must be a duration like 60s, 30m, 7d (got '${v}')`,
        });
        return z.NEVER;
      }
      const mult = { s: 1, m: 60, h: 3600, d: 86400 }[m[2] ?? "s"]!;
      return Number(m[1]) * mult;
    });

// ── Auth ──────────────────────────────────────────────────────────
const authSchema = z.object({
  /**
   * Mixed into every password hash as argon2's `secret`. It lives in the
   * environment, not the database — so a dumped `users` table alone
   * cannot be cracked offline. Rotating it invalidates every password,
   * which is why it is not something to change casually.
   */
  PASSWORD_PEPPER: str.min(32, "use at least 32 characters (openssl rand -base64 32)"),
  ARGON2_MEMORY_KIB: intFromStr(65536).pipe(z.number().min(19456)),
  ARGON2_TIME_COST: intFromStr(3).pipe(z.number().min(2)),
  ARGON2_PARALLELISM: intFromStr(4).pipe(z.number().min(1)),

  AUTH_COOKIE_NAME: z.string().trim().default("wms_session"),
  /**
   * MUST stay empty unless you genuinely serve the app from several
   * subdomains. Setting it widens the cookie to every sibling host —
   * including any staging or marketing site on the same domain.
   */
  AUTH_COOKIE_DOMAIN: z
    .string()
    .trim()
    .default("")
    .transform((v) => (v === "" ? undefined : v)),
  AUTH_SESSION_IDLE_TTL: durationSeconds(7 * 86400),
  AUTH_SESSION_ABSOLUTE_TTL: durationSeconds(30 * 86400),
});

// ── Rate limiting (Upstash) ───────────────────────────────────────
const ratelimitSchema = z.object({
  RATELIMIT_ENABLED: boolFromStr(true),
  /**
   * @upstash/ratelimit and @upstash/redis are HTTP clients. A
   * `rediss://` TCP url here will not work, and the failure looks like a
   * hang rather than a config error.
   */
  UPSTASH_REDIS_REST_URL: str.url().startsWith("https://", "must be the REST url, not rediss://"),
  UPSTASH_REDIS_REST_TOKEN: str,
  RATELIMIT_AUTH_ATTEMPTS: intFromStr(5).pipe(z.number().min(1)),
  RATELIMIT_AUTH_WINDOW: durationSeconds(60),
  RATELIMIT_OTP_PER_DAY: intFromStr(10).pipe(z.number().min(1)),
});

// ── reCAPTCHA v3 ──────────────────────────────────────────────────
const recaptchaSchema = z.object({
  RECAPTCHA_ENABLED: boolFromStr(false),
  RECAPTCHA_SECRET_KEY: optionalStr,
  NEXT_PUBLIC_RECAPTCHA_SITE_KEY: optionalStr,
  /**
   * v3 returns a score from 0.0 (almost certainly a bot) to 1.0. There
   * is no checkbox and no pass/fail — the threshold is a policy choice,
   * and its presence is what distinguishes v3 from v2 in this config.
   */
  RECAPTCHA_MIN_SCORE: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === "" ? 0.5 : Number(v)))
    .pipe(z.number().min(0).max(1)),
});

const appSchema = z.object({
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  NEXT_PUBLIC_APP_NAME: optionalStr,

  /**
   * The canonical origin, e.g. https://wms.geniusitens.com.
   *
   * Validated here rather than read raw off process.env at four call
   * sites, because a typo in it is invisible: the site keeps working and
   * only the links inside emails are wrong, which nobody notices until a
   * customer says the button did nothing.
   */
  NEXT_PUBLIC_APP_URL: optionalStr,

  /**
   * Injected by Vercel — the production domain attached to the project,
   * with no protocol. Used as the fallback so a deploy that forgets
   * NEXT_PUBLIC_APP_URL still builds correct links instead of localhost
   * ones. Not available to the browser bundle, which is fine: every
   * consumer of the absolute URL is server-side.
   */
  VERCEL_PROJECT_PRODUCTION_URL: optionalStr,
});

/**
 * Parse a slice of process.env and report every problem at once.
 *
 * Reporting one missing key per restart is how a five-minute fix turns
 * into five restarts.
 */
function parse<T extends z.ZodTypeAny>(schema: T, label: string): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (result.success) return result.data;

  const lines = result.error.issues.map((i) => {
    const key = i.path.join(".");
    const present = process.env[key] !== undefined;
    return `  ${key}: ${i.message}${present ? "" : " (not set)"}`;
  });
  throw new Error(
    `Invalid ${label} environment:\n${lines.join("\n")}\n\n` +
      `Values live in web-api/.env — Next reads .env.local and .env, ` +
      `never .env.example.`,
  );
}

/** Memoised so the schema runs once per process, not once per request. */
function once<T>(label: string, build: () => T): () => T {
  let value: T | undefined;
  let failure: Error | undefined;
  return () => {
    if (failure) throw failure;
    if (value === undefined) {
      try {
        value = build();
      } catch (error) {
        failure = error as Error;
        throw failure;
      }
    }
    return value;
  };
}

export const emailEnv = once("email", () => {
  const e = parse(emailSchema, "email");
  return { ...e, adminNotify: e.EMAIL_ADMIN_NOTIFY ?? e.EMAIL_ADMIN };
});

export const smsEnv = once("SMS", () => parse(smsSchema, "SMS"));

export const authEnv = once("auth", () => parse(authSchema, "auth"));
export const ratelimitEnv = once("rate limit", () => parse(ratelimitSchema, "rate limit"));

export const recaptchaEnv = once("reCAPTCHA", () => {
  const r = parse(recaptchaSchema, "reCAPTCHA");
  // Enabled without a secret key is the configuration that silently
  // rejects every real user, so it is refused outright rather than
  // discovered in production.
  if (r.RECAPTCHA_ENABLED && !r.RECAPTCHA_SECRET_KEY) {
    throw new Error(
      "RECAPTCHA_ENABLED is true but RECAPTCHA_SECRET_KEY is not set.\n" +
        "Set the secret key, or set RECAPTCHA_ENABLED=false.",
    );
  }
  return r;
});
export const otpEnv = once("OTP", () => parse(otpSchema, "OTP"));

export const appEnv = once("app", () => {
  const a = parse(appSchema, "app");
  return { ...a, appUrl: resolveAppUrl(a) };
});

/**
 * Work out the canonical origin, in the order that is hardest to get
 * wrong.
 *
 * The explicit variable wins. Failing that, Vercel's own production
 * domain, so the value tracks whatever domain is actually attached to
 * the project rather than a hostname pasted into the source. Only in
 * development does it fall back to localhost — a production build with
 * neither set is a configuration error worth stopping for, because the
 * alternative is emailing customers a link to the developer's laptop.
 */
function resolveAppUrl(a: z.infer<typeof appSchema>): string {
  const explicit = a.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return normaliseOrigin(explicit, "NEXT_PUBLIC_APP_URL");
  if (a.VERCEL_PROJECT_PRODUCTION_URL) {
    return normaliseOrigin(
      `https://${a.VERCEL_PROJECT_PRODUCTION_URL}`,
      "VERCEL_PROJECT_PRODUCTION_URL",
    );
  }
  if (a.APP_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set and APP_ENV is production.\n" +
        "Set it to the site's own origin, e.g. https://wms.geniusitens.com.\n" +
        "Without it, links inside emails and push notifications are relative " +
        "and therefore dead.",
    );
  }
  return "http://localhost:3000";
}

/** No trailing slash, so callers can join with `${origin}${path}`. */
function normaliseOrigin(value: string, key: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be an absolute URL, got: ${value}`);
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error(`${key} must use https outside local development, got: ${value}`);
  }
  return url.origin;
}

/** True in production, or when explicitly forced on elsewhere. */
export function shouldReallySend(): boolean {
  return appEnv().APP_ENV === "production" || smsEnv().SMS_FORCE_SEND;
}
