import { describe, expect, it } from "vitest";

/**
 * The document is generated from the same Zod objects the handlers
 * validate with, so it cannot drift. What CAN drift is the path list:
 * a route added without a registerPath is undocumented, and a
 * registerPath without a route is a 404 in the client's generated SDK.
 * Both are worse than no document.
 */
describe("OpenAPI document", () => {
  it("documents every auth route that exists, and no route that does not", async () => {
    const { buildOpenApiDocument } = await import("@/lib/openapi/document");
    const doc = buildOpenApiDocument();

    const documented = Object.keys(doc.paths ?? {})
      .filter((p) => p.startsWith("/api/v1/auth"))
      .sort();

    // Mirrors src/app/api/v1/auth/**/route.ts.
    expect(documented).toEqual([
      "/api/v1/auth/login",
      "/api/v1/auth/logout",
      "/api/v1/auth/otp/send",
      "/api/v1/auth/otp/status",
      "/api/v1/auth/otp/verify",
      "/api/v1/auth/password/forgot",
      "/api/v1/auth/password/reset",
      "/api/v1/auth/register",
      "/api/v1/auth/session",
    ]);
  });

  it("documents the device endpoints", async () => {
    const { buildOpenApiDocument } = await import("@/lib/openapi/document");
    const doc = buildOpenApiDocument();
    expect(Object.keys(doc.paths ?? {})).toContain("/api/v1/devices");
    const item = (doc.paths ?? {})["/api/v1/devices"] as Record<string, unknown>;
    expect(Object.keys(item).sort()).toEqual(["delete", "post"]);
  });

  it("gives every operation an id, so the generated client has method names", async () => {
    const { buildOpenApiDocument } = await import("@/lib/openapi/document");
    const doc = buildOpenApiDocument();
    const ids: string[] = [];

    for (const [path, item] of Object.entries(doc.paths ?? {})) {
      for (const [method, op] of Object.entries(item as Record<string, unknown>)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        const operationId = (op as { operationId?: string }).operationId;
        expect(operationId, `${method.toUpperCase()} ${path}`).toBeTruthy();
        ids.push(operationId!);
      }
    }
    // Duplicates silently overwrite methods in most generators.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks the auth endpoints public rather than leaving it unsaid", async () => {
    const { buildOpenApiDocument } = await import("@/lib/openapi/document");
    const doc = buildOpenApiDocument();

    for (const [path, item] of Object.entries(doc.paths ?? {})) {
      if (!path.startsWith("/api/v1/auth")) continue;
      for (const [method, op] of Object.entries(item as Record<string, unknown>)) {
        if (!["get", "post"].includes(method)) continue;
        expect((op as { security?: unknown[] }).security, path).toEqual([]);
      }
    }
  });

  it("describes 422 and 429 on every auth endpoint", async () => {
    const { buildOpenApiDocument } = await import("@/lib/openapi/document");
    const doc = buildOpenApiDocument();

    for (const [path, item] of Object.entries(doc.paths ?? {})) {
      if (!path.startsWith("/api/v1/auth")) continue;
      for (const [method, op] of Object.entries(item as Record<string, unknown>)) {
        if (!["get", "post"].includes(method)) continue;
        const responses = (op as { responses: Record<string, unknown> }).responses;
        // Every one of these is public and therefore rate-limited; a
        // client that does not handle 429 will hammer through a lockout.
        expect(Object.keys(responses), `${method} ${path}`).toContain("429");
      }
    }
  });
});
