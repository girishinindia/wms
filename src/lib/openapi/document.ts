import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import {
  forgotPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/validation/auth";

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

extendZodWithOpenApi(z);

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

// ── Auth payloads ─────────────────────────────────────────────
//
// Registered as components, not paths: the routes are not built yet, and
// listing a path that 404s makes the whole document untrustworthy. These
// appear under "Models" in Scalar so the mobile and web clients can agree
// on the shape now, and the paths get added in the same commit as the
// handlers.

registry.register("SignInRequest", signInSchema.openapi("SignInRequest"));
registry.register("SignUpRequest", signUpSchema.openapi("SignUpRequest"));
registry.register(
  "ForgotPasswordRequest",
  forgotPasswordSchema.openapi("ForgotPasswordRequest")
);

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
    ],
  });
}
