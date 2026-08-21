import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * A super admin correcting an importer's record.
 *
 * The schema half runs anywhere. The rest needs a real database, because
 * every rule worth testing here is a rule about what the database would
 * otherwise refuse: the partial unique indexes on company name, GSTIN and
 * PAN, and `importer_complete_before_active`.
 */

describe("update schema: an empty box clears the column", () => {
  it("maps \"\" to null on the fields the database allows to be null", async () => {
    const { updateImporterRequestSchema } = await import("@/lib/validation/api-admin");
    const parsed = updateImporterRequestSchema.parse({
      tradeName: "",
      gstin: "",
      landmark: "",
      alternateMobile: "",
      notes: "",
    });
    expect(parsed).toEqual({
      tradeName: null,
      gstin: null,
      landmark: null,
      alternateMobile: null,
      notes: null,
    });
  });

  it("leaves out what was not sent, so a patch touches nothing else", async () => {
    const { updateImporterRequestSchema } = await import("@/lib/validation/api-admin");
    expect(updateImporterRequestSchema.parse({})).toEqual({});
    expect(Object.keys(updateImporterRequestSchema.parse({ companyName: "Acme Traders" }))).toEqual([
      "companyName",
    ]);
  });

  it("still validates what IS sent", async () => {
    const { updateImporterRequestSchema } = await import("@/lib/validation/api-admin");
    expect(updateImporterRequestSchema.safeParse({ gstin: "NOPE" }).success).toBe(false);
    expect(updateImporterRequestSchema.safeParse({ contactMobile: "12345" }).success).toBe(false);
    expect(updateImporterRequestSchema.safeParse({ address: "@@## !!" }).success).toBe(false);
  });
});

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const canRun = Boolean(url) && process.env.CI_SKIP_DB !== "1";

describe.skipIf(!canRun)("updateImporterAsAdmin", () => {
  const actor = {
    session: { userId: 1, email: "admin@test.invalid", firstName: "Ada", lastName: "Admin" },
  } as unknown as import("@/lib/auth/guard").Actor;
  const meta = { requestId: "importer-update-test", ip: null, userAgent: null };
  let db: ReturnType<typeof import("@/db")["getDb"]>;
  let mod: typeof import("@/lib/importer/update");
  let ownerId = 0;
  let activeId = 0;
  let pendingId = 0;
  const tag = `iu${Date.now().toString(36)}`;
  const mobile = (prefix: string) => `${prefix}${String(Date.now()).slice(-9)}`;

  const row = async (id: number) =>
    (await db.execute<{
      company_name: string;
      trade_name: string | null;
      landmark: string | null;
      notes: string | null;
      updated_by: number | null;
    }>(sql`
      select company_name, trade_name, landmark, notes, updated_by
        from wms.importer where id = ${id}`))[0]!;

  beforeAll(async () => {
    process.env.DATABASE_SSL = "disable";
    process.env.DATABASE_URL = url;
    db = (await import("@/db")).getDb();
    mod = await import("@/lib/importer/update");

    const [c] = await db.execute<{ id: number }>(sql`
      select id from wms.city where is_active and deleted_at is null limit 1`);
    const [u] = await db.execute<{ id: number }>(sql`
      insert into wms.users (email, first_name, last_name, mobile, password_hash,
                             password_changed_at, status, email_verified_at, mobile_verified_at)
      values (${`${tag}-owner@test.invalid`}, 'Owner', 'Test', ${mobile("9")}::wms.mobile_in,
              'x', now(), 'ACTIVE', now(), now()) returning id`);
    ownerId = u!.id;

    // Verified, with a linked owner — the normal case.
    const [a] = await db.execute<{ id: number }>(sql`
      insert into wms.importer (company_name, legal_name, entity_type, address, city_id, pincode,
                                gstin, pan, trade_name, landmark, notes,
                                contact_person, contact_email, contact_mobile, origin, status, kyc_status,
                                created_by)
      values (${`${tag} Active Co`}, ${`${tag} Active Co Pvt Ltd`}, 'PRIVATE_LIMITED', '1 Test Road',
              ${c!.id}, '400001', ${`27AAAAA${String(Date.now()).slice(-4)}A1Z9`}::wms.gstin,
              ${`AAAAA${String(Date.now()).slice(-4)}A`}::wms.pan_no, 'Old trade name', 'Near the old post office',
              'first note', 'Owner Test', ${`${tag}-owner@test.invalid`}, ${mobile("9")}::wms.mobile_in,
              'CREATED_BY_ADMIN', 'ACTIVE', 'VERIFIED', 1) returning id`);
    activeId = a!.id;
    await db.execute(sql`
      insert into wms.user_role_assignment (user_id, role, role_domain, importer_id, assigned_by, note)
      values (${ownerId}, 'IMPORTER', 'IMPORTER', ${activeId}, 1, 'test')`);

    // A self-registration that has not verified yet: no role assignment,
    // so `pendingImporterFor` can only find it by contact_email.
    const [p] = await db.execute<{ id: number }>(sql`
      insert into wms.importer (company_name, contact_person, contact_email, contact_mobile,
                                origin, status, kyc_status)
      values (${`${tag} Pending Co`}, 'Pending Person', ${`${tag}-pending@test.invalid`},
              ${mobile("8")}::wms.mobile_in, 'SELF_REGISTERED', 'PENDING', 'NOT_STARTED') returning id`);
    pendingId = p!.id;
  });

  afterAll(async () => {
    await db.execute(sql`alter table wms.user_role_assignment disable trigger ura_protect_immutable`);
    await db.execute(sql`delete from wms.user_role_assignment where user_id = ${ownerId}`);
    await db.execute(sql`alter table wms.user_role_assignment enable trigger ura_protect_immutable`);
    await db.execute(sql`delete from wms.importer where id in (${activeId}, ${pendingId})`);
    await db.execute(sql`delete from wms.users where id = ${ownerId}`);
  });

  it("writes the fields sent, clears the ones sent empty, and leaves the rest alone", async () => {
    const after = await mod.updateImporterAsAdmin(
      activeId,
      { companyName: `${tag} Renamed Co`, tradeName: null, notes: "second note" },
      actor,
      meta,
    );
    expect(after.profile.companyName).toBe(`${tag} Renamed Co`);
    const r = await row(activeId);
    expect(r.trade_name).toBeNull();
    expect(r.notes).toBe("second note");
    // Untouched, though it sits between the two that changed.
    expect(r.landmark).toBe("Near the old post office");
    expect(r.updated_by).toBe(1);
  });

  it("refuses a company name that belongs to another importer, on the field", async () => {
    const attempt = mod.updateImporterAsAdmin(
      activeId,
      { companyName: `${tag} Pending Co` },
      actor,
      meta,
    );
    await expect(attempt).rejects.toMatchObject({
      kind: "CONFLICT",
      fields: { companyName: expect.stringContaining("Already registered") },
    });
    // And nothing was written.
    expect((await row(activeId)).company_name).toBe(`${tag} Renamed Co`);
  });

  it("will not empty a required field on a company that is no longer pending", async () => {
    const attempt = mod.updateImporterAsAdmin(activeId, { legalName: null }, actor, meta);
    await expect(attempt).rejects.toMatchObject({
      kind: "VALIDATION_FAILED",
      fields: { legalName: expect.any(String) },
    });
  });

  it("does not invent requirements the check constraint does not have", async () => {
    // GSTIN and PAN are NOT in importer_complete_before_active. Measuring
    // against PROFILE_REQUIRED instead would refuse every edit to the
    // companies that were verified before those two were asked for —
    // which is most of the ones already in the database.
    const cleared = await mod.updateImporterAsAdmin(activeId, { pan: null }, actor, meta);
    expect(cleared.profile.pan).toBeUndefined();
    const again = await mod.updateImporterAsAdmin(
      activeId,
      { landmark: "Behind the new depot" },
      actor,
      meta,
    );
    expect(again.profile.landmark).toBe("Behind the new depot");
  });

  it("allows the same field to be emptied while the row is still pending", async () => {
    const after = await mod.updateImporterAsAdmin(pendingId, { legalName: null }, actor, meta);
    expect(after.profile.legalName).toBeUndefined();
  });

  it("holds the contact email of an unverified self-registration", async () => {
    const attempt = mod.updateImporterAsAdmin(
      pendingId,
      { contactEmail: `${tag}-moved@test.invalid` },
      actor,
      meta,
    );
    await expect(attempt).rejects.toMatchObject({
      kind: "VALIDATION_FAILED",
      fields: { contactEmail: expect.any(String) },
    });
  });

  it("lets the contact email move once the account is linked", async () => {
    const after = await mod.updateImporterAsAdmin(
      activeId,
      { contactEmail: `${tag}-billing@test.invalid` },
      actor,
      meta,
    );
    expect(after.profile.contactEmail).toBe(`${tag}-billing@test.invalid`);
  });

  it("says so when the body changes nothing", async () => {
    await expect(mod.updateImporterAsAdmin(activeId, {}, actor, meta)).rejects.toMatchObject({
      kind: "VALIDATION_FAILED",
    });
  });

  it("leaves an audit row naming only the fields that moved", async () => {
    const [audit] = await db.execute<{ before: Record<string, unknown>; after: Record<string, unknown> }>(sql`
      select before, after
        from wms.audit_log
       where action = 'importer.updated' and entity_id = ${String(activeId)}
       order by id desc limit 1`);
    expect(Object.keys(audit!.after)).toEqual(["contactEmail"]);
    expect(audit!.before.contactEmail).toBe(`${tag}-owner@test.invalid`);
  });
});
