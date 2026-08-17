import { z } from "@/lib/openapi/zod";

/**
 * Request bodies for the auth API.
 *
 * Separate from `validation/auth.ts`, which describes the browser FORMS.
 * The two overlap but are not the same thing: a form has
 * `confirmPassword` and a `terms` checkbox, and the API has a reCAPTCHA
 * token and a platform. Collapsing them into one schema means every
 * mobile client has to send a `confirmPassword` it never collected.
 *
 * These are the schemas the OpenAPI document is generated from, so the
 * Flutter client is built from exactly what the server enforces.
 */

const TEN_DIGITS = /^\d{10}$/;
const ALPHA_ONLY = /^[A-Za-z]+$/;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .openapi({ example: "ops@acme.com" });

/** Ten digits. The +91 is a display prefix, never stored. */
const mobile = z
  .string()
  .trim()
  .regex(TEN_DIGITS, "Mobile number must be exactly 10 digits")
  .openapi({ example: "9876543210" });

const personName = (label: string) =>
  z
    .string()
    .trim()
    .min(2, `${label} must be at least 2 characters`)
    .max(20, `${label} must be at most 20 characters`)
    .regex(ALPHA_ONLY, `${label} must be letters only, with no spaces`);

/**
 * Minimum 8. Deliberately no "one uppercase, one symbol" rule: NIST
 * dropped composition rules years ago because they push people toward
 * `Password1!` and away from length, which is what actually helps.
 * Length plus argon2id plus lockout is the defence.
 */
const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(200, "Password must be at most 200 characters");

/** reCAPTCHA v3 token from grecaptcha.execute(). Optional so a native
 *  client, which has no browser to run it in, is not locked out. */
const captcha = z.string().optional().openapi({ description: "reCAPTCHA v3 token" });

const platform = z.enum(["WEB", "ANDROID", "IOS"]).optional();

export const otpPurposeSchema = z.enum([
  "registration",
  "passwordRecovery",
  "resetPassword",
  "updateEmail",
  "updateMobile",
]);

export const otpChannelSchema = z.enum(["EMAIL", "SMS"]);

// ── POST /api/v1/auth/register ────────────────────────────────────
export const registerRequestSchema = z
  .object({
    firstName: personName("First name"),
    lastName: personName("Last name"),
    companyName: z.string().trim().min(2).max(60),
    email,
    mobile,
    password,
    captchaToken: captcha,
  })
  .openapi("RegisterRequest");

export const registerResponseSchema = z
  .object({
    userId: z.number().int(),
    /** Both codes were dispatched. Verify each before signing in. */
    verificationRequired: z.literal(true),
    channels: z.array(otpChannelSchema),
    expiresInSeconds: z.number().int(),
    resendAfterSeconds: z.number().int(),
  })
  .openapi("RegisterResponse");

// ── POST /api/v1/auth/otp/send ────────────────────────────────────
export const otpSendRequestSchema = z
  .object({
    purpose: otpPurposeSchema,
    /** Email or 10-digit mobile — whichever the user has. */
    identifier: z.string().trim().min(1),
    channel: otpChannelSchema.optional(),
    captchaToken: captcha,
  })
  .openapi("OtpSendRequest");

// ── GET /api/v1/auth/otp/status ───────────────────────────────────
/**
 * What the verify screen needs to render its countdown after a refresh.
 * Without it the timer resets to zero on reload and the user hammers
 * "resend" into a cooldown they cannot see.
 */
export const otpStatusResponseSchema = z
  .object({
    resendAfterSeconds: z.number().int(),
    expiresInSeconds: z.number().int(),
    codeLength: z.number().int(),
    /** Same answer whether or not the account exists. */
    channels: z.array(otpChannelSchema),
  })
  .openapi("OtpStatusResponse");

export const otpSendResponseSchema = z
  .object({
    /** Always true, whether or not the account exists. See the handler. */
    sent: z.literal(true),
    channels: z.array(otpChannelSchema),
    expiresInSeconds: z.number().int(),
    resendAfterSeconds: z.number().int(),
  })
  .openapi("OtpSendResponse");

// ── POST /api/v1/auth/otp/verify ──────────────────────────────────
export const otpVerifyRequestSchema = z
  .object({
    purpose: otpPurposeSchema,
    identifier: z.string().trim().min(1),
    emailCode: z.string().trim().regex(/^\d{4,10}$/).optional(),
    smsCode: z.string().trim().regex(/^\d{4,10}$/).optional(),
  })
  .refine((v) => v.emailCode || v.smsCode, {
    message: "Provide the emailed code, the SMS code, or both",
    path: ["emailCode"],
  })
  .openapi("OtpVerifyRequest");

export const otpVerifyResponseSchema = z
  .object({
    emailVerified: z.boolean(),
    mobileVerified: z.boolean(),
    /** True once every channel this flow requires has been verified. */
    complete: z.boolean(),
    /** Registration only: the IMPORTER role was attached. */
    roleAssigned: z.boolean().optional(),
    /** Registration only: the new importer's customer-facing code. */
    importerCode: z.string().optional().openapi({ example: "IMP-0001" }),
    /** Present on a completed passwordRecovery: pass it to /password/reset. */
    resetToken: z.string().optional(),
  })
  .openapi("OtpVerifyResponse");

// ── POST /api/v1/auth/login ───────────────────────────────────────
export const loginRequestSchema = z
  .object({
    /** Email address or 10-digit mobile number. */
    identifier: z.string().trim().min(1).openapi({ example: "ops@acme.com" }),
    password: z.string().min(1, "Password is required"),
    captchaToken: captcha,
    platform,
    deviceName: z.string().trim().max(80).optional(),
  })
  .openapi("LoginRequest");

export const sessionUserSchema = z
  .object({
    id: z.number().int(),
    email: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    mobile: z.string(),
    emailVerified: z.boolean(),
    mobileVerified: z.boolean(),
    mustChangePassword: z.boolean(),
    roles: z.array(
      z.object({
        role: z.string(),
        domain: z.string(),
        warehouseId: z.number().int().nullable(),
        importerId: z.number().int().nullable(),
      }),
    ),
  })
  .openapi("SessionUser");

export const effectivePermissionSchema = z.object({
  permission: z.string(),
  scope: z.enum(["OWN", "WAREHOUSE", "ALL"]),
  warehouseIds: z.array(z.number().int()),
  importerIds: z.array(z.number().int()),
});

export const loginResponseSchema = z
  .object({
    user: sessionUserSchema,
    /**
     * The same flat list `/auth/session` returns, included here so a
     * client can decide where to land without a second round trip. The
     * sign-in form used to fetch the session after logging in, and that
     * extra call is where "signed in but nothing happened" came from
     * whenever the server was slow: it timed out and fell back to the
     * home page.
     */
    permissions: z.array(effectivePermissionSchema),
    expiresAt: z.string().datetime(),
    /**
     * Present ONLY when `platform` is ANDROID or IOS. A browser gets the
     * httpOnly cookie and nothing else — returning the same value in JSON
     * would defeat the cookie entirely.
     */
    sessionToken: z.string().optional().openapi({
      description:
        "Bearer token for native clients. Absent for platform WEB by design.",
    }),
  })
  .openapi("LoginResponse");

// ── GET /api/v1/auth/session ──────────────────────────────────────
export const sessionResponseSchema = z
  .object({
    user: sessionUserSchema,
    permissions: z.array(effectivePermissionSchema),
    expiresAt: z.string().datetime(),
  })
  .openapi("SessionResponse");

// ── POST /api/v1/auth/password/forgot ─────────────────────────────
/**
 * Both, not either.
 *
 * Requiring the email AND the mobile to belong to the SAME account means
 * knowing somebody's email address is not enough to start a reset
 * against them — and the codes then go to two channels an attacker would
 * have to hold both of.
 */
export const forgotPasswordRequestSchema = z
  .object({
    email,
    mobile,
    captchaToken: captcha,
  })
  .openapi("ForgotPasswordRequest");

// ── POST /api/v1/auth/password/reset ──────────────────────────────
export const resetPasswordRequestSchema = z
  .object({
    /** From a completed /otp/verify with purpose passwordRecovery. */
    resetToken: z.string().min(1),
    newPassword: password,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .openapi("ResetPasswordRequest");

export const resetPasswordResponseSchema = z
  .object({
    /** Every other session was killed. See the handler for why. */
    sessionsRevoked: z.number().int(),
  })
  .openapi("ResetPasswordResponse");

export const okResponseSchema = z.object({ ok: z.literal(true) }).openapi("OkResponse");

/** True when the value is a valid email; otherwise treated as a mobile. */
export function looksLikeEmail(value: string): boolean {
  return z.string().email().safeParse(value).success;
}

// ── POST /api/v1/devices ──────────────────────────────────────────
/**
 * A push token is a capability to interrupt somebody's phone, so it is
 * only ever attached to the authenticated caller — never taken from a
 * body field naming a user.
 */
export const registerDeviceRequestSchema = z
  .object({
    platform: z.enum(["ANDROID", "IOS", "WEB"]),
    pushToken: z.string().trim().min(20).max(4096),
    deviceModel: z.string().trim().max(80).optional(),
    osVersion: z.string().trim().max(40).optional(),
    appVersion: z.string().trim().max(40).optional(),
  })
  .openapi("RegisterDeviceRequest");

export const registerDeviceResponseSchema = z
  .object({ registered: z.literal(true), deviceId: z.number().int() })
  .openapi("RegisterDeviceResponse");
