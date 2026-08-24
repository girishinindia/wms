import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { existsSync, readFileSync } from "node:fs";

vi.mock("server-only", () => ({}));

/**
 * The write rules of the master screens, against a real database.
 *
 * Skipped without TEST_DATABASE_URL, like the other database suites.
 */
const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const canRun = Boolean(url) && process.env.CI_SKIP_DB !== "1";

describe.skipIf(!canRun)("master ops", () => {
  const actor = { session: { userId: 1, email: "admin@test.invalid", firstName: "Ada", lastName: "Admin" } };
  const meta = { requestId: "test", ip: null, userAgent: null };
  let db: Awaited<ReturnType<typeof import("@/db")["getDb"]>>;
  let ops: typeof import("@/lib/admin/master-ops");
  let registry: typeof import("@/lib/admin/master-registry");
  let stateId = 0;
  let cityId = 0;
  let countryId = 0;

  beforeAll(async () => {
    process.env.DATABASE_SSL = "disable";
    process.env.DATABASE_URL = url;
    db = (await import("@/db")).getDb();
    ops = await import("@/lib/admin/master-ops");
    registry = await import("@/lib/admin/master-registry");
    const [c] = await db.execute<{ id: number }>(sql`
      insert into wms.country (iso2, iso3, name, phone_code, currency_code)
      values ('ZZ', 'ZZZ', 'Testland', '+999', 'ZZD') returning id`);
    countryId = c!.id;
    const [s] = await db.execute<{ id: number }>(sql`
      insert into wms.state (country_id, code, name) values (${countryId}, 'ZT', 'Test State') returning id`);
    stateId = s!.id;
    const [ci] = await db.execute<{ id: number }>(sql`
      insert into wms.city (state_id, name) values (${stateId}, 'Testville') returning id`);
    cityId = ci!.id;
  });

  afterAll(async () => {
    await db.execute(sql`delete from wms.city where state_id = ${stateId}`);
    await db.execute(sql`delete from wms.state where id = ${stateId}`);
    await db.execute(sql`delete from wms.country where id = ${countryId}`);
    await (await import("@/db")).getSql().end({ timeout: 2 });
  });

  it("refuses to delete a row something points at, naming what", async () => {
    const r = await ops.deleteOne(registry.MASTER_RESOURCES.states, stateId, actor, meta);
    expect(r).toMatchObject({ ok: false, reason: "in_use", detail: "1 cities" });
    // Still there.
    const rows = await db.execute(sql`select 1 from wms.state where id = ${stateId}`);
    expect(rows.length).toBe(1);
  });

  it("deletes a row nothing points at, and audits it", async () => {
    const r = await ops.deleteOne(registry.MASTER_RESOURCES.cities, cityId, actor, meta);
    expect(r).toEqual({ id: cityId, ok: true });
    expect((await db.execute(sql`select 1 from wms.city where id = ${cityId}`)).length).toBe(0);
    const audit = await db.execute<{ before: { name: string } }>(sql`
      select before from wms.audit_log where action = 'master.city.deleted' and entity_id = ${String(cityId)}`);
    expect(audit[0]?.before?.name).toBe("Testville");
  });

  it("re-adding the same name after a delete works (no soft-delete ghost)", async () => {
    const [ci] = await db.execute<{ id: number }>(sql`
      insert into wms.city (state_id, name) values (${stateId}, 'Testville') returning id`);
    cityId = ci!.id;
    expect(cityId).toBeGreaterThan(0);
  });

  it("switches a row off and reports it is still in use", async () => {
    const r = await ops.setActive(registry.MASTER_RESOURCES.states, stateId, false, actor, meta);
    expect(r).toMatchObject({ ok: true, wasInUse: "1 cities" });
    const back = await ops.setActive(registry.MASTER_RESOURCES.states, stateId, true, actor, meta);
    expect(back).toEqual({ id: stateId, ok: true });
  });

  it("reports not_found for a missing id", async () => {
    expect(await ops.deleteOne(registry.MASTER_RESOURCES.cities, 999999999, actor, meta)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await ops.setActive(registry.MASTER_RESOURCES.cities, 999999999, true, actor, meta)).toMatchObject({ ok: false, reason: "not_found" });
  });
});

// ── The route a list screen links back to ────────────────────────────

/**
 * Every list screen builds its own links: the search form's `action`,
 * the sort headers, the pager, the Clear link. All four read one
 * `base`, and `base` was `/admin/master/${slug}` — hard-coded.
 *
 * Four of the eleven resources are not children of Master. They live at
 * the top level, because that is where the user asked for them:
 * `/admin/faqs`, `/admin/transporters`, `/admin/vehicles`,
 * `/admin/expenses`. So on those four, `base` named a page that does
 * not exist, and the first keystroke in the search box navigated to a
 * 404 — which Next answers by sending the user home.
 *
 * A screen cannot link to itself wrongly if the link comes from the
 * registry and the registry is checked against the filesystem.
 */
describe("where a master screen links back to", () => {
  it("gives every resource a route with a page behind it", async () => {
    const { MASTER_RESOURCES, routeFor } = await import("@/lib/admin/master-registry");
    const missing: string[] = [];
    for (const resource of Object.values(MASTER_RESOURCES)) {
      const route = routeFor(resource);
      const page = new URL(`../src/app${route}/page.tsx`, import.meta.url);
      if (!existsSync(page)) missing.push(`${resource.slug} -> ${route}`);
    }
    expect(missing).toEqual([]);
  });

  it("never hard-codes the master prefix in the list chrome", () => {
    /**
     * The regression itself, in one line. `MasterPage` must ask the
     * registry where the screen lives rather than assuming.
     */
    const page = readFileSync(new URL("../src/components/admin/MasterPage.tsx", import.meta.url), "utf8");
    expect(page).toMatch(/base=\{routeFor\(resource\)\}/);
    expect(page).not.toMatch(/base=\{`\/admin\/master\/\$\{/);
  });

  it("keeps the four top-level screens off the master prefix", async () => {
    const { MASTER_RESOURCES, routeFor } = await import("@/lib/admin/master-registry");
    for (const slug of ["faqs", "transporters", "vehicles", "expenses"] as const) {
      const resource = Object.values(MASTER_RESOURCES).find((r) => r.slug === slug);
      expect(resource, slug).toBeDefined();
      expect(routeFor(resource!), slug).toBe(`/admin/${slug}`);
    }
  });
});

// ── A field that only exists while another is ticked ─────────────────

/**
 * `blacklistReason` is the case this was built for. The box stood open
 * whatever the tick said, and the CHECK on the table guarded one
 * direction only — "blacklisted implies a reason" — so a carrier could
 * carry a reason while not being blacklisted. One in production did.
 *
 * Three places have to agree, and the bug found while testing was that
 * only two of them did: the drawer's FORM gated on `showWhen`, and the
 * view panel — which builds its own list — did not, so the empty "Why
 * blacklisted —" line stayed on every carrier's panel.
 */
describe("showWhen", () => {
  const table = readFileSync(new URL("../src/components/admin/MasterTable.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../src/app/api/v1/admin/master/[resource]/route.ts", import.meta.url), "utf8");

  it("gates BOTH render paths, not just the form", () => {
    // The view panel and the form are separate loops over spec.fields.
    // Whichever one is forgotten is the one the user screenshots.
    expect(table).toMatch(/spec\.fields\.filter\(\(f\) => !hiddenBy\(f, row\.values\)\)/);
    expect(table).toMatch(/hiddenBy\(f, draft\) \? null :/);
  });

  it("sends a switched-off field empty rather than omitting it", () => {
    /**
     * Omitting means "leave whatever is there alone" — the server's
     * optional() preprocessing drops undefined. That is precisely how a
     * cleared tick leaves the reason behind on the row.
     */
    const fn = table.slice(table.indexOf("function payload("), table.indexOf("function payload(") + 900);
    expect(fn).toMatch(/hiddenBy\(field, draft\)/);
    expect(fn).toMatch(/out\[field\.key\] = false/);
    expect(fn).toMatch(/out\[field\.key\] = ""/);
  });

  it("forces null server-side on create AND on update", () => {
    // The browser is not the only way in. Both write loops honour it,
    // or an API client re-creates the row the migration just cleaned.
    expect(route).toMatch(/function switchedOff\(/);
    const uses = route.match(/switchedOff\(/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(3); // definition + create + update
  });

  it("only acts when the controlling field was actually sent", () => {
    /**
     * A PATCH that changes a phone number sends neither the tick nor
     * the reason. Treating "absent" as "off" would wipe the reason off
     * a genuinely blacklisted carrier as a side effect of an unrelated
     * edit.
     */
    expect(route).toMatch(/if \(!\(field\.showWhen\.field in input\)\) return false/);
  });

  it("is declared on the field the screenshot came from", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    const transporter = Object.values(MASTER_RESOURCES).find((r) => r.slug === "transporters");
    const reason = transporter!.fields.find((f) => f.key === "blacklistReason");
    expect(reason!.showWhen).toEqual({ field: "blacklisted", equals: true });
  });

  it("is backed by a symmetric CHECK, not a one-directional one", () => {
    /**
     * The client can be bypassed and the route can be changed; the
     * table is the last line. `blacklisted = (blacklist_reason is not
     * null)` refuses both halves — the old `NOT blacklisted OR ...`
     * refused only one.
     */
    const migration = readFileSync("/tmp/sql/26_blacklist_reason.sql", "utf8");
    expect(migration).toMatch(/check \(blacklisted = \(blacklist_reason is not null\)\)/);
    expect(migration).toMatch(/drop constraint if exists transporter_check/);
  });
});
