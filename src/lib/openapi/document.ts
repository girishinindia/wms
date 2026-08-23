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
import {
  approveImporterRequestSchema,
  approveImporterResponseSchema,
  createImporterRequestSchema,
  createImporterResponseSchema,
  assignRoleRequestSchema,
  createCitiesRequestSchema,
  createCitiesResponseSchema,
  createUserRequestSchema,
  createUserResponseSchema,
  decideExpenseRequestSchema,
  receiptListResponseSchema,
  receiptResponseSchema,
  okAdminResponseSchema,
  rejectImporterRequestSchema,
  revokeRoleRequestSchema,
  setUserStatusRequestSchema,
  updateCityRequestSchema,
  updateImporterRequestSchema,
} from "@/lib/validation/api-admin";
import {
  importerProfilePatchSchema,
  importerProfileResponseSchema,
  salesAgentCreateSchema,
  salesAgentSchema,
  salesAgentUpdateSchema,
} from "@/lib/validation/api-importer";
import {
  createWarehouseSchema,
  updateWarehouseSchema,
  warehouseImageListSchema,
  warehouseImageSchema,
  warehouseResponseSchema,
} from "@/lib/validation/api-warehouse";
import { GALLERY_LIMITS } from "@/lib/images/webp";
import { errorSchema } from "@/lib/api/respond";
import { appEnv } from "@/lib/env";

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

/**
 * How an authenticated call proves who it is.
 *
 * Two schemes because there are genuinely two clients. A browser holds
 * an httpOnly cookie it cannot read, which is the point — script that
 * cannot read the session cannot exfiltrate it. A native client has no
 * XSS surface for that to protect against and no cookie jar worth
 * having, so it carries a bearer token in the Keychain instead.
 *
 * Registered together with `security: [{cookieAuth}, {bearerAuth}]`,
 * which in OpenAPI means "either one", not "both".
 */
registry.registerComponent("securitySchemes", "cookieAuth", {
  type: "apiKey",
  in: "cookie",
  name: "wms_session",
  description:
    "Set by `/api/v1/auth/login` for `platform: WEB`. httpOnly, SameSite=Lax, " +
    "host-only — the cookie is never widened to the parent domain, so a " +
    "sibling subdomain cannot see it.",
});

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  description:
    "The `sessionToken` returned by `/api/v1/auth/login` when `platform` " +
    "is ANDROID or IOS. A browser never receives one.",
});

const AUTHENTICATED: Record<string, string[]>[] = [
  { cookieAuth: [] },
  { bearerAuth: [] },
];

/**
 * An admin path: authenticated, permission-checked, and audited.
 *
 * The `permission` given here is not decoration — it is the exact key
 * `requirePermission` looks for in `wms.user_effective_permission`, so
 * the document says precisely what a caller needs rather than "you must
 * be an admin", which is never quite what any of these mean.
 */
const adminPath = (config: {
  path: string;
  operationId: string;
  summary: string;
  description: string;
  permission: string;
  method?: "post" | "get" | "patch" | "delete";
  request?: z.ZodTypeAny;
  response: z.ZodTypeAny;
  status?: number;
  params?: z.AnyZodObject;
  responses?: Record<number, ReturnType<typeof errorResponse>>;
}) => {
  registry.registerPath({
    method: config.method ?? "post",
    path: config.path,
    operationId: config.operationId,
    tags: ["Admin"],
    summary: config.summary,
    description:
      `${config.description}\n\n**Requires** \`${config.permission}\`. ` +
      "A refusal is a 403 and writes a `DENIED` row to `wms.audit_log` — " +
      "the successful actions can never tell you who tried.",
    security: AUTHENTICATED,
    request: {
      ...(config.params ? { params: config.params } : {}),
      ...(config.request
        ? {
            body: {
              required: true,
              content: { "application/json": { schema: config.request } },
            },
          }
        : {}),
    },
    responses: {
      [config.status ?? 200]: {
        description: "Success.",
        content: { "application/json": { schema: config.response } },
      },
      401: errorResponse("No session. Sign in."),
      403: errorResponse("Signed in, but not holding the permission at a covering scope."),
      422: errorResponse("The body failed validation. `error.fields` is keyed by field name."),
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

// ── Admin ─────────────────────────────────────────────────────

const idParam = z.object({ id: z.string().openapi({ example: "12" }) });

adminPath({
  path: "/api/v1/admin/cities",
  operationId: "createCities",
  summary: "Add cities to a state",
  permission: "master.city.create",
  status: 201,
  description:
    "Takes a list, not a name. `wms.city` ships empty and every address " +
    "in the system resolves to it — an importer cannot be approved and a " +
    "warehouse cannot be created without one — so the first call is " +
    "always a paste of thirty, never one.\n\nDuplicates are skipped " +
    "against the `(state_id, name)` unique index rather than failing the " +
    "batch, and the response names what was skipped: quietly creating " +
    "twenty-eight rows from a list of thirty is how a missing city " +
    "becomes a mystery.",
  request: createCitiesRequestSchema,
  response: createCitiesResponseSchema,
  responses: { 404: errorResponse("No such state.") },
});

adminPath({
  path: "/api/v1/admin/cities/{id}",
  operationId: "updateCity",
  method: "patch",
  summary: "Rename a city, or take it out of use",
  permission: "master.city.update",
  description:
    "There is no delete. Four tables hold a foreign key to `city`, so " +
    "removing a row either fails or orphans an address that was correct " +
    "when it was entered. `isActive: false` takes it out of the pickers " +
    "and leaves history intact.",
  params: idParam,
  request: updateCityRequestSchema,
  response: okAdminResponseSchema,
  responses: {
    404: errorResponse("No such city."),
    409: errorResponse("That state already has a city with this name."),
  },
});

const masterResourceParam = z.object({
  resource: z
    .enum(["countries", "states", "cities", "warehouse-types", "vehicle-types"])
    .openapi({ example: "vehicle-types" }),
});

adminPath({
  path: "/api/v1/admin/master/{resource}",
  operationId: "createMasterRow",
  summary: "Add a row to a master table",
  permission: "master.<resource>.create",
  status: 201,
  description:
    "One endpoint for five tables — countries, states, cities, warehouse " +
    "types and vehicle types. The `resource` segment selects an entry from a " +
    "frozen whitelist in `master-registry.ts`; anything not a key in it " +
    "is a 404 before any SQL is composed, so the table and column names " +
    "are always literals from that file and never from the request.\n\n" +
    "The body is validated against that entry's schema, which mirrors " +
    "the table's own constraints: `vehicle_type.category` accepts " +
    "exactly the six values its CHECK allows, and the fixed-width `char` " +
    "columns on `country` are trimmed and upper-cased, because a padded " +
    "`\"IN \"` never matches an `\"IN\"` again.\n\nCities also have a " +
    "bulk-paste endpoint at `/admin/cities` for adding many at once; " +
    "this one adds one.",
  params: masterResourceParam,
  request: z.record(z.unknown()).openapi("MasterRowRequest"),
  response: z.object({ id: z.number().int() }).openapi("MasterRowResponse"),
  responses: {
    404: errorResponse("No such master table."),
    409: errorResponse("A row with that code already exists."),
  },
});

adminPath({
  path: "/api/v1/admin/master/{resource}",
  operationId: "updateMasterRow",
  method: "patch",
  summary: "Edit a master row, or switch it off",
  permission: "master.<resource>.update",
  description:
    "Takes `?id=`. A partial body: only the fields present are written; " +
    "the parent key (`countryId`, `stateId`) may be included to move a " +
    "row.\n\nSwitching a row off is refused with a 409 the first time " +
    "if anything still points at it, naming the count. Repeat with " +
    "`?force=true` to go ahead — the existing references keep resolving; " +
    "what changes is that the row leaves every picker.",
  params: masterResourceParam,
  request: z.record(z.unknown()).openapi("MasterRowUpdateRequest"),
  response: okAdminResponseSchema,
  responses: {
    404: errorResponse("No such master table, or no such row."),
    409: errorResponse("Still in use, or the new code is taken."),
  },
});

adminPath({
  path: "/api/v1/admin/master/{resource}",
  operationId: "deleteMasterRow",
  method: "delete",
  summary: "Delete a master row that nothing points at",
  permission: "master.<resource>.delete",
  description:
    "Takes `?id=`. Removes the row outright — not a soft delete, because " +
    "the unique keys on these tables are plain rather than partial on " +
    "`deleted_at`, so a soft-deleted row would keep its code for good " +
    "and re-adding it would fail against a row nobody can see. The audit " +
    "row carries the deleted values.\n\nRefused with a 409 while anything " +
    "still references the row, naming what does (\"3 cities, 1 " +
    "warehouse\"). Every foreign key into these tables is `NO ACTION`, so " +
    "the database would refuse too; this answers first, in words. Switch " +
    "the row off instead when it is in use.",
  params: masterResourceParam,
  response: okAdminResponseSchema,
  responses: {
    404: errorResponse("No such master table, or no such row."),
    409: errorResponse("Still in use."),
  },
});

adminPath({
  path: "/api/v1/admin/master/{resource}/bulk",
  operationId: "bulkMasterRows",
  summary: "Activate, deactivate or delete many rows at once",
  permission: "master.<resource>.update, or .delete for action=delete",
  description:
    "`{ action: 'activate' | 'deactivate' | 'delete', ids: number[] }`, " +
    "up to 200 ids. Handled row by row so one refusal does not fail the " +
    "rest: the response lists `done`, `skipped` (with a reason — not " +
    "found, or in use by what) and `notes` (deactivated rows that are " +
    "still referenced). Each row is audited individually.",
  params: masterResourceParam,
  request: z
    .object({
      action: z.enum(["activate", "deactivate", "delete"]),
      ids: z.array(z.number().int().positive()).min(1).max(200),
    })
    .openapi("MasterBulkRequest"),
  response: z
    .object({
      action: z.string(),
      done: z.array(z.number().int()),
      skipped: z.array(z.object({ id: z.number().int(), reason: z.string() })),
      notes: z.array(z.object({ id: z.number().int(), note: z.string() })),
    })
    .openapi("MasterBulkResponse"),
  responses: { 404: errorResponse("No such master table.") },
});

adminPath({
  path: "/api/v1/admin/importers",
  operationId: "createImporter",
  summary: "Create an importer from the admin side",
  permission: "importer.create",
  description:
    "The counter version of self-registration, for a customer who signed " +
    "up by phone. Company name and a contact are the only required " +
    "fields; supply the KYC fields as well and `verifyNow` puts the row " +
    "straight to ACTIVE / VERIFIED, otherwise it lands PENDING and the " +
    "importer completes their own profile.\n\nCompany, login and role " +
    "binding are written in ONE statement, so a duplicate leaves nothing " +
    "behind. With `createLogin` the contact gets a users row with " +
    "`must_change_password`, and the temporary password is emailed AND " +
    "returned once — it is never stored in readable form. " +
    "`origin` is recorded as CREATED_BY_ADMIN.",
  request: createImporterRequestSchema,
  response: createImporterResponseSchema,
  status: 201,
  responses: {
    409: errorResponse("Company name, GSTIN, PAN, email or mobile already registered."),
  },
});

adminPath({
  path: "/api/v1/admin/importers/{id}",
  operationId: "updateImporter",
  method: "patch",
  summary: "Correct an importer's record",
  permission: "importer.update",
  description:
    "Any subset of the company's own fields, at any status. The " +
    "counterpart to `PATCH /importer/me`, and deliberately a separate " +
    "route: the importer's own endpoint locks legal name, entity type, " +
    "GSTIN and PAN once verified and tells them to ask the warehouse — " +
    "which are exactly the fields this exists to fix.\n\nOnly an " +
    "ALL-scoped grant qualifies; an importer's OWN-scoped " +
    "`importer.update` is refused here. A field sent empty is cleared, " +
    "except the four the database will not accept null (company name, " +
    "contact person, email, mobile). On a company that is no longer " +
    "PENDING the reply names any required field the edit would empty, " +
    "rather than letting `importer_complete_before_active` answer for " +
    "it. Status, KYC state and credit terms are not touched here — " +
    "approve, reject and lifecycle own those.",
  params: idParam,
  request: updateImporterRequestSchema,
  response: importerProfileResponseSchema,
  responses: {
    404: errorResponse("No such importer."),
    409: errorResponse("Company name, GSTIN or PAN already registered to another importer."),
  },
});

adminPath({
  path: "/api/v1/admin/importers/{id}/approve",
  operationId: "approveImporter",
  summary: "Complete the KYC details and activate an importer",
  permission: "importer.approve",
  description:
    "Approval is a form, not a button, and the database is what says so. " +
    "`importer_complete_before_active` permits an incomplete row only " +
    "while it is PENDING, so `legalName`, `entityType`, `address`, " +
    "`cityId` and `pincode` all have to arrive here — sign-up " +
    "deliberately collects none of them, because asking a stranger for a " +
    "registered address before they have an account loses the " +
    "registration.\n\nThe update is guarded on `status = 'PENDING'`, so a " +
    "double submission reports a conflict instead of overwriting the " +
    "first decision and notifying the applicant twice. On success " +
    "`importer.approved` is announced on IN_APP and EMAIL; a failure to " +
    "notify never rolls back the approval.",
  params: idParam,
  request: approveImporterRequestSchema,
  response: approveImporterResponseSchema,
  responses: {
    404: errorResponse("No such importer."),
    409: errorResponse("Already approved, rejected or suspended."),
  },
});

adminPath({
  path: "/api/v1/admin/importers/{id}/reject",
  operationId: "rejectImporter",
  summary: "Refuse a registration, with a reason",
  permission: "importer.approve",
  description:
    "The reason is required by the request schema, by the table's own " +
    "`status <> 'REJECTED' or rejection_reason is not null` check, and by " +
    "the audit helper. It is also the text the applicant receives, so it " +
    "is written for them to read.\n\nThe account is left signed-in-able " +
    "on purpose: the IMPORTER role is immutable and cannot be revoked by " +
    "anyone, and a rejection is usually fixable paperwork.",
  params: idParam,
  request: rejectImporterRequestSchema,
  response: okAdminResponseSchema,
  responses: {
    404: errorResponse("No such importer."),
    409: errorResponse("Already decided."),
  },
});

adminPath({
  path: "/api/v1/admin/expenses/{id}/approve",
  operationId: "decideExpense",
  summary: "Approve or reject an expense",
  permission: "expense.approve",
  description:
    "One endpoint for both answers, because they are one decision.\n\n" +
    "`expense.approve` is held by the super admin and nobody else, and " +
    "that is also what makes a super admin's own entry approved on " +
    "arrival: the create route auto-approves an author who holds this " +
    "permission, so the two can never disagree about who is exempt.\n\n" +
    "A rejection requires a note. A decision cannot be undone back to " +
    "PENDING — changing your mind means deciding again the other way, " +
    "and both decisions are in `wms.audit_log`.",
  params: idParam,
  request: decideExpenseRequestSchema,
  response: okAdminResponseSchema,
  responses: {
    404: errorResponse("No such expense."),
    409: errorResponse("It already carries that decision."),
  },
});

adminPath({
  path: "/api/v1/admin/expenses/{id}/receipts",
  operationId: "listExpenseReceipts",
  method: "get",
  summary: "The bills attached to an expense",
  permission: "expense.read",
  description:
    "A warehouse-scoped reader may only list receipts on an expense at " +
    "one of their own sites — the site is a property of the row, so it " +
    "is checked against the row rather than against the request.",
  params: idParam,
  response: receiptListResponseSchema,
  responses: { 404: errorResponse("No such expense.") },
});

adminPath({
  path: "/api/v1/admin/users",
  operationId: "createUser",
  summary: "Add a member of staff",
  permission: "user.create",
  status: 201,
  description:
    "Creates the login and binds its first role in one statement, so an " +
    "account can never exist without the role it was created for.\n\n" +
    "Who may create whom comes from `wms.role_creation_rule` read against " +
    "the CALLER's own live assignments: a SUPER_ADMIN may create anyone " +
    "anywhere; a WAREHOUSE_ADMIN may create the warehouse roles for a " +
    "site they are themselves assigned to, and cannot create another " +
    "WAREHOUSE_ADMIN, a SUPER_ADMIN, or anyone at a site that is not " +
    "theirs. IMPORTER and SALES_AGENT are never created here — they " +
    "belong to a company record and arrive with it.\n\n" +
    "`temporaryPassword` is returned **once**, in this response, and is " +
    "stored nowhere readable: `must_change_password` is set, so the " +
    "holder is stopped at a change-password screen on first sign-in. It " +
    "is also emailed to them directly; the notification that tells the " +
    "super admins deliberately does not carry it, because `announce` " +
    "persists what it renders.",
  request: createUserRequestSchema,
  response: createUserResponseSchema,
  responses: {
    409: errorResponse("That email address or mobile number is already in use."),
  },
});

adminPath({
  path: "/api/v1/admin/users/{id}/roles",
  operationId: "assignRole",
  summary: "Grant a role",
  permission: "role.assign",
  status: 201,
  description:
    "What may be granted comes from `wms.role_creation_rule`, not from " +
    "this endpoint: a SUPER_ADMIN may grant most things anywhere, a " +
    "WAREHOUSE_ADMIN only within its own warehouses, and SALES_AGENT is " +
    "grantable by an IMPORTER and by nobody else. A role whose domain is " +
    "WAREHOUSE requires `warehouseId` and refuses `importerId`, and vice " +
    "versa — enforced by a CHECK on the table.\n\nTwo triggers can still " +
    "refuse after all that: an exclusive role cannot sit beside another, " +
    "and a super admin's own assignment is theirs alone to change. Both " +
    "come back as a readable message rather than a 500.",
  params: idParam,
  request: assignRoleRequestSchema,
  response: okAdminResponseSchema,
  responses: {
    404: errorResponse("No such user."),
    409: errorResponse("Already held, or conflicts with an exclusive role."),
  },
});

adminPath({
  path: "/api/v1/admin/users/{id}/roles",
  operationId: "revokeRole",
  method: "delete",
  summary: "Revoke a role, with a reason",
  permission: "role.assign",
  description:
    "A revoke, not a delete: `revoked_at` plus a reason is the record of " +
    "who removed what and why, and the unique index is partial on " +
    "`revoked_at is null` so the same role can be granted again " +
    "afterwards.\n\nIMPORTER and SALES_AGENT cannot be revoked at all — " +
    "`ura_protect_immutable` blocks UPDATE and DELETE on them for " +
    "everyone, including a super admin at a psql prompt. Suspend the " +
    "account instead.",
  params: idParam,
  request: revokeRoleRequestSchema,
  response: okAdminResponseSchema,
  responses: { 404: errorResponse("That assignment is not active.") },
});

adminPath({
  path: "/api/v1/admin/users/{id}",
  operationId: "deleteUser",
  method: "delete",
  summary: "Delete a login (soft), and what it owns",
  permission: "user.delete",
  description:
    "Soft-deletes the account and revokes its sessions. An IMPORTER's " +
    "company and its sales agents go with it; a SALES_AGENT's profile " +
    "goes with it (one life-cycle, `lifecycle.ts`). A super admin, and " +
    "your own account, cannot be deleted here.",
  params: idParam,
  response: okAdminResponseSchema,
  responses: { 404: errorResponse("No such user."), 409: errorResponse("That is your own account.") },
});

adminPath({
  path: "/api/v1/admin/users/bulk",
  operationId: "bulkUsers",
  summary: "Activate, deactivate or delete several logins",
  permission: "user.update",
  description:
    "Each one cascades exactly like the single-row endpoints. Super " +
    "admins and the caller's own account are skipped with a reason, never " +
    "refused as a whole. Delete needs `user.delete`.",
  request: z
    .object({
      action: z.enum(["activate", "deactivate", "delete"]),
      ids: z.array(z.number().int().positive()).min(1).max(200),
      reason: z.string().max(300).optional(),
    })
    .openapi("UserBulkRequest"),
  response: z
    .object({
      action: z.string(),
      done: z.array(z.number().int()),
      skipped: z.array(z.object({ id: z.number().int(), reason: z.string() })),
      notes: z.array(z.object({ id: z.number().int(), note: z.string() })),
    })
    .openapi("UserBulkResponse"),
});

adminPath({
  path: "/api/v1/admin/importers/{id}/lifecycle",
  operationId: "importerLifecycle",
  summary: "Suspend, reactivate or delete a company",
  permission: "importer.update",
  description:
    "The owner login, every sales agent and their logins follow. Only an " +
    "ACTIVE company can be suspended (an unverified one stays PENDING with " +
    "its owner's login suspended). Delete needs `importer.delete`; the " +
    "importer's own OWN-scoped grant is refused.",
  params: idParam,
  request: z
    .object({
      action: z.enum(["suspend", "reactivate", "delete"]),
      reason: z.string().min(3).max(300).optional(),
    })
    .openapi("ImporterLifecycleRequest"),
  response: okAdminResponseSchema,
  responses: { 404: errorResponse("No such importer."), 409: errorResponse("Not in a state that allows this action.") },
});

adminPath({
  path: "/api/v1/admin/users/{id}/profile",
  operationId: "adminEditUserName",
  method: "patch",
  summary: "Correct a user's name",
  permission: "user.update",
  description:
    "Name only. Email, mobile and password change exclusively through the " +
    "owner's own verified flows — an admin cannot set them for anyone.",
  params: idParam,
  request: z
    .object({ firstName: z.string().optional(), lastName: z.string().optional() })
    .openapi("AdminUserNamePatch"),
  response: okAdminResponseSchema,
  responses: { 404: errorResponse("No such user.") },
});

adminPath({
  path: "/api/v1/admin/users/{id}/status",
  operationId: "setUserStatus",
  method: "patch",
  summary: "Suspend or reinstate an account",
  permission: "user.update",
  description:
    "Suspending revokes every live session as well as setting the " +
    "column. `resolveSession` already requires `status = 'ACTIVE'`, so " +
    "the sessions would stop resolving anyway — revoking explicitly " +
    "leaves a row saying when and why.\n\nA super admin cannot be " +
    "suspended by anyone else; `protect_super_admin` enforces it in the " +
    "database, not just here.",
  params: idParam,
  request: setUserStatusRequestSchema,
  response: okAdminResponseSchema,
  responses: { 404: errorResponse("No such user.") },
});

// ── Warehouses ────────────────────────────────────────────────────
//
// Every one of these refuses a WAREHOUSE-scoped grant, which is the
// unusual part and the reason they are not just another master table.
// Seven roles hold `warehouse.read` over the site they work at; none of
// them may add, edit or retire one. Only a grant at ALL scope — a super
// admin's — gets through `requirePlatformWarehouse`.

adminPath({
  path: "/api/v1/admin/warehouses",
  operationId: "createWarehouse",
  summary: "Add a warehouse",
  permission: "warehouse.create at ALL scope",
  status: 201,
  description:
    "`code` is not accepted from the request. The column defaults to " +
    "`WH-0001` from `warehouse_code_seq`, the way importers and sales " +
    "agents already get theirs — a hand-typed value in a NOT NULL UNIQUE " +
    "column is a collision waiting for two people to add a warehouse on " +
    "the same afternoon.\n\n`usableAreaSqft <= totalAreaSqft` is a CHECK " +
    "on the table and is answered here first, with the field named, so " +
    "the database never has to say it. `gmapUrl` is restricted to " +
    "`http(s)` — the value is rendered as an anchor, and an unchecked " +
    "string there is a stored redirect.",
  request: createWarehouseSchema,
  response: warehouseResponseSchema,
  responses: { 409: errorResponse("A warehouse with that name already exists.") },
});

adminPath({
  path: "/api/v1/admin/warehouses/{id}",
  operationId: "updateWarehouse",
  method: "patch",
  summary: "Correct a warehouse",
  permission: "warehouse.update at ALL scope",
  description:
    "Any subset of the same fields. The booleans carry no default here — " +
    "a `.default()` on a PATCH schema is non-optional, which would " +
    "quietly reset every facility checkbox the form did not send. `code` " +
    "and the soft-delete columns are not editable.",
  params: idParam,
  request: updateWarehouseSchema,
  response: okAdminResponseSchema,
  responses: {
    404: errorResponse("No such warehouse."),
    409: errorResponse("Another warehouse already has that name."),
  },
});

adminPath({
  path: "/api/v1/admin/warehouses/{id}",
  operationId: "deleteWarehouse",
  method: "delete",
  summary: "Retire a warehouse, with a reason",
  permission: "warehouse.delete at ALL scope",
  description:
    "Soft, and refused while anybody is still posted there: a warehouse " +
    "is not a master row, staff and transporters are attached to it, and " +
    "removing one out from under a live role assignment takes away " +
    "somebody's access rather than tidying a list. The reply names what " +
    "is still attached.\n\nIts gallery photos are deleted for good, " +
    "files and rows both — an object nothing can reach is an object " +
    "nobody stops paying for.",
  params: idParam,
  request: z
    .object({ reason: z.string().min(3).max(300) })
    .openapi("DeleteWarehouseRequest"),
  response: okAdminResponseSchema,
  responses: {
    404: errorResponse("No such warehouse."),
    409: errorResponse("Staff or transporters are still attached to it."),
  },
});

adminPath({
  path: "/api/v1/admin/warehouses/{id}/images",
  operationId: "listWarehouseImages",
  method: "get",
  summary: "One warehouse's gallery",
  permission: "warehouse.read at ALL scope",
  description:
    "Photographs belong to a site, so there is no all-photos view. " +
    "Ordered by `sort_order` then id. The storage key is deliberately " +
    "not returned — the CDN URL is what a client needs, and the key is " +
    "what a client could use to guess at neighbouring objects.",
  params: idParam,
  response: warehouseImageListSchema,
  responses: { 404: errorResponse("No such warehouse.") },
});

// The upload is registered by hand: like the profile photo, its request
// body is the image itself rather than JSON.
registry.registerPath({
  method: "post",
  path: "/api/v1/admin/warehouses/{id}/images",
  operationId: "addWarehouseImage",
  tags: ["Admin"],
  summary: "Add a photo to a warehouse's gallery",
  security: AUTHENTICATED,
  description:
    `The body is the image itself — \`image/webp\`, at most ` +
    `${Math.round(GALLERY_LIMITS.maxBytes / 1024)} KB and ` +
    `${GALLERY_LIMITS.maxEdge}px on its longest side. The browser ` +
    "resizes and re-encodes before sending: a phone photo is four " +
    "megabytes over the slowest part of the path, and what a gallery " +
    "needs is a hundred kilobytes.\n\nThe server reads the actual " +
    "RIFF/WEBP header rather than believing the content-type, stores the " +
    "object under `wms/gallery/<warehouseId>/`, and only then inserts " +
    "the row — an insert that fails takes the just-uploaded object with " +
    "it.\n\n**Requires** `warehouse.update` at ALL scope.",
  request: {
    params: idParam,
    body: {
      required: true,
      content: { "image/webp": { schema: { type: "string", format: "binary" } } },
    },
  },
  responses: {
    201: { description: "Stored.", content: { "application/json": { schema: warehouseImageSchema } } },
    401: errorResponse("No session. Sign in."),
    403: errorResponse("Signed in, but not holding the permission at ALL scope."),
    404: errorResponse("No such warehouse."),
    409: errorResponse("Photo storage is not configured on this environment."),
    422: errorResponse("Not a WebP, too large, or larger than the gallery limit."),
  },
});

adminPath({
  path: "/api/v1/admin/warehouses/{id}/images/{imageId}",
  operationId: "deleteWarehouseImage",
  method: "delete",
  summary: "Remove a photo from a gallery",
  permission: "warehouse.update at ALL scope",
  description:
    "Takes the file off storage first and then the row out of the table, " +
    "so a failure leaves a row pointing at nothing rather than an object " +
    "nothing points at. Both ids are in the WHERE clause: a photo id " +
    "belonging to another warehouse matches nothing instead of being " +
    "deleted from under it.",
  params: z.object({
    id: z.string().openapi({ example: "12" }),
    imageId: z.string().openapi({ example: "34" }),
  }),
  response: okAdminResponseSchema,
  responses: { 404: errorResponse("No such photo on that warehouse.") },
});

// The receipt upload is registered by hand for the same reason the
// gallery upload is: the request body is the file, not JSON. Two content
// types here rather than one — half the bills in a warehouse arrive as a
// phone snap and half as an emailed PDF.
registry.registerPath({
  method: "post",
  path: "/api/v1/admin/expenses/{id}/receipts",
  operationId: "addExpenseReceipt",
  tags: ["Admin"],
  summary: "Attach a bill to an expense",
  security: AUTHENTICATED,
  description:
    "The body is the file itself: `image/webp` (the browser resizes and " +
    "re-encodes a photo before sending, so the four megabytes never " +
    "cross the network) or `application/pdf` up to 5 MB.\n\nThe server " +
    "reads the real RIFF/WEBP header or the `%PDF` magic bytes rather " +
    "than believing the content-type, stores the object under " +
    "`expenses/<id>/` with a random name, and only then inserts the row " +
    "— an insert that fails takes the just-uploaded object with it. " +
    "`x-file-name` is kept for display and is never used to build the " +
    "storage key.\n\n**Requires** `expense.update`, and for a " +
    "warehouse-scoped caller the expense must be at one of their own " +
    "sites.",
  request: {
    params: idParam,
    body: {
      required: true,
      content: {
        "image/webp": { schema: { type: "string", format: "binary" } },
        "application/pdf": { schema: { type: "string", format: "binary" } },
      },
    },
  },
  responses: {
    201: { description: "Stored.", content: { "application/json": { schema: receiptResponseSchema } } },
    401: errorResponse("No session. Sign in."),
    403: errorResponse("Not your warehouse, or no `expense.update`."),
    404: errorResponse("No such expense."),
    409: errorResponse("Receipt storage is not configured on this environment."),
    422: errorResponse("Not a WebP or a PDF, or over the size limit."),
  },
});

adminPath({
  path: "/api/v1/admin/expenses/{id}/receipts/{receiptId}",
  operationId: "deleteExpenseReceipt",
  method: "delete",
  summary: "Remove a bill from an expense",
  permission: "expense.update",
  description:
    "Takes the file off storage first and the row out of the table " +
    "second, so a failure leaves a listed receipt rather than a " +
    "paid-for object nothing remembers.\n\nRefused once the expense is " +
    "APPROVED unless the caller can approve: the receipt is what the " +
    "approval was given against, and pulling it afterwards leaves an " +
    "approved figure with nothing behind it.",
  params: z.object({
    id: z.string().openapi({ example: "12" }),
    receiptId: z.string().openapi({ example: "34" }),
  }),
  response: okAdminResponseSchema,
  responses: { 404: errorResponse("No such receipt on that expense.") },
});

// ── Profile photos ────────────────────────────────────────────────
//
// Registered by hand rather than through `adminPath`/`securedPath`,
// because the request body is not JSON: it is the image itself. The
// generated client needs to know that, or it will helpfully wrap the
// bytes in an envelope the route does not parse.

const photoResponse = z
  .object({ photoUrl: z.string().url(), width: z.number().int(), height: z.number().int() })
  .openapi("PhotoResponse");
const photoClearedResponse = z
  .object({ photoUrl: z.null() })
  .openapi("PhotoClearedResponse");

const photoPath = (config: {
  tag: string;
  path: string;
  set: string;
  clear: string;
  who: string;
  requires: string;
  params?: z.AnyZodObject;
}) => {
  const common = {
    tags: [config.tag],
    security: AUTHENTICATED,
    ...(config.params ? { request: { params: config.params } } : {}),
  };
  registry.registerPath({
    ...common,
    method: "post",
    path: config.path,
    operationId: config.set,
    summary: `Set ${config.who} profile photo`,
    description:
      `The body is the image itself — \`image/webp\`, at most 400 KB and ` +
      `512px on each side. The browser crops, rotates and encodes it; the ` +
      `server reads the actual RIFF/WEBP header rather than believing the ` +
      `content-type, uploads it to Bunny Storage under ` +
      `\`wms/profile-photo/\`, swaps the column, and then removes the file ` +
      `the account used to point at.\n\n**Requires** ${config.requires}.`,
    request: {
      ...(config.params ? { params: config.params } : {}),
      body: {
        required: true,
        content: { "image/webp": { schema: { type: "string", format: "binary" } } },
      },
    },
    responses: {
      200: { description: "Stored.", content: { "application/json": { schema: photoResponse } } },
      401: errorResponse("No session. Sign in."),
      403: errorResponse("Not allowed to change this account's photo."),
      404: errorResponse("No such user."),
      409: errorResponse("Photo storage is not configured on this environment."),
      422: errorResponse("Not a WebP, too large, or larger than 512px."),
    },
  });
  registry.registerPath({
    ...common,
    method: "delete",
    path: config.path,
    operationId: config.clear,
    summary: `Remove ${config.who} profile photo`,
    description:
      `Clears the column and deletes the stored file. Answers 200 when ` +
      `there was no photo to begin with — the caller's intent is "no ` +
      `photo", and there already is none.\n\n**Requires** ${config.requires}.`,
    responses: {
      200: { description: "Removed.", content: { "application/json": { schema: photoClearedResponse } } },
      401: errorResponse("No session. Sign in."),
      403: errorResponse("Not allowed to change this account's photo."),
      404: errorResponse("No such user."),
    },
  });
};

photoPath({
  tag: "Profile",
  path: "/api/v1/profile/photo",
  set: "setMyPhoto",
  clear: "clearMyPhoto",
  who: "my own",
  requires:
    "a session and nothing else — a SALES_AGENT holds no `user.update` at " +
    "any scope, so a permission-keyed route would lock every field agent " +
    "out of their own picture",
});

photoPath({
  tag: "Admin",
  path: "/api/v1/admin/users/{id}/photo",
  set: "setUserPhoto",
  clear: "clearUserPhoto",
  who: "another account's",
  requires: "`user.update`; an OWN-scoped grant covers only the caller",
  params: idParam,
});

// ── Importer self-service and sales agents ────────────────────────
//
// Same envelope, same guard, different tag: these are the endpoints an
// IMPORTER (or SALES_AGENT) calls about their own company, and the ones
// a super admin calls across companies. The Flutter app uses them.

const securedPath = (config: {
  tag: string;
  path: string;
  operationId: string;
  summary: string;
  description: string;
  permission: string;
  method?: "post" | "get" | "patch" | "delete";
  request?: z.ZodTypeAny;
  response: z.ZodTypeAny;
  params?: z.AnyZodObject;
  query?: z.AnyZodObject;
  responses?: Record<number, ReturnType<typeof errorResponse>>;
}) => {
  registry.registerPath({
    method: config.method ?? "post",
    path: config.path,
    operationId: config.operationId,
    tags: [config.tag],
    summary: config.summary,
    description: `${config.description}\n\n**Requires** \`${config.permission}\`.`,
    security: AUTHENTICATED,
    request: {
      ...(config.params ? { params: config.params } : {}),
      ...(config.query ? { query: config.query } : {}),
      ...(config.request
        ? { body: { required: true, content: { "application/json": { schema: config.request } } } }
        : {}),
    },
    responses: {
      200: { description: "Success.", content: { "application/json": { schema: config.response } } },
      401: errorResponse("No session. Sign in."),
      403: errorResponse("Signed in, but not holding the permission — or, for an importer, not verified yet."),
      422: errorResponse("The body failed validation. `error.fields` is keyed by field name."),
      ...(config.responses ?? {}),
    },
  });
};

const kycSubmitResponse = z
  .object({ kycStatus: z.string(), resubmitted: z.boolean() })
  .openapi("ImporterKycSubmitResponse");

securedPath({
  tag: "Importer",
  path: "/api/v1/importer/me",
  method: "get",
  operationId: "getMyImporter",
  summary: "My company profile",
  permission: "importer.read",
  description:
    "The importer named on the caller's own role assignment — never an id " +
    "from the request. Includes `complete` and `missing`, so the app can " +
    "show the same checklist the portal does.",
  response: importerProfileResponseSchema,
  responses: { 404: errorResponse("The caller is not linked to an importer.") },
});

securedPath({
  tag: "Importer",
  path: "/api/v1/importer/me",
  method: "patch",
  operationId: "patchMyImporter",
  summary: "Save part of my company profile",
  permission: "importer.update",
  description:
    "Any subset of fields; half-finished forms are fine. This is the one " +
    "importer endpoint that does not require verification, because " +
    "completing the profile is how you get verified. After the company " +
    "is ACTIVE the identity fields (legal name, entity type, GSTIN, PAN) " +
    "are locked and answer 409.",
  request: importerProfilePatchSchema,
  response: importerProfileResponseSchema,
  responses: { 409: errorResponse("Locked field after verification, or a GSTIN/PAN already registered.") },
});

securedPath({
  tag: "Importer",
  path: "/api/v1/importer/me/submit",
  operationId: "submitMyImporterKyc",
  summary: "Submit my profile for verification",
  permission: "importer.update",
  description:
    "Refuses while any required field is missing (`error.fields` names " +
    "them). On success `kyc_status` becomes SUBMITTED and every super " +
    "admin is notified in-app, by email and by push. A returned profile " +
    "can be fixed and submitted again.",
  response: kycSubmitResponse,
  responses: { 409: errorResponse("Already submitted, or already verified.") },
});

const agentIdParam = z.object({ id: z.string().openapi({ example: "3" }) });
const agentListResponse = z.object({ agents: z.array(salesAgentSchema) }).openapi("SalesAgentListResponse");
const agentCreateResponse = z
  .object({
    agent: salesAgentSchema,
    /** "created" (password emailed), "emailed" or "skipped" — or a note
     *  when the email could not be sent. */
    login: z.string(),
  })
  .openapi("SalesAgentCreateResponse");

securedPath({
  tag: "Sales agents",
  path: "/api/v1/sales-agents",
  method: "get",
  operationId: "listSalesAgents",
  summary: "List sales agents",
  permission: "sales_agent.read",
  description:
    "An importer sees their own; a super admin sees all, or one importer's " +
    "with `?importerId=`. A sales agent sees their own company's.",
  query: z.object({ importerId: z.string().optional().openapi({ example: "12" }) }),
  response: agentListResponse,
});

securedPath({
  tag: "Sales agents",
  path: "/api/v1/sales-agents",
  operationId: "createSalesAgent",
  summary: "Add a sales agent",
  permission: "sales_agent.create",
  description:
    "The importer must be verified (ACTIVE) — until then this is a 403 " +
    "with a message saying so. `importerId` is honoured only for a " +
    "super admin; an importer's own request is pinned to their company. " +
    "With `createLogin` (default true, needs an email) a users row is " +
    "created with the SALES_AGENT role and a temporary password is " +
    "emailed. `salesAreas` are picked from the state and city masters.",
  request: salesAgentCreateSchema,
  response: agentCreateResponse,
  responses: { 409: errorResponse("Mobile, email or PAN already used by another agent of this importer.") },
});

securedPath({
  tag: "Sales agents",
  path: "/api/v1/sales-agents/{id}",
  method: "get",
  operationId: "getSalesAgent",
  summary: "One sales agent",
  permission: "sales_agent.read",
  description: "Own company only, unless the grant is ALL.",
  params: agentIdParam,
  response: salesAgentSchema,
  responses: { 404: errorResponse("No such sales agent.") },
});

securedPath({
  tag: "Sales agents",
  path: "/api/v1/sales-agents/{id}",
  method: "patch",
  operationId: "updateSalesAgent",
  summary: "Edit a sales agent, or activate/deactivate",
  permission: "sales_agent.update",
  description:
    "Any subset. `isActive: false` also revokes the agent's live sessions.",
  params: agentIdParam,
  request: salesAgentUpdateSchema,
  response: salesAgentSchema,
  responses: { 404: errorResponse("No such sales agent.") },
});

securedPath({
  tag: "Sales agents",
  path: "/api/v1/sales-agents/{id}",
  method: "delete",
  operationId: "deleteSalesAgent",
  summary: "Delete a sales agent",
  permission: "sales_agent.delete",
  description: "Soft delete; the login is suspended and the audit log keeps the values.",
  params: agentIdParam,
  response: okAdminResponseSchema,
  responses: { 404: errorResponse("No such sales agent.") },
});

securedPath({
  tag: "Sales agents",
  path: "/api/v1/sales-agents/bulk",
  operationId: "bulkSalesAgents",
  summary: "Activate, deactivate or delete several",
  permission: "sales_agent.update",
  description: "Rows outside the caller's scope are skipped, with a reason, never refused as a whole.",
  request: z
    .object({
      action: z.enum(["activate", "deactivate", "delete"]),
      ids: z.array(z.number().int().positive()).min(1).max(200),
    })
    .openapi("SalesAgentBulkRequest"),
  response: z
    .object({
      action: z.string(),
      done: z.array(z.number().int()),
      skipped: z.array(z.object({ id: z.number().int(), reason: z.string() })),
      notes: z.array(z.object({ id: z.number().int(), note: z.string() })),
    })
    .openapi("SalesAgentBulkResponse"),
});

const notificationItem = z
  .object({
    id: z.number().int(),
    eventKey: z.string(),
    title: z.string(),
    body: z.string(),
    actionUrl: z.string().nullable(),
    createdAt: z.string(),
    readAt: z.string().nullable(),
  })
  .openapi("NotificationItem");

securedPath({
  tag: "Notifications",
  path: "/api/v1/notifications",
  method: "get",
  operationId: "listNotifications",
  summary: "My in-app notifications",
  permission: "notification.read",
  description:
    "Newest first, with the unread and total counts, so a bell needs one " +
    "call. `?filter=unread|read` (or the older `?unread=1`) narrows it; " +
    "`?limit=` up to 300.",
  query: z.object({
    unread: z.string().optional().openapi({ example: "1" }),
    filter: z.string().optional().openapi({ example: "unread", description: "all | unread | read" }),
    limit: z.string().optional().openapi({ example: "20" }),
  }),
  response: z
    .object({
      unread: z.number().int(),
      total: z.number().int(),
      items: z.array(notificationItem),
    })
    .openapi("NotificationListResponse"),
});

securedPath({
  tag: "Notifications",
  path: "/api/v1/notifications/delete",
  operationId: "deleteNotifications",
  summary: "Delete my notifications",
  permission: "notification.read",
  description:
    "A real delete: the rows go, and the `notification_delivery` records " +
    "hanging off them go with them (`on delete cascade`) — the history of " +
    "which email or push was sent for those notifications is lost. An " +
    "audit row naming the ids is written first, in a table nothing can " +
    "delete from, so the act itself stays traceable.\n\nOnly the " +
    "caller's own rows are ever touched: the recipient is the session's " +
    "user id, so ids belonging to somebody else match nothing.",
  request: z
    .object({
      ids: z.array(z.number().int().positive()).max(300).optional(),
      all: z.boolean().optional(),
    })
    .openapi("DeleteNotificationsRequest"),
  response: z.object({ deleted: z.number().int() }).openapi("DeleteNotificationsResponse"),
});

securedPath({
  tag: "Notifications",
  path: "/api/v1/notifications/read",
  operationId: "markNotificationsRead",
  summary: "Mark notifications read",
  permission: "notification.read",
  description:
    "Send `{ids:[…]}` or `{all:true}`, and `read:false` to mark them " +
    "unread again. Only the caller's own rows are ever touched.",
  request: z
    .object({
      ids: z.array(z.number().int().positive()).max(300).optional(),
      all: z.boolean().optional(),
      read: z.boolean().optional(),
    })
    .openapi("MarkNotificationsReadRequest"),
  response: z.object({ marked: z.number().int() }).openapi("MarkNotificationsReadResponse"),
});


// ── My profile ────────────────────────────────────────────────────

const profileResponse = z
  .object({
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    mobile: z.string(),
    emailVerified: z.boolean(),
    mobileVerified: z.boolean(),
    roles: z.array(z.string()),
    lastLoginAt: z.string().nullable(),
  })
  .openapi("ProfileResponse");

securedPath({
  tag: "Profile",
  path: "/api/v1/profile",
  method: "get",
  operationId: "getProfile",
  summary: "My account",
  permission: "authenticated",
  description: "Who the session belongs to: name, contact addresses and roles.",
  response: profileResponse,
});

securedPath({
  tag: "Profile",
  path: "/api/v1/profile",
  method: "patch",
  operationId: "patchProfile",
  summary: "Change my name",
  permission: "authenticated",
  description:
    "Name only. Email, mobile and password each have their own verified " +
    "flow and can never be edited directly — not even by a super admin.",
  request: z
    .object({ firstName: z.string().optional(), lastName: z.string().optional() })
    .openapi("ProfilePatch"),
  response: okAdminResponseSchema,
});

securedPath({
  tag: "Profile",
  path: "/api/v1/profile/password",
  operationId: "changePassword",
  summary: "Change my password",
  permission: "authenticated",
  description:
    "Current password required, unless the account is on a forced " +
    "first-login change. Every session is revoked afterwards — including " +
    "this one — so the client returns to sign-in.",
  request: z
    .object({
      oldPassword: z.string().optional(),
      newPassword: z.string().min(8),
      confirmPassword: z.string(),
    })
    .openapi("ChangePasswordRequest"),
  response: z.object({ ok: z.boolean(), signedOut: z.boolean() }).openapi("SignedOutResponse"),
});

const otpStartResponse = z
  .object({ sent: z.boolean(), expiresInSeconds: z.number().int(), resendAfterSeconds: z.number().int() })
  .openapi("ContactChangeStartResponse");
const otpVerifyRequest = z.object({ code: z.string() }).openapi("ContactChangeVerifyRequest");

securedPath({
  tag: "Profile",
  path: "/api/v1/profile/email",
  operationId: "startEmailChange",
  summary: "Change my email — step 1, code to the new address",
  permission: "authenticated",
  description: "Nothing changes yet; a one-time code goes to the NEW email.",
  request: z.object({ newEmail: z.string().email() }).openapi("EmailChangeRequest"),
  response: otpStartResponse,
  responses: { 409: errorResponse("That email already belongs to another account.") },
});

securedPath({
  tag: "Profile",
  path: "/api/v1/profile/email/verify",
  operationId: "verifyEmailChange",
  summary: "Change my email — step 2, confirm the code",
  permission: "authenticated",
  description: "On success the email is updated and every session is revoked.",
  request: otpVerifyRequest,
  response: z
    .object({ ok: z.boolean(), signedOut: z.boolean(), email: z.string() })
    .openapi("EmailChangeVerifyResponse"),
});

securedPath({
  tag: "Profile",
  path: "/api/v1/profile/mobile",
  operationId: "startMobileChange",
  summary: "Change my mobile — step 1, code by SMS to the new number",
  permission: "authenticated",
  description: "Nothing changes yet; a one-time code goes to the NEW number.",
  request: z.object({ newMobile: z.string() }).openapi("MobileChangeRequest"),
  response: otpStartResponse,
  responses: { 409: errorResponse("That mobile already belongs to another account.") },
});

securedPath({
  tag: "Profile",
  path: "/api/v1/profile/mobile/verify",
  operationId: "verifyMobileChange",
  summary: "Change my mobile — step 2, confirm the code",
  permission: "authenticated",
  description: "On success the mobile is updated and every session is revoked.",
  request: otpVerifyRequest,
  response: z
    .object({ ok: z.boolean(), signedOut: z.boolean(), mobile: z.string() })
    .openapi("MobileChangeVerifyResponse"),
});


// ── Document ──────────────────────────────────────────────────

/**
 * Where the generated client will point.
 *
 * Read from the environment rather than written here as a literal. The
 * spec is what the Flutter client is generated from, so a hostname
 * frozen into this file survives a domain change and ships a mobile
 * build that calls the wrong origin — a failure that only shows up on a
 * handset, after release.
 */
function servers() {
  const origin = appEnv().appUrl;
  const list: { url: string; description: string }[] = [];

  if (process.env.NODE_ENV !== "production") {
    list.push({ url: origin, description: "Local development" });
  }

  const production = process.env.NEXT_PUBLIC_APP_URL ?? origin;
  if (!list.some((s) => s.url === production)) {
    list.push({ url: production, description: "Production" });
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
        url: appEnv().appUrl,
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
        name: "Profile",
        description:
          "The signed-in user's own account: name, password, and the " +
          "OTP-verified email and mobile changes.",
      },
      {
        name: "Importer",
        description:
          "An importer's own company: read it, complete it, submit it for " +
          "verification. The portal opens to the importer only once a " +
          "super admin has approved.",
      },
      {
        name: "Sales agents",
        description:
          "An importer's field people, with an optional mobile-app login " +
          "each. Available to a verified importer and to super admins.",
      },
      {
        name: "Auth",
        description:
          "Registration, dual-channel OTP, sign-in and password reset. " +
          "Every endpoint here is public and therefore rate-limited by IP " +
          "and by account.",
      },
      {
        name: "Admin",
        description:
          "Master data, importer approval and role assignment. Every " +
          "endpoint is authenticated and gated on a named permission read " +
          "from `wms.user_effective_permission`, which has already " +
          "collapsed the caller's roles to the widest scope per " +
          "permission and subtracted deny overrides. Nothing here checks " +
          "a role name.",
      },
    ],
  });
}
