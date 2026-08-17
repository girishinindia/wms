import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";

// Extended `z`, imported first so `.openapi()` exists before any schema
// module below is evaluated. See lib/openapi/zod.ts.
import { z } from "@/lib/openapi/zod";

import {
  forgotPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/validation/auth";
import {
  forgotPasswordRequestSchema,
  loginRequestSchema,
  loginResponseSchema,
  okResponseSchema,
  otpSendRequestSchema,
  otpSendResponseSchema,
  otpStatusResponseSchema,
  otpVerifyRequestSchema,
  otpVerifyResponseSchema,
  registerDeviceRequestSchema,
  registerDeviceResponseSchema,
  registerRequestSchema,
  registerResponseSchema,
  resetPasswordRequestSchema,
  resetPasswordResponseSchema,
  sessionResponseSchema,
} from "@/lib/validation/api-auth";
import { errorSchema } from "@/lib/api/respond";

/**
 * The OpenAPI document, generated from the same Zod schemas the forms and
 * the route handlers use.
 *
 * The point of generating rather than hand-writing: a hand-written spec
 * drifts from the code within a sprint, and the Flutter client is built
 * from this document. A validation rule changed in
 * `src/lib/validation/auth.ts` shows up here, in Scalar, and in the
 * generated Dart client without anyone remembering to update three files.
 *
 * Only endpoints that actually exist are listed. A spec that documents
 * routes returning 404 is worse than no spec.
 */

const registry = new OpenAPIRegistry();

// ── Shared responses ──────────────────────────────────────────

const ErrorResponse = registry.register(
  "Error",
  z
    .object({
      status: z.literal("error"),
      code: z.string().nullable().openapi({ example: "ENOTFOUND" }),
      message: z.string().openapi({ example: "getaddrinfo ENOTFOUND …" }),
      hint: z.string().nullable(),
      timestamp: z.string().datetime(),
    })
    .openapi("Error")
);

// ── Health ────────────────────────────────────────────────────

const HealthResponse = registry.register(
  "Health",
  z
    .object({
      status: z.literal("ok"),
      service: z.string().openapi({ example: "wms-web-api" }),
      version: z.string().openapi({ example: "0.1.0" }),
      environment: z.string().openapi({ example: "production" }),
      region: z.string().openapi({ example: "bom1" }),
      commit: z.string().nullable().openapi({ example: "a1b2c3d" }),
      uptimeSeconds: z.number().int().openapi({ example: 3600 }),
      timestamp: z.string().datetime(),
    })
    .openapi("Health")
);

const DatabaseHealthResponse = registry.register(
  "DatabaseHealth",
  z
    .object({
      status: z.literal("ok"),
      latencyMs: z.number().int().openapi({ example: 14 }),
      database: z.string().openapi({ example: "postgres" }),
      user: z.string().openapi({ example: "postgres" }),
      server: z.string().openapi({ example: "PostgreSQL 17.4" }),
      serverTime: z.string(),
      pooler: z.string().openapi({ example: "transaction (6543)" }),
      timestamp: z.string().datetime(),
    })
    .openapi("DatabaseHealth")
);

const ApiIndexResponse = registry.register(
  "ApiIndex",
  z
    .object({
      name: z.string(),
      version: z.string().openapi({ example: "v1" }),
      status: z.string().openapi({ example: "scaffolded" }),
      documentation: z.string().openapi({ example: "/docs" }),
      endpoints: z.record(z.string()),
      timestamp: z.string().datetime(),
    })
    .openapi("ApiIndex")
);

registry.registerPath({
  method: "get",
  path: "/api/health",
  operationId: "getHealth",
  tags: ["Health"],
  summary: "Liveness probe",
  description:
    "Touches no database and no third party — it answers as long as the " +
    "process is up. This is the endpoint the uptime monitor polls. Use " +
    "`/api/health/db` when you need to know whether Postgres is reachable.",
  responses: {
    200: {
      description: "The service is running.",
      content: { "application/json": { schema: HealthResponse } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/health/db",
  operationId: "getDatabaseHealth",
  tags: ["Health"],
  summary: "Database readiness probe",
  description:
    "Runs a single read-only SELECT of session metadata through the " +
    "Supavisor pooler. No writes, no DDL — safe against production.",
  responses: {
    200: {
      description: "Postgres answered.",
      content: { "application/json": { schema: DatabaseHealthResponse } },
    },
    503: {
      description:
        "The database could not be reached, or the query failed. " +
        "`code` carries the driver error (`ENOTFOUND`, `28P01`, …) and " +
        "`hint` explains the usual cause.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1",
  operationId: "getApiIndex",
  tags: ["Meta"],
  summary: "API index",
  description: "Namespace index — lists the endpoints that currently exist.",
  responses: {
    200: {
      description: "The index.",
      content: { "application/json": { schema: ApiIndexResponse } },
    },
  },
});

// ── Browser form payloads ─────────────────────────────────────
//
// These describe the FORMS, which is not the same thing as the API: a
// form has confirmPassword and a terms checkbox, the API has a reCAPTCHA
// token and a platform. Registered as components only, so a client can
// see what the web forms collect without mistaking them for endpoints.

registry.register("SignInFormRequest", signInSchema.openapi("SignInFormRequest"));
registry.register("SignUpFormRequest", signUpSchema.openapi("SignUpFormRequest"));
registry.register(
  "ForgotPasswordFormRequest",
  forgotPasswordSchema.openapi("ForgotPasswordFormRequest")
);

// ── Auth endpoints ────────────────────────────────────────────

const ApiError = registry.register("ApiError", errorSchema.openapi("ApiError"));

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: ApiError } },
});

/**
 * Every auth path is public — that is what makes them the ones worth
 * rate-limiting. `security: []` states it rather than leaving a client
 * to guess from the absence of the field.
 */
const authPath = (config: {
  path: string;
  operationId: string;
  summary: string;
  description: string;
  request?: z.ZodTypeAny;
  response: z.ZodTypeAny;
  status?: number;
  method?: "post" | "get";
  responses?: Record<number, ReturnType<typeof errorResponse>>;
}) => {
  registry.registerPath({
    method: config.method ?? "post",
    path: config.path,
    operationId: config.operationId,
    tags: ["Auth"],
    summary: config.summary,
    description: config.description,
    security: [],
    ...(config.request
      ? {
          request: {
            body: {
              required: true,
              content: { "application/json": { schema: config.request } },
            },
          },
        }
      : {}),
    responses: {
      [config.status ?? 200]: {
        description: "Success.",
        content: { "application/json": { schema: config.response } },
      },
      422: errorResponse("The body failed validation. `error.fields` is keyed by field name."),
      429: errorResponse("Rate limited. `Retry-After` gives the wait in seconds."),
      ...(config.responses ?? {}),
    },
  });
};

authPath({
  path: "/api/v1/auth/register",
  operationId: "register",
  summary: "Register a new importer account",
  status: 201,
  description:
    "Creates the `users` row **and** the `importer` row together, then " +
    "sends a separate code to the email address and to the mobile " +
    "number.\n\nThe company name lives on `importer.company_name` — " +
    "there is no company field on `users`. The importer starts " +
    "incomplete: legal name, entity type and registered address arrive " +
    "with the KYC documents, and `importer_complete_before_active` " +
    "refuses to let the record leave PENDING until they do.\n\n" +
    "**Answers identically whether or not the address is already " +
    "registered.** A signup form that says \"this email is taken\" is a " +
    "free account enumerator.\n\n**No role is assigned here.** `IMPORTER` " +
    "is exclusive and immutable — once granted, not even a Super Admin " +
    "can change it — so it is attached in `/otp/verify`, after both " +
    "codes are proven.",
  request: registerRequestSchema,
  response: registerResponseSchema,
  responses: { 400: errorResponse("reCAPTCHA rejected the request.") },
});

authPath({
  path: "/api/v1/auth/otp/send",
  operationId: "sendOtp",
  summary: "Send or resend verification codes",
  description:
    "Issues a **separate** code per channel — email and SMS never share " +
    "a code, or compromising one channel would compromise the check.\n\n" +
    "Always answers `sent: true`, account or not. The per-send cooldown " +
    "is enforced in Postgres so it survives a Redis eviction; the daily " +
    "cap is in Upstash because every send spends real SMS credit.",
  request: otpSendRequestSchema,
  response: otpSendResponseSchema,
  responses: { 400: errorResponse("reCAPTCHA rejected the request.") },
});

authPath({
  path: "/api/v1/auth/otp/verify",
  operationId: "verifyOtp",
  summary: "Verify one or both codes",
  description:
    "Codes are single-use and consumed in the same statement that " +
    "validates them, so a replay cannot succeed and two concurrent " +
    "requests cannot both win.\n\nOn a completed **registration** this is " +
    "where the account becomes real: the user goes ACTIVE and the " +
    "`IMPORTER` role is attached to their importer record, in one " +
    "statement. It is also the point of no return — that role is " +
    "immutable — which is exactly why it waits for both codes. Every " +
    "Super Admin is then notified on IN_APP, EMAIL and PUSH, once per " +
    "importer ever: the dedupe key is the importer id, so a replayed " +
    "verify cannot produce a second alert. A failed notification never " +
    "fails the registration.\n\nOn a " +
    "completed **passwordRecovery** the response carries a short-lived " +
    "`resetToken`. That, not the OTP, is what `/password/reset` " +
    "consumes — the OTP is still sitting in the user's inbox and text " +
    "messages.",
  request: otpVerifyRequestSchema,
  response: otpVerifyResponseSchema,
  responses: {
    400: errorResponse("The code was wrong."),
    410: errorResponse("The code expired. Request a new one."),
  },
});

authPath({
  path: "/api/v1/auth/otp/status",
  operationId: "getOtpStatus",
  method: "get",
  summary: "Remaining resend cooldown",
  description:
    "What the verify screen needs to draw its countdown after a reload. " +
    "Without it the timer restarts at zero on refresh and the user " +
    "presses resend into a cooldown they cannot see.\n\nLeaks nothing: " +
    "an unknown identifier returns the configured defaults, which is " +
    "what a real account with no live code returns too.",
  response: otpStatusResponseSchema,
});

authPath({
  path: "/api/v1/auth/login",
  operationId: "login",
  summary: "Sign in with a password",
  description:
    "Password only — no OTP on everyday sign-in. Warehouse staff sign in " +
    "at the start of each shift, and a code per shift gets worked around " +
    "rather than tolerated. The weight is carried by argon2id, escalating " +
    "lockout, and per-IP **and** per-account rate limits.\n\nEvery " +
    "credential failure returns the same message in the same time, so the " +
    "endpoint cannot be used to discover which addresses are registered.\n\n" +
    "On success an httpOnly session cookie is set.\n\nWhen `platform` " +
    "is `ANDROID` or `IOS` the response ALSO carries `sessionToken`, for " +
    "`Authorization: Bearer`. A browser never receives it — returning the " +
    "session in JSON would defeat the httpOnly cookie it just set.",
  request: loginRequestSchema,
  response: loginResponseSchema,
  responses: {
    401: errorResponse("Wrong identifier or password."),
    403: errorResponse("The account is not active."),
    423: errorResponse("Locked after repeated failures. `Retry-After` gives the wait."),
  },
});

authPath({
  path: "/api/v1/auth/logout",
  operationId: "logout",
  summary: "Sign out",
  description:
    "Revokes the session row and clears the cookie. **Always succeeds**, " +
    "including for a token that was already dead — an error here reads as " +
    "\"you are still signed in\" on a shared terminal, which is the " +
    "opposite of what happened.",
  response: okResponseSchema,
});

authPath({
  path: "/api/v1/auth/session",
  operationId: "getSession",
  method: "get",
  summary: "The current user and their permissions",
  description:
    "Permissions come from `user_effective_permission`, which already " +
    "collapses every role the user holds to the widest scope per " +
    "permission and subtracts deny overrides — so the client gets one " +
    "flat list and never reasons about role precedence.\n\nReturns 401 " +
    "rather than an empty session: \"not signed in\" and \"signed in with " +
    "no permissions\" are different states.",
  response: sessionResponseSchema,
  responses: { 401: errorResponse("No valid session cookie.") },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/devices",
  operationId: "registerDevice",
  tags: ["Notifications"],
  summary: "Register this device for push",
  description:
    "Attaches an FCM registration token to the **authenticated caller** — " +
    "never to a user named in the body. A push token is a capability to " +
    "interrupt somebody's phone.\n\n`push_token` is unique across the " +
    "table, so a token always belongs to whoever signed in last. Two " +
    "people sharing one handset must not keep receiving each other's " +
    "notifications.\n\nWhen FCM reports `UNREGISTERED` the row is " +
    "deactivated rather than deleted: which device was notified is worth " +
    "keeping for the audit trail.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: registerDeviceRequestSchema } },
    },
  },
  responses: {
    201: {
      description: "Registered.",
      content: { "application/json": { schema: registerDeviceResponseSchema } },
    },
    401: errorResponse("No valid session."),
    422: errorResponse("The body failed validation."),
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/devices",
  operationId: "unregisterDevice",
  tags: ["Notifications"],
  summary: "Stop push to this device",
  description:
    "Deactivates the token, scoped to the caller — nobody can silence " +
    "somebody else's device. Call it on mobile sign-out.",
  responses: {
    200: {
      description: "Deactivated.",
      content: { "application/json": { schema: okResponseSchema } },
    },
    401: errorResponse("No valid session."),
    422: errorResponse("pushToken is required."),
  },
});

authPath({
  path: "/api/v1/auth/password/forgot",
  operationId: "forgotPassword",
  summary: "Begin a password reset",
  description:
    "Takes the email **and** the mobile, and they must belong to the " +
    "**same account**. Knowing somebody's email address is therefore not " +
    "enough to start a reset against them, and the codes go to two " +
    "channels an attacker would have to hold both of.\n\nAnswers " +
    "`ok: true` for every input, always, and takes the same time either " +
    "way. This is the classic enumeration endpoint: anything that " +
    "distinguishes \"we sent you a code\" from \"no such account\" turns " +
    "the login page into a directory of your customers.",
  request: forgotPasswordRequestSchema,
  response: okResponseSchema,
  responses: { 400: errorResponse("reCAPTCHA rejected the request.") },
});

authPath({
  path: "/api/v1/auth/password/reset",
  operationId: "resetPassword",
  summary: "Set a new password",
  description:
    "Consumes the `resetToken` from `/otp/verify`.\n\n**Every other " +
    "session is revoked.** If the reason somebody reset their password is " +
    "that someone else had it, leaving that session alive defeats the " +
    "entire exercise — the most common way a successful reset achieves " +
    "nothing.",
  request: resetPasswordRequestSchema,
  response: resetPasswordResponseSchema,
  responses: { 410: errorResponse("The reset ticket expired or was already used.") },
});

// ── Document ──────────────────────────────────────────────────

function servers() {
  const list: { url: string; description: string }[] = [
    { url: "https://wms.geniusitens.com", description: "Production" },
  ];

  if (process.env.NODE_ENV !== "production") {
    list.unshift({
      url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      description: "Local development",
    });
  }

  return list;
}

export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);

  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Genius WMS API",
      version: "0.1.0",
      description:
        "Warehouse management API for the Genius WMS portal and mobile " +
        "app.\n\nEverything here is generated from the Zod schemas in " +
        "`src/lib/validation` — the same objects the server validates " +
        "with, so the document cannot drift from the implementation.",
      contact: {
        name: "Genius ITens",
        url: "https://wms.geniusitens.com",
      },
    },
    servers: servers(),
    // Explicitly public. An empty array is not the same as omitting the
    // field: it states "no credentials required" instead of leaving the
    // client to guess. Every endpoint added after auth lands overrides
    // this with its own `security`.
    security: [],
    tags: [
      { name: "Health", description: "Liveness and readiness probes." },
      { name: "Meta", description: "Index and documentation." },
      {
        name: "Notifications",
        description:
          "Push device registration. Notification ROUTING is data, not " +
          "code — `wms.notification_rule` decides who hears about an " +
          "event and on which channels, so changing it is a row rather " +
          "than a deploy.",
      },
      {
        name: "Auth",
        description:
          "Registration, dual-channel OTP, sign-in and password reset. " +
          "Every endpoint here is public and therefore rate-limited by IP " +
          "and by account.",
      },
    ],
  });
}
