import { z } from "zod";

/**
 * Auth validation schemas — the single source of truth.
 *
 * These are imported by the client forms (via zodResolver) and MUST be
 * imported by the server actions / route handlers too when auth is
 * wired up. Client-side validation is a convenience; it is trivially
 * bypassed. The same schema running on the server is the actual gate.
 *
 * Once @asteasolutions/zod-to-openapi is added, these also generate the
 * request bodies in the OpenAPI document that the Flutter client is
 * built from — so a rule changed here propagates everywhere.
 */

const ALPHA_ONLY = /^[A-Za-z]+$/;
const TEN_DIGITS = /^\d{10}$/;

/** First / last name: letters only, no spaces, 2–20 characters. */
const personName = (label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .min(2, `${label} must be at least 2 characters`)
    .max(20, `${label} must be at most 20 characters`)
    .regex(ALPHA_ONLY, `${label} must be letters only, with no spaces`);

/**
 * Exported so forms outside auth reuse the RULE rather than a copy.
 *
 * The contact form asks for the same two things sign-up does. A second
 * definition would be two rules that agree right up until one of them
 * is edited, and the one nobody remembers is the one that gets it
 * wrong.
 */
export const email = z
  .string({ required_error: "Email is required" })
  .trim()
  .min(1, "Email is required")
  .email("Enter a valid email address");

/** Exactly 10 digits. The +91 in the UI is a display prefix only. */
export const mobile = z
  .string({ required_error: "Mobile number is required" })
  .trim()
  .min(1, "Mobile number is required")
  .regex(TEN_DIGITS, "Mobile number must be exactly 10 digits");

const newPassword = z
  .string({ required_error: "Password is required" })
  .min(1, "Password is required")
  .min(8, "Password must be at least 8 characters");

/** True when the value is a valid email OR a 10-digit mobile number. */
const isEmailOrMobile = (value: string) =>
  z.string().email().safeParse(value).success || TEN_DIGITS.test(value);

// ── Sign in ───────────────────────────────────────────────────
export const signInSchema = z.object({
  identifier: z
    .string({ required_error: "Email or mobile number is required" })
    .trim()
    .min(1, "Email or mobile number is required")
    .refine(isEmailOrMobile, {
      message: "Enter a valid email address or a 10-digit mobile number",
    }),
  // Login only checks presence — length rules belong at registration.
  // Rejecting a short password here just tells an attacker it is wrong
  // before the credential check runs.
  password: z
    .string({ required_error: "Password is required" })
    .min(1, "Password is required"),
});

export type SignInValues = z.infer<typeof signInSchema>;

// ── Registration ──────────────────────────────────────────────
export const signUpSchema = z
  .object({
    firstName: personName("First name"),
    lastName: personName("Last name"),
    companyName: z
      .string({ required_error: "Company name is required" })
      .trim()
      .min(1, "Company name is required")
      .min(2, "Company name must be at least 2 characters")
      .max(60, "Company name must be at most 60 characters"),
    email,
    mobile,
    password: newPassword,
    confirmPassword: z
      .string({ required_error: "Please confirm your password" })
      .min(1, "Please confirm your password"),
    terms: z.literal(true, {
      errorMap: () => ({
        message: "You must accept the terms and conditions",
      }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type SignUpValues = z.infer<typeof signUpSchema>;

// ── Forgot password ───────────────────────────────────────────
export const forgotPasswordSchema = z.object({
  email,
  mobile,
});

export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
