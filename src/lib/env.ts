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

const appSchema = z.object({
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  NEXT_PUBLIC_APP_NAME: optionalStr,
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
export const otpEnv = once("OTP", () => parse(otpSchema, "OTP"));
export const appEnv = once("app", () => parse(appSchema, "app"));

/** True in production, or when explicitly forced on elsewhere. */
export function shouldReallySend(): boolean {
  return appEnv().APP_ENV === "production" || smsEnv().SMS_FORCE_SEND;
}
