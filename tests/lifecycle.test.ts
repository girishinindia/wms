import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

/**
 * users ⇄ importer ⇄ sales_agent: one life-cycle, both directions.
 *
 * Builds a company with an owner login and one agent with a login,
 * then suspends / reactivates / deletes from each side and checks the
 * other two followed. Against a real database — skipped without one.
 */
const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const canRun = Boolean(url) && process.env.CI_SKIP_DB !== "1";

describe.skipIf(!canRun)("account life-cycle", () => {
  const actor = {
    session: { userId: 1, email: "admin@test.invalid", firstName: "Ada", lastName: "Admin" },
  } as unknown as import("@/lib/auth/guard").Actor;
  const meta = { requestId: "lifecycle-test", ip: null, userAgent: null };
  let db: Awaited<ReturnType<typeof import("@/db")["getDb"]>>;
  let life: typeof import("@/lib/accounts/lifecycle");
  let ownerId = 0;
  let importerId = 0;
  let agentId = 0;
  let agentUserId = 0;
  const tag = `lc${Date.now().toString(36)}`;

  const userStatus = async (id: number) =>
    (await db.execute<{ status: string; deleted: boolean }>(sql`
      select status::text as status, deleted_at is not null as deleted from wms.users where id = ${id}`))[0]!;
  const importerRow = async () =>
    (await db.execute<{ status: string; deleted: boolean }>(sql`
      select status::text as status, deleted_at is not null as deleted from wms.importer where id = ${importerId}`))[0]!;
  const agentRow = async () =>
    (await db.execute<{ is_active: boolean; status: string; deleted: boolean }>(sql`
      select is_active, status::text as status, deleted_at is not null as deleted from wms.sales_agent where id = ${agentId}`))[0]!;

  beforeAll(async () => {
    process.env.DATABASE_SSL = "disable";
    process.env.DATABASE_URL = url;
    db = (await import("@/db")).getDb();
    life = await import("@/lib/accounts/lifecycle");

    const [u] = await db.execute<{ id: number }>(sql`
      insert into wms.users (email, first_name, last_name, mobile, password_hash, password_changed_at, status,
                             email_verified_at, mobile_verified_at)
      values (${`${tag}-owner@test.invalid`}, 'Owner', 'Test', ${"9" + String(Date.now()).slice(-9)}::wms.mobile_in,
              'x', now(), 'ACTIVE', now(), now()) returning id`);
    ownerId = u!.id;
    const [c] = await db.execute<{ id: number }>(sql`
      select id from wms.city where is_active and deleted_at is null limit 1`);
    const [i] = await db.execute<{ id: number }>(sql`
      insert into wms.importer (company_name, legal_name, entity_type, address, city_id, pincode,
                                contact_person, contact_email, contact_mobile, origin, status, kyc_status)
      values (${`${tag} Co`}, ${`${tag} Co Pvt Ltd`}, 'PRIVATE_LIMITED', '1 Test Road', ${c!.id}, '400001',
              'Owner Test', ${`${tag}-owner@test.invalid`}, ${"9" + String(Date.now()).slice(-9)}::wms.mobile_in,
              'SELF_REGISTERED', 'ACTIVE', 'VERIFIED') returning id`);
    importerId = i!.id;
    await db.execute(sql`
      insert into wms.user_role_assignment (user_id, role, role_domain, importer_id, assigned_by, note)
      values (${ownerId}, 'IMPORTER', 'IMPORTER', ${importerId}, 1, 'test')`);
    const [au] = await db.execute<{ id: number }>(sql`
      insert into wms.users (email, first_name, last_name, mobile, password_hash, password_changed_at, status,
                             email_verified_at, mobile_verified_at)
      values (${`${tag}-agent@test.invalid`}, 'Agent', 'Test', ${"8" + String(Date.now()).slice(-9)}::wms.mobile_in,
              'x', now(), 'ACTIVE', now(), now()) returning id`);
    agentUserId = au!.id;
    await db.execute(sql`
      insert into wms.user_role_assignment (user_id, role, role_domain, importer_id, assigned_by, note)
      values (${agentUserId}, 'SALES_AGENT', 'IMPORTER', ${importerId}, ${ownerId}, 'test')`);
    const [a] = await db.execute<{ id: number }>(sql`
      insert into wms.sales_agent (importer_id, user_id, first_name, last_name, mobile, joining_date)
      values (${importerId}, ${agentUserId}, 'Agent', 'Test', ${"8" + String(Date.now()).slice(-9)}::wms.mobile_in, current_date)
      returning id`);
    agentId = a!.id;
  });

  afterAll(async () => {
    // Hard clean-up of the test rows (they are soft-deleted by the end).
    // The audit rows stay: audit_log is append-only by trigger.
    await db.execute(sql`delete from wms.sales_agent where id = ${agentId}`);
    await db.execute(sql`alter table wms.user_role_assignment disable trigger ura_protect_immutable`);
    await db.execute(sql`delete from wms.user_role_assignment where user_id in (${ownerId}, ${agentUserId})`);
    await db.execute(sql`alter table wms.user_role_assignment enable trigger ura_protect_immutable`);
    await db.execute(sql`delete from wms.user_session where user_id in (${ownerId}, ${agentUserId})`);
    await db.execute(sql`delete from wms.importer where id = ${importerId}`);
    await db.execute(sql`delete from wms.users where id in (${ownerId}, ${agentUserId})`);
  });

  it("suspending the owner login suspends the company, its agents and their logins", async () => {
    const linked = await life.applyToUser(ownerId, "SUSPEND", actor, meta, "test");
    expect(linked.importerId).toBe(importerId);
    expect((await userStatus(ownerId)).status).toBe("SUSPENDED");
    expect((await importerRow()).status).toBe("SUSPENDED");
    const a = await agentRow();
    expect(a.is_active).toBe(false);
    expect(a.status).toBe("SUSPENDED");
    expect((await userStatus(agentUserId)).status).toBe("SUSPENDED");
  });

  it("reactivating the company brings everyone back", async () => {
    await life.applyToImporter(importerId, "REACTIVATE", actor, meta, "test");
    expect((await importerRow()).status).toBe("ACTIVE");
    expect((await userStatus(ownerId)).status).toBe("ACTIVE");
    expect((await agentRow()).is_active).toBe(true);
    expect((await userStatus(agentUserId)).status).toBe("ACTIVE");
  });

  it("deactivating an agent profile suspends only that agent's login", async () => {
    await life.applyToAgent(agentId, "SUSPEND", actor, meta, "test");
    expect((await userStatus(agentUserId)).status).toBe("SUSPENDED");
    expect((await userStatus(ownerId)).status).toBe("ACTIVE");
    expect((await importerRow()).status).toBe("ACTIVE");
    await life.applyToAgent(agentId, "REACTIVATE", actor, meta, "test");
    expect((await userStatus(agentUserId)).status).toBe("ACTIVE");
  });

  it("deleting the owner login deletes the company, its agents and their logins", async () => {
    await life.applyToUser(ownerId, "DELETE", actor, meta, "test");
    expect((await userStatus(ownerId)).deleted).toBe(true);
    expect((await importerRow()).deleted).toBe(true);
    expect((await agentRow()).deleted).toBe(true);
    expect((await userStatus(agentUserId)).deleted).toBe(true);
  });
});
