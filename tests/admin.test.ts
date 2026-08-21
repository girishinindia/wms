import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  ADMIN_NAV_ITEMS,
  groupNav,
  isGroup,
  MASTER_ITEMS,
  visibleNav,
} from "@/components/admin/nav";
import { MASTER_RESOURCES, resolveResource } from "@/lib/admin/master-registry";

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
    // reason somebody is admitted — nor may Notifications, which is the
    // other entry keyed on nothing.
    expect(visibleNav([{ permission: "master.city.read", scope: "ALL" }])).toEqual([]);
    expect(visibleNav([{ permission: "notification.read", scope: "OWN" }])).toEqual([]);
  });

  it("shows the matching entries for a warehouse-scoped set", () => {
    const warehouseAdmin = [
      { permission: "notification.read", scope: "OWN" as const },
      { permission: "master.city.read", scope: "ALL" as const },
      { permission: "importer.read", scope: "WAREHOUSE" as const },
      { permission: "user.read", scope: "WAREHOUSE" as const },
    ];
    const labels = visibleNav(warehouseAdmin).map((i) => i.label);
    // Dashboard and Notifications ride along; cities does not, because
    // adding master data is not a warehouse admin's job.
    expect(labels).toEqual(["Dashboard", "Notifications", "Importers", "Users"]);
  });

  it("shows everything to a platform-wide set", () => {
    const superAdmin = ADMIN_NAV_ITEMS.filter((i) => i.permission !== null).map((i) => ({
      permission: i.permission!,
      scope: "ALL" as const,
    }));
    expect(visibleNav(superAdmin)).toHaveLength(ADMIN_NAV_ITEMS.length);
  });

  it("keys every real entry on a permission that exists in the matrix", () => {
    for (const item of ADMIN_NAV_ITEMS) {
      if (item.permission === null) continue;
      expect(item.permission).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
    }
  });

  /**
   * Every master screen is keyed on `.create`, never `.read`.
   *
   * The read permissions are held by all nine roles at ALL scope, so a
   * single entry keyed on one of them re-opens the admin area to every
   * customer — which is exactly how it broke the first time.
   */
  it("keys every master entry on create, never read", () => {
    for (const item of MASTER_ITEMS) {
      expect(item.permission, item.label).toMatch(/\.create$/);
    }
  });

  it("keeps a customer out even when they hold every master read", () => {
    const everyRead = MASTER_ITEMS.map((i) => ({
      permission: i.permission!.replace(/\.create$/, ".read"),
      scope: "ALL" as const,
    }));
    expect(visibleNav(everyRead)).toEqual([]);
  });
});

describe("admin navigation: grouping", () => {
  const SUPER_ADMIN = ADMIN_NAV_ITEMS.filter((i) => i.permission !== null).map((i) => ({
    permission: i.permission!,
    scope: "ALL" as const,
  }));

  it("returns leaves, not groups", () => {
    // Three callers outside the sidebar only ask whether this is empty,
    // to decide admission and where sign-in lands. A tree would break
    // all three silently.
    for (const item of visibleNav(SUPER_ADMIN)) {
      expect(isGroup(item)).toBe(false);
    }
  });

  it("nests the master entries under one group for rendering", () => {
    const nodes = groupNav(visibleNav(SUPER_ADMIN));
    const master = nodes.find((n) => isGroup(n) && n.label === "Master");
    expect(master).toBeDefined();
    expect(isGroup(master!) && master.children.map((c) => c.label)).toEqual([
      "Countries",
      "States",
      "Cities",
      "Warehouse types",
      "Vehicle types",
    ]);
  });

  it("drops the group entirely rather than rendering an empty expander", () => {
    const warehouseAdmin = [
      { permission: "user.read", scope: "WAREHOUSE" as const },
    ];
    const nodes = groupNav(visibleNav(warehouseAdmin));
    // No importer entry earned → no "Importers & agents" group; no
    // master entry earned → no "Master" group.
    expect(nodes.some((n) => isGroup(n))).toBe(false);
    expect(nodes.map((n) => n.label)).toEqual(["Dashboard", "Notifications", "Users"]);
  });

  it("shows an importer only their own screens, under the importers group", () => {
    const importer = [
      { permission: "importer.read", scope: "OWN" as const },
      { permission: "importer.update", scope: "OWN" as const },
      { permission: "sales_agent.read", scope: "OWN" as const },
      { permission: "user.read", scope: "OWN" as const },
      { permission: "master.city.read", scope: "ALL" as const },
    ];
    const leaves = visibleNav(importer).map((i) => i.label);
    // No "My company" entry: the importer's company profile is their
    // dashboard.
    expect(leaves).toEqual(["Dashboard", "Notifications", "Sales agents"]);
    const nodes = groupNav(visibleNav(importer));
    const group = nodes.find((n) => isGroup(n) && n.label === "Importers & agents");
    expect(group).toBeDefined();
    expect(isGroup(group!) && group.children.map((c) => c.href)).toEqual(["/admin/sales-agents"]);
  });

  it("never lets OWN scope earn a platform list", () => {
    // importer.read at OWN is the importer's own record, not the list.
    expect(visibleNav([{ permission: "importer.read", scope: "OWN" }])).toEqual([]);
    expect(visibleNav([{ permission: "user.read", scope: "OWN" }])).toEqual([]);
  });

  it("has a nav entry for every registry resource, and vice versa", () => {
    // A screen with no link is unreachable; a link with no screen is a
    // 404. Cities is in the registry like the other four; its bulk-paste
    // box is an extra on the page, not a different table.
    const navSlugs = MASTER_ITEMS.map((i) => i.href.split("/").pop()!);
    expect(navSlugs.sort()).toEqual(Object.keys(MASTER_RESOURCES).sort());
  });
});

describe("the sidebar navigates with the browser, not the router", () => {
  const shellRaw = readFileSync(
    new URL("../src/components/admin/AdminShell.tsx", import.meta.url),
    "utf8",
  );
  /** The comments explain at length why `<Link>` is gone, so they have to
   *  come out before asserting that it is. */
  const shell = shellRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  /**
   * Three separate reports of "I click the menu and nothing happens"
   * came from three different client-routing failures — chunks 404ing
   * after a deploy, a navigation aborting silently, and a router that
   * stopped responding in one tab. They share the property that makes
   * them so hard to place: when client routing fails, it fails without
   * saying anything, and the menu just looks broken.
   *
   * A browser navigation cannot fail silently. This pins that decision
   * so it is not casually undone by someone tidying up imports.
   */
  it("uses plain anchors for every nav item", () => {
    expect(shell).not.toMatch(/from "next\/link"/);
    expect(shell).not.toMatch(/<Link\b/);
    expect(shell).toMatch(/<a\b[\s\S]*href=\{item\.href\}/);
  });

  it("carries no stray control characters", () => {
    // A NUL byte lived in this file from the day the Master menu
    // shipped. Harmless at runtime, and enough to make every tool treat
    // the source as binary.
    const control = shellRaw.split("").filter((c) => {
      const n = c.charCodeAt(0);
      return n < 9 || (n > 13 && n < 32);
    });
    expect(control).toEqual([]);
  });
});

describe("master registry", () => {
  it("refuses a slug that is not in the whitelist", () => {
    expect(resolveResource("users")).toBeNull();
    expect(resolveResource("../users")).toBeNull();
    expect(resolveResource("__proto__")).toBeNull();
    expect(resolveResource("constructor")).toBeNull();
  });

  /**
   * These strings are interpolated into SQL as identifiers, so they are
   * the one thing in the registry that must not drift.
   *
   * The pattern has to allow digits: `country.iso2` and `country.iso3`
   * both carry one, and a letters-only guard rejected them — which this
   * case caught before the countries screen ever rendered.
   */
  const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

  it("uses only safe identifiers, since they are interpolated", () => {
    for (const resource of Object.values(MASTER_RESOURCES)) {
      expect(resource.table, resource.slug).toMatch(IDENTIFIER);
      expect(resource.orderBy, resource.slug).toMatch(/^[a-z_][a-z0-9_, ]*$/);
      for (const field of resource.fields) {
        expect(field.column, `${resource.slug}.${field.key}`).toMatch(IDENTIFIER);
      }
      for (const dep of resource.dependents) {
        expect(dep.table).toMatch(IDENTIFIER);
        expect(dep.column).toMatch(IDENTIFIER);
      }
      if (resource.parent) {
        expect(resource.parent.table).toMatch(IDENTIFIER);
        expect(resource.parent.column).toMatch(IDENTIFIER);
        expect(resource.parent.labelColumn).toMatch(IDENTIFIER);
      }
    }
  });

  it("offers exactly the six categories the check constraint allows", () => {
    const category = MASTER_RESOURCES["vehicle-types"].fields.find(
      (f) => f.key === "category",
    );
    // vehicle_type_category_check, verbatim. A seventh option would be a
    // select the database refuses.
    expect(category?.options).toEqual([
      "THREE_WHEELER",
      "LCV",
      "MCV",
      "HCV",
      "TRAILER",
      "CONTAINER",
    ]);
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
      "/api/v1/admin/importers",
      "/api/v1/admin/importers/{id}",
      "/api/v1/admin/importers/{id}/approve",
      "/api/v1/admin/importers/{id}/lifecycle",
      "/api/v1/admin/importers/{id}/reject",
      "/api/v1/admin/master/{resource}",
      "/api/v1/admin/master/{resource}/bulk",
      "/api/v1/admin/users/bulk",
      "/api/v1/admin/users/{id}",
      "/api/v1/admin/users/{id}/profile",
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
