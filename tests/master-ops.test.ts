import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

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
