import { describe, expect, it } from "vitest";

import { ADMIN_NAV, visibleNav } from "@/components/admin/nav";

/**
 * The two things about the admin panel that are worth a test.
 *
 * Not the screens — those change. These are the invariants that are
 * silent when they break: a route reachable by someone who cannot see
 * its link, and an authenticated endpoint documented as public, which
 * ships a generated client that never sends a credential.
 */

describe("admin navigation", () => {
  /**
   * The exact permission set an IMPORTER holds, taken from
   * `user_effective_permission` on a real signed-in customer.
   *
   * `master.city.read` at ALL is the trap: the matrix grants it to every
   * role, because anyone filling in an address needs the list. Keying
   * the cities entry on read let this set into the admin area, which is
   * the bug this case exists for.
   */
  const IMPORTER = [
    { permission: "notification.read", scope: "OWN" as const },
    { permission: "importer.read", scope: "OWN" as const },
    { permission: "user.read", scope: "OWN" as const },
    { permission: "master.city.read", scope: "ALL" as const },
  ];

  it("lets nothing through for a customer's permission set", () => {
    expect(visibleNav(IMPORTER)).toEqual([]);
  });

  it("does not show the dashboard on its own", () => {
    // The dashboard has no permission of its own. It must never be the
    // reason somebody is admitted.
    expect(visibleNav([{ permission: "master.city.read", scope: "ALL" }])).toEqual([]);
  });

  it("shows the matching entries for a warehouse-scoped set", () => {
    const warehouseAdmin = [
      { permission: "notification.read", scope: "OWN" as const },
      { permission: "master.city.read", scope: "ALL" as const },
      { permission: "importer.read", scope: "WAREHOUSE" as const },
      { permission: "user.read", scope: "WAREHOUSE" as const },
    ];
    const labels = visibleNav(warehouseAdmin).map((i) => i.label);
    // Dashboard rides along; cities does not, because adding master data
    // is not a warehouse admin's job.
    expect(labels).toEqual(["Dashboard", "Importers", "Users"]);
  });

  it("shows everything to a platform-wide set", () => {
    const superAdmin = ADMIN_NAV.filter((i) => i.permission !== null).map((i) => ({
      permission: i.permission!,
      scope: "ALL" as const,
    }));
    expect(visibleNav(superAdmin)).toHaveLength(ADMIN_NAV.length);
  });

  it("keys every real entry on a permission that exists in the matrix", () => {
    for (const item of ADMIN_NAV) {
      if (item.permission === null) continue;
      expect(item.permission).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
    }
  });
});

describe("OpenAPI: admin endpoints", () => {
  it("documents exactly the admin routes that exist", async () => {
    const { buildOpenApiDocument } = await import("@/lib/openapi/document");
    const doc = buildOpenApiDocument();

    const documented = Object.keys(doc.paths ?? {})
      .filter((p) => p.startsWith("/api/v1/admin"))
      .sort();

    // Mirrors src/app/api/v1/admin/**/route.ts.
    expect(documented).toEqual([
      "/api/v1/admin/cities",
      "/api/v1/admin/cities/{id}",
      "/api/v1/admin/importers/{id}/approve",
      "/api/v1/admin/importers/{id}/reject",
      "/api/v1/admin/users/{id}/roles",
      "/api/v1/admin/users/{id}/status",
    ]);
  });

  it("declares a credential on every admin operation", async () => {
    const { buildOpenApiDocument } = await import("@/lib/openapi/document");
    const doc = buildOpenApiDocument();

    // The document's top level is `security: []` — public by default,
    // which is right for the auth endpoints and catastrophic for these.
    // An admin operation that forgets to override it generates a client
    // that never sends the cookie or the token.
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
      if (!path.startsWith("/api/v1/admin")) continue;
      for (const [method, operation] of Object.entries(item ?? {})) {
        if (!["get", "post", "patch", "delete", "put"].includes(method)) continue;
        const security = (operation as { security?: unknown[] }).security;
        expect(security, `${method.toUpperCase()} ${path}`).toBeDefined();
        expect(security!.length, `${method.toUpperCase()} ${path}`).toBeGreaterThan(0);
      }
    }
  });

  it("registers both credential schemes the two clients actually use", async () => {
    const { buildOpenApiDocument } = await import("@/lib/openapi/document");
    const doc = buildOpenApiDocument();
    const schemes = doc.components?.securitySchemes ?? {};
    expect(Object.keys(schemes).sort()).toEqual(["bearerAuth", "cookieAuth"]);
  });

  it("names the required permission in every admin description", async () => {
    const { buildOpenApiDocument } = await import("@/lib/openapi/document");
    const doc = buildOpenApiDocument();

    for (const [path, item] of Object.entries(doc.paths ?? {})) {
      if (!path.startsWith("/api/v1/admin")) continue;
      for (const [method, operation] of Object.entries(item ?? {})) {
        if (!["get", "post", "patch", "delete", "put"].includes(method)) continue;
        const description = (operation as { description?: string }).description ?? "";
        expect(description, `${method.toUpperCase()} ${path}`).toContain("**Requires**");
      }
    }
  });
});
