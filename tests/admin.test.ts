import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  ADMIN_NAV_ITEMS,
  groupNav,
  isGroup,
  MASTER_ITEMS,
  visibleNav,
  WAREHOUSE_ITEMS,
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
      // Real WAREHOUSE_ADMIN rows: they run the site, so they read and
      // update it. Neither earns the Warehouses section — that is the
      // register of sites, not the site.
      { permission: "warehouse.read", scope: "WAREHOUSE" as const },
      { permission: "warehouse.update", scope: "WAREHOUSE" as const },
    ];
    const labels = visibleNav(warehouseAdmin).map((i) => i.label);
    // Dashboard and Notifications ride along; cities does not, because
    // adding master data is not a warehouse admin's job.
    //
    // The order is `ADMIN_NAV`'s: Users sits in "Users & Roles" above
    // "Importers & agents". Asserted as an ordered list on purpose —
    // this is the array the sidebar renders from.
    expect(labels).toEqual(["Dashboard", "Notifications", "Users", "Importers"]);
  });

  /**
   * The same trap the master entries fell into, one table over.
   *
   * SEVEN roles hold `warehouse.read` — every manager on the floor —
   * and keying the section on it would put the register of sites, and
   * the upload form for their photographs, in front of all of them.
   * Only `.create` is a super admin's alone.
   */
  it("keys every warehouse entry on create, never read", () => {
    for (const item of WAREHOUSE_ITEMS) {
      expect(item.permission, item.label).toBe("warehouse.create");
      // And never opts into OWN scope, which is how the importer
      // entries are (correctly) reached. ALL only — the same question
      // `requirePlatformWarehouse` asks on every route behind the link.
      expect(item.own, item.label).toBeUndefined();
      expect(item.allOnly, item.label).toBe(true);
    }
  });

  it("keeps a site's own manager out of the warehouse register", () => {
    // Everything a WAREHOUSE_ADMIN could hold about warehouses, at the
    // widest scope they are ever granted.
    const scoped = ["read", "update", "delete", "create"].map((verb) => ({
      permission: `warehouse.${verb}`,
      scope: "WAREHOUSE" as const,
    }));
    expect(visibleNav(scoped).map((i) => i.label)).toEqual([]);

    // At ALL scope, the same keys open it — that is the super admin.
    const platform = scoped.map((p) => ({ ...p, scope: "ALL" as const }));
    expect(visibleNav(platform).map((i) => i.label)).toEqual([
      "Dashboard",
      "Notifications",
      "Warehouse",
      "Gallery",
    ]);
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
      "Expense categories",
      "FAQ categories",
    ]);
  });

  it("drops the group entirely rather than rendering an empty expander", () => {
    const warehouseAdmin = [
      { permission: "user.read", scope: "WAREHOUSE" as const },
    ];
    const nodes = groupNav(visibleNav(warehouseAdmin));
    // Nothing earned inside Importers & agents, Master, Warehouses or
    // Transporters & Vehicles, so none of them is here at all. A section
    // header that opens onto nothing reads as a broken page, not as a
    // permission boundary.
    expect(nodes.map((n) => n.label)).toEqual(["Dashboard", "Notifications", "Users & Roles"]);
  });

  it("keeps a group that earned some of its children, holding only those", () => {
    /**
     * The other half of the same rule, and the one a warehouse admin
     * actually meets: they hold `user.read` but not `role.read`, so
     * "Users & Roles" opens onto Users alone.
     *
     * Worth its own test because the two entries in that section are
     * deliberately keyed differently — `role.read` is `allOnly` because
     * `role_permission` has no warehouse column, `user.read` is not —
     * and a partially-earned group is exactly what that produces.
     */
    const nodes = groupNav(visibleNav([{ permission: "user.read", scope: "WAREHOUSE" }]));
    const group = nodes.find((n) => isGroup(n) && n.label === "Users & Roles");
    expect(group).toBeDefined();
    expect(isGroup(group!) && group.children.map((c) => c.href)).toEqual(["/admin/users"]);

    // A super admin, who holds both, gets both.
    const full = groupNav(visibleNav(SUPER_ADMIN)).find(
      (n) => isGroup(n) && n.label === "Users & Roles",
    );
    expect(isGroup(full!) && full.children.map((c) => c.href)).toEqual([
      "/admin/users",
      "/admin/roles",
      "/admin/audit",
    ]);
  });

  it("renders the sections in the order the sidebar shows them", () => {
    // The customer's order. `ADMIN_NAV` is the single source of it, and
    // `groupNav` walks that array — so this is the list, top to bottom.
    expect(groupNav(visibleNav(SUPER_ADMIN)).map((n) => n.label)).toEqual([
      "Dashboard",
      "Notifications",
      "Users & Roles",
      "Master",
      "Warehouses",
      "Transporters & Vehicles",
      "Importers & agents",
      "Expenses",
      "FAQs",
    ]);
  });

  it("counts unread on the notifications entry, and nowhere else", () => {
    /**
     * The badge is declared here as a NAME rather than a number, because
     * this module is imported by the server layout and must stay free of
     * JSX and of anything that reads state. `AdminShell` maps the name
     * onto the hook.
     *
     * Exactly one entry carries it: a second would mean a second
     * subscriber to the same store showing a count of somebody else's
     * thing.
     */
    const badged = ADMIN_NAV_ITEMS.filter((i) => i.badge !== undefined);
    expect(badged.map((i) => i.href)).toEqual(["/admin/notifications"]);
    expect(badged[0]!.badge).toBe("notifications");
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

  it("gives a sales agent the dashboard and the bell, and no list of themselves", () => {
    // A SALES_AGENT holds exactly what an importer holds over sales
    // agents: `sales_agent.read` at OWN. The permission cannot tell them
    // apart, so the caller says which one this is.
    const agent = [
      { permission: "sales_agent.read", scope: "OWN" as const },
      { permission: "notification.read", scope: "OWN" as const },
      { permission: "master.city.read", scope: "ALL" as const },
    ];
    expect(visibleNav(agent, { agentOnly: true }).map((i) => i.label)).toEqual([
      "Dashboard",
      "Notifications",
    ]);
    // The same permissions WITHOUT the flag are an importer, who keeps
    // the list — the flag is the only thing that separates them.
    expect(visibleNav(agent).map((i) => i.label)).toContain("Sales agents");
  });

  it("still admits a sales agent to the panel", () => {
    // `admin/layout.tsx` reads an empty result as "this account holds
    // nothing" and locks the account out. Tidying an agent's sidebar
    // must never do that.
    expect(visibleNav([{ permission: "sales_agent.read", scope: "OWN" }], { agentOnly: true }).length)
      .toBeGreaterThan(0);
    // Including for an agent whose permission list is somehow empty.
    expect(visibleNav([], { agentOnly: true }).length).toBeGreaterThan(0);
  });

  it("never lets OWN scope earn a platform list", () => {
    // importer.read at OWN is the importer's own record, not the list.
    expect(visibleNav([{ permission: "importer.read", scope: "OWN" }])).toEqual([]);
    expect(visibleNav([{ permission: "user.read", scope: "OWN" }])).toEqual([]);
  });

  it("has a nav entry for every registry resource, and vice versa", () => {
    /**
     * A screen with no link is unreachable; a link with no screen is a
     * 404. Both directions still hold — but the mapping is no longer
     * "every registry entry lives under Master". FAQs is a registry
     * resource with a top-level entry of its own at `/admin/faqs`, so
     * the check is against every leaf in the nav, matched on the last
     * path segment.
     */
    const navSlugs = ADMIN_NAV_ITEMS.map((i) => i.href.split("/").pop()!);
    for (const slug of Object.keys(MASTER_RESOURCES)) {
      expect(navSlugs, `no menu entry reaches /${slug}`).toContain(slug);
    }
    // And nothing under Master points at a resource that does not exist.
    for (const item of MASTER_ITEMS) {
      const slug = item.href.split("/").pop()!;
      expect(Object.keys(MASTER_RESOURCES), `${item.href} has no registry entry`).toContain(slug);
    }
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

  /**
   * A bare `{label}` inside a flex row is an ANONYMOUS flex item: it
   * shrinks to its content width, and the moment the text wraps to a
   * second line it centres inside that box. "Transporters & Vehicles"
   * was the first label long enough to hit it — measured at 68px from
   * the button's left edge against 40px for every other row, on two
   * lines, centred.
   *
   * Both places that draw a nav label need the same guard, and the
   * group button is the one that was wrong.
   */
  it("gives every nav label a box of its own, so a long one still aligns left", () => {
    const labelSpan = /<span className="min-w-0 flex-1 text-left">\{(item|node)\.label\}<\/span>/g;
    expect(shell.match(labelSpan)).toHaveLength(2);
    // And no bare label left behind in either row.
    expect(shell).not.toMatch(/shrink-0"\s*\/>\s*\{item\.label\}/);
    expect(shell).not.toMatch(/\}\)\(\)\}\s*\{node\.label\}/);
  });

  it("keeps one poller for the unread count, not one per badge", () => {
    /**
     * The bell in the header and the badge in the sidebar show the same
     * number. Two owners would mean two timers, two requests a minute,
     * and two counts that disagree for up to a minute after anything is
     * marked read — so the fetch and the timer live in
     * `lib/notifications/unread` and both components subscribe.
     */
    const bell = readFileSync(
      new URL("../src/components/admin/NotificationBell.tsx", import.meta.url),
      "utf8",
    );
    expect(bell).not.toMatch(/setInterval/);
    expect(bell).toMatch(/useNotifications\(\)/);
    expect(shell).toMatch(/useUnreadCount\(\)/);

    const store = readFileSync(
      new URL("../src/lib/notifications/unread.ts", import.meta.url),
      "utf8",
    );
    // One timer, started by the first subscriber and stopped by the last.
    expect(store.match(/setInterval/g)).toHaveLength(1);
    expect(store).toMatch(/listeners\.size === 0/);
    /**
     * `getServerSnapshot` must return the SAME object every call. A
     * fresh literal there is a new reference on every render, which
     * `useSyncExternalStore` reads as "changed" — an infinite loop that
     * only shows up in SSR.
     */
    expect(store).toMatch(/getServerSnapshot = \(\) => EMPTY/);
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

describe("the list toolbar keeps Add out of the search form", () => {
  const raw = readFileSync(
    new URL("../src/components/admin/ListControls.tsx", import.meta.url),
    "utf8",
  );
  const src = raw.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "").replace(/^\s*\/\/.*$/gm, "");

  /**
   * The toolbar submits itself whenever a select inside the form
   * changes — that is what makes the filters work without a button. The
   * `action` slot is a drawer trigger, and a drawer's panel is a REACT
   * child of it. React events travel the React tree and not the DOM
   * tree, so even a portalled drawer counts as inside this form:
   * choosing a type in the Add-warehouse drawer would submit the
   * toolbar and reload the page over a half-filled form.
   *
   * Putting the button on the same row as the search box is exactly the
   * change that invites someone to move it inside. This is the tripwire.
   */
  it("renders the action slot after the form closes, not within it", () => {
    const form = src.indexOf("<form");
    const close = src.indexOf("</form>");
    const slot = src.indexOf("{action ?");
    expect(form, "the toolbar no longer has a form").toBeGreaterThan(-1);
    expect(slot, "the action slot moved or was renamed").toBeGreaterThan(-1);
    expect(slot, "the Add button is inside the search form").toBeGreaterThan(close);
  });

  it("still lets the form own every control in both rows", () => {
    // The form lays nothing out — `display: contents` — but it must
    // still be the ancestor of the search box and of every filter, or
    // submitting drops half the state.
    const form = src.slice(src.indexOf("<form"), src.indexOf("</form>"));
    expect(form).toMatch(/className="contents"/);
    expect(form).toMatch(/name="q"/);
    expect(form).toMatch(/name="status"/);
    expect(form).toMatch(/name="size"/);
    expect(form).toMatch(/\{extraFilters\}/);
    expect(form).toMatch(/type="submit"/);
  });

  it("puts search on the first row and the filters on the second", () => {
    const searchRow = src.slice(src.indexOf("col-start-1 row-start-1"));
    expect(searchRow.indexOf('name="q"'), "search is not on the first row").toBeGreaterThan(-1);
    expect(searchRow.indexOf('name="q"')).toBeLessThan(searchRow.indexOf("col-span-full row-start-2"));
    // And the Add button shares that first row.
    expect(src).toMatch(/col-start-2 row-start-1/);
    // Full width, not the old fixed 176px.
    expect(src).toMatch(/min-w-0 flex-1/);
    expect(src).not.toMatch(/w-44/);
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
      "/api/v1/admin/audit/{id}",
      "/api/v1/admin/cities",
      "/api/v1/admin/cities/{id}",
      "/api/v1/admin/expenses/{id}/approve",
      "/api/v1/admin/expenses/{id}/receipts",
      "/api/v1/admin/expenses/{id}/receipts/{receiptId}",
      "/api/v1/admin/importers",
      "/api/v1/admin/importers/{id}",
      "/api/v1/admin/importers/{id}/approve",
      "/api/v1/admin/importers/{id}/lifecycle",
      "/api/v1/admin/importers/{id}/reject",
      "/api/v1/admin/master/{resource}",
      "/api/v1/admin/master/{resource}/bulk",
      "/api/v1/admin/roles/{key}",
      "/api/v1/admin/users",
      "/api/v1/admin/users/bulk",
      "/api/v1/admin/users/{id}",
      "/api/v1/admin/users/{id}/invite",
      "/api/v1/admin/users/{id}/overrides",
      "/api/v1/admin/users/{id}/overrides/{overrideId}",
      "/api/v1/admin/users/{id}/photo",
      "/api/v1/admin/users/{id}/profile",
      "/api/v1/admin/users/{id}/roles",
      "/api/v1/admin/users/{id}/status",
      "/api/v1/admin/warehouses",
      "/api/v1/admin/warehouses/{id}",
      "/api/v1/admin/warehouses/{id}/images",
      "/api/v1/admin/warehouses/{id}/images/{imageId}",
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

describe("tables keep their header and pager in view", () => {
  const src = (path: string) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
      .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  const dataTable = src("src/components/admin/DataTable.tsx");
  const box = src("src/components/admin/StickyTableBox.tsx");

  it("never wraps a table in a bare overflow-x-auto again", () => {
    /**
     * The regression this whole thing exists for. `overflow-x: auto`
     * with `overflow-y: visible` is not a thing: CSS computes the
     * `visible` axis to `auto`, so the wrapper became a scroll
     * container on BOTH axes while never actually scrolling — its
     * `scrollHeight` and `clientHeight` were identical — and a sticky
     * header anchored to it instead of to anything that moves.
     *
     * Measured on the cities screen: at `scrollY 596` the header sat at
     * `top: -286`. Removing that one class put it at `top: 0`.
     */
    expect(dataTable).not.toMatch(/overflow-x-auto/);
    expect(dataTable).toMatch(/<StickyTableBox>/);
    expect(box).toMatch(/overflow-auto/);
    expect(box).not.toMatch(/overflow-x-auto/);
  });

  it("pins the header on the cells, with something opaque behind it", () => {
    /**
     * A sticky row is transparent, so the rows scroll straight through
     * it unless the CELLS carry a background. `bg-ink-900/70` — what
     * this used to be — is translucent and did exactly that.
     */
    const header = dataTable.slice(dataTable.indexOf("const HEADER ="));
    const decl = header.slice(0, header.indexOf(";"));
    expect(decl).toMatch(/sticky top-0 z-20 bg-ink-850/);
    // Scoped to HEADER: `bg-ink-900/70` is still correct elsewhere in
    // the file (the Active toggle uses it), and it is only translucent
    // BEHIND A STICKY ROW that it becomes a bug.
    expect(decl).not.toMatch(/bg-ink-900\/70/);
  });

  it("draws the header rule with a shadow, not a collapsed border", () => {
    /**
     * The table is `border-collapse: collapse`, where a border declared
     * on a row belongs to the TABLE rather than the row — so it stays
     * behind when the head pins, and the header loses its underline at
     * exactly the moment it needs one. A shadow is painted by the cell
     * and travels with it.
     */
    expect(dataTable).toMatch(/shadow-\[inset_0_-2px_0_0_color-mix/);
    expect(dataTable).not.toMatch(/border-b-2 border-verdigris-300\/25/);
  });

  it("keeps the pager below the box and pinned", () => {
    expect(dataTable).toMatch(/sticky bottom-0 z-10 bg-ink-850[\s\S]{0,200}Pager/);
  });

  it("measures its own height instead of hard-coding one", () => {
    /**
     * The chrome above and below the rows measured a consistent 392px
     * across three screens, which is tempting to freeze as
     * `calc(100vh - 24.5rem)`. It moves when a subtitle wraps to two
     * lines, when the toolbar wraps, and when the bulk-actions bar
     * appears — and a frozen number leaves the pager half off-screen in
     * exactly those cases.
     */
    expect(box).not.toMatch(/calc\(100vh/);
    expect(box).toMatch(/window\.innerHeight - top - reserve/);
    // The offset is taken in DOCUMENT space. `getBoundingClientRect().top`
    // alone shrinks as the page scrolls, which would shrink the box,
    // which would scroll the page further.
    expect(box).toMatch(/getBoundingClientRect\(\)\.top \+ window\.scrollY/);
  });

  it("re-measures when the things around it move", () => {
    // A window resize is the one case that would have been noticed. The
    // toolbar wrapping and the bulk bar appearing are the two that
    // would not.
    expect(box).toMatch(/new ResizeObserver\(fit\)/);
    expect(box).toMatch(/window\.addEventListener\("resize", fit\)/);
    expect(box).toMatch(/observer\.disconnect\(\)/);
  });

  it("never collapses to nothing on a short window", () => {
    expect(box).toMatch(/MIN_HEIGHT = \d+/);
    expect(box).toMatch(/Math\.max\(MIN_HEIGHT/);
  });

  it("leaves short tables alone in the plain Table", () => {
    /**
     * `sticky` is opt-in. Giving a four-row card its own scroll region
     * adds a scrollbar and reserves height for nothing.
     */
    const ui = src("src/components/admin/ui.tsx");
    expect(ui).toMatch(/sticky = false/);
    expect(src("src/components/admin/UserRoles.tsx")).not.toMatch(/<Table\s+sticky/);
    expect(src("src/app/admin/roles/page.tsx")).toMatch(/<Table sticky/);
  });

  it("does not pin the role matrix's module bands", () => {
    /**
     * Chrome does not confine a sticky table row to its row group.
     * Measured at scrollTop 1100: six module bands pinned at `top: 0`
     * at once, stacked, with paint order deciding which one showed. It
     * reads correctly most of the way down and then lies at the bottom
     * — at maximum scroll the visible band said "package" while the
     * rows beneath it were "storage".
     *
     * The verb row is sticky instead, and the same pile-up is harmless
     * there because every module's verb row carries the same seven
     * words.
     */
    const matrix = src("src/components/admin/RoleMatrix.tsx");
    const from = matrix.indexOf("colSpan={VERBS.length + 2}");
    // The band's own <td>, and not a character further — the verb row
    // that follows it is sticky on purpose.
    const band = matrix.slice(from, matrix.indexOf("</td>", from));
    expect(band).not.toMatch(/sticky/);
    expect(matrix).toMatch(/sticky top-0 z-10 bg-ink-850[\s\S]{0,120}\{v\}/);
  });
});

describe("every list has a bar along the bottom", () => {
  const src = (path: string) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
      .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  const controls = src("src/components/admin/ListControls.tsx");
  const dataTable = src("src/components/admin/DataTable.tsx");

  it("does not vanish when everything fits on one page", () => {
    /**
     * The reported bug. Both pagers began with `if (pages <= 1) return
     * null`, so Warehouse types (6 rows), Vehicle types (13), Countries
     * (1), Expense categories (12), FAQ categories (4), Transporters
     * (3), Vehicles (3), Importers (3) and Sales agents (3) had no
     * footer at all, while the long lists did. A bar that appears and
     * disappears depending on how much data happens to be in the table
     * reads as a rendering fault — and it takes the row count with it.
     */
    expect(controls).not.toMatch(/if \(list\.pages <= 1\) return null/);
    expect(dataTable).not.toMatch(/if \(pages <= 1\) return null/);
  });

  it("says so, rather than rendering an empty bar", () => {
    // Same height, same border, something true written in it.
    expect(controls).toMatch(/on one page/);
    expect(controls).toMatch(/Nothing to show/);
    expect(dataTable).toMatch(/on one page/);
  });

  it("keeps both pagers saying the same thing on a multi-page list", () => {
    // The server pager and the client pager sit in the same slot on
    // different screens; a reader should not be able to tell them apart.
    for (const [name, code] of [
      ["server", controls],
      ["client", dataTable],
    ] as const) {
      expect(code, name).toMatch(/aria-label="Pagination"/);
      expect(code, name).toMatch(/of \{(list\.total|rows)\}/);
      expect(code, name).toMatch(/page \{(list\.page|page)\} of \{(list\.pages|pages)\}/);
    }
  });

  it("gives the two tables with no pagination a footer of their own", () => {
    /**
     * `/admin/roles` and the role matrix are fixed sets — there is
     * nothing to page through — but a card whose table simply stops is
     * the odd one out on a screen where every other list has a bar.
     */
    expect(src("src/app/admin/roles/page.tsx")).toMatch(/sticky bottom-0[\s\S]{0,300}roles/);
    expect(src("src/components/admin/RoleMatrix.tsx")).toMatch(
      /sticky bottom-0[\s\S]{0,300}permissions granted/,
    );
  });

  it("counts dependents with countLabel, not string concatenation", () => {
    // The In use column read "1 warehouses" on every type referenced
    // exactly once, which is most of them.
    const page = src("src/components/admin/MasterPage.tsx");
    expect(page).toMatch(/countLabel\(d\.n, d\.noun\)/);
    expect(page).not.toMatch(/\$\{Number\(r\[`dep_\$\{i\}`\] \?\? 0\)\} \$\{d\.noun\}/);
  });
});
