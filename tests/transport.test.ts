import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Transporters and vehicles are the first rows on this machinery whose
 * warehouse is not a column on the row. These are the things that are
 * specific to that, and silent when they go wrong.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the shape of a carrier record", () => {
  it("is scoped through a join table, not a column", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    const t = MASTER_RESOURCES.transporters;
    /**
     * A carrier serves several sites, which is why
     * `warehouse_transporter` exists. `scope.column` would be a lie
     * about the schema and would silently match nothing.
     */
    expect(t.scope?.column).toBeUndefined();
    expect(t.scope?.via?.table).toBe("warehouse_transporter");
    expect(t.scope?.via?.localColumn).toBe("id");
  });

  it("reaches the join table through the owner for a vehicle", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    const v = MASTER_RESOURCES.vehicles;
    // One hop further: a lorry's sites are its transporter's, which is
    // the whole difference between the two — `localColumn`.
    expect(v.scope?.via?.localColumn).toBe("transporter_id");
    expect(v.scope?.via?.linkColumn).toBe("transporter_id");
    expect(v.pivot).toBeUndefined();
  });

  it("maps the Active switch onto status, because there is no is_active", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    for (const slug of ["transporters", "vehicles"] as const) {
      expect(MASTER_RESOURCES[slug].statusColumn?.column, slug).toBe("status");
      expect(MASTER_RESOURCES[slug].statusColumn?.activeValue, slug).toBe("ACTIVE");
    }
    // And the schema really has no such column on either table.
    const schema = read("../sql/24_transport.sql");
    expect(schema).not.toContain("add column is_active");
  });

  it("is never erased", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    expect(MASTER_RESOURCES.transporters.softDeleteOnly).toBe(true);
    expect(MASTER_RESOURCES.vehicles.softDeleteOnly).toBe(true);
  });
});

describe("the menu trap", () => {
  it("keys both entries on create, never read", async () => {
    const { TRANSPORT_ITEMS } = await import("@/components/admin/nav");
    /**
     * `transporter.read` and `vehicle.read` were granted to IMPORTER and
     * SALES_AGENT at ALL scope by the seed. An entry keyed on read would
     * have put the carrier register — contact mobiles, GSTIN, PAN — in
     * every customer's sidebar.
     */
    for (const item of TRANSPORT_ITEMS) {
      expect(item.permission, item.label).toMatch(/\.create$/);
    }
  });

  it("is not allOnly, because two of its four roles are warehouse-scoped", async () => {
    const { TRANSPORT_ITEMS, visibleNav } = await import("@/components/admin/nav");
    for (const item of TRANSPORT_ITEMS) {
      expect(item.allOnly, item.label).toBeUndefined();
    }
    // A transporter manager holds it at WAREHOUSE and must get in.
    const manager = [
      { permission: "transporter.create", scope: "WAREHOUSE" as const },
      { permission: "vehicle.create", scope: "WAREHOUSE" as const },
    ];
    expect(visibleNav(manager).map((i) => i.href)).toContain("/admin/transporters");
  });

  it("revokes the grants rather than relying on the menu", () => {
    // The menu is not the control; the grant is. A hidden link is still
    // a URL somebody can type.
    const sql = read("../sql/24_transport.sql");
    expect(sql).toContain("delete from role_permission");
    expect(sql).toContain("'IMPORTER', 'SALES_AGENT'");
  });

  it("sits above FAQs and outside Master", async () => {
    const { ADMIN_NAV } = await import("@/components/admin/nav");
    const labels = ADMIN_NAV.map((n) => n.label);
    expect(labels.indexOf("Transporters & Vehicles")).toBeGreaterThan(labels.indexOf("Master"));
    expect(labels.indexOf("Transporters & Vehicles")).toBeLessThan(labels.indexOf("FAQs"));
  });
});

describe("a number plate", () => {
  it("is normalised, because people type the spaces they read", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    const base = { transporterId: 1, vehicleTypeId: 1 };
    for (const typed of ["MH 04 AB 1234", "mh-04-ab-1234", "MH04AB1234"]) {
      const parsed = MASTER_RESOURCES.vehicles.createSchema.parse({
        ...base,
        registrationNumber: typed,
      }) as { registrationNumber: string };
      // Otherwise the unique index treats three spellings as three
      // different lorries.
      expect(parsed.registrationNumber, typed).toBe("MH04AB1234");
    }
  });

  it("refuses something too short to be one", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    expect(
      MASTER_RESOURCES.vehicles.createSchema.safeParse({
        transporterId: 1,
        vehicleTypeId: 1,
        registrationNumber: "MH04",
      }).success,
    ).toBe(false);
  });
});

describe("blacklisting", () => {
  it("insists on a reason, under the field rather than as a constraint name", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    const base = {
      code: "ABC",
      name: "A Carrier",
      contactPerson: "A Person",
      contactMobile: "9820011122",
    };
    const bad = MASTER_RESOURCES.transporters.createSchema.safeParse({
      ...base,
      blacklisted: true,
    });
    expect(bad.success).toBe(false);
    expect(bad.success ? [] : bad.error.issues.map((i) => i.path.join("."))).toContain(
      "blacklistReason",
    );
    expect(
      MASTER_RESOURCES.transporters.createSchema.safeParse({
        ...base,
        blacklisted: true,
        blacklistReason: "Two loads arrived damaged",
      }).success,
    ).toBe(true);
  });
});

describe("the pivot", () => {
  it("only ever deletes links to sites the caller holds", () => {
    /**
     * The drawer submits the whole set, and a scoped caller's set
     * necessarily carries links to branches they cannot see. Deleting on
     * the difference alone would unhook another branch's carrier as a
     * side effect of saving your own.
     */
    const source = code("src/app/api/v1/admin/master/[resource]/route.ts");
    const fn = source.slice(source.indexOf("async function writePivot"));
    expect(fn).toContain("const removable");
    expect(fn).toContain("mine.includes");
  });

  it("checks only what is being added on an edit", () => {
    // Refusing carried-through ids meant a site-2 manager could never
    // unhook a shared carrier from site 2 — their own submission was
    // rejected for containing sites 1 and 5.
    const source = code("src/app/api/v1/admin/master/[resource]/route.ts");
    expect(source).toContain("const added = pivotWanted.filter");
  });

  it("counts a links-only change as a change", () => {
    const source = code("src/app/api/v1/admin/master/[resource]/route.ts");
    expect(source).toContain("sets.length === 0 && pivotWanted === null");
  });
});

describe("the pickers ask each table how it says active", () => {
  it("resolves the column from the registry rather than assuming is_active", async () => {
    const { activeColumnFor } = await import("@/lib/admin/master-registry");
    // `transporter` carries the record_status enum; `city` a boolean.
    expect(activeColumnFor("transporter")).toEqual({ column: "status", activeValue: "ACTIVE" });
    expect(activeColumnFor("city")).toBeNull();
  });

  it("uses it wherever a picker filters on active", () => {
    for (const path of [
      "src/app/api/v1/admin/master/[resource]/route.ts",
      "src/components/admin/MasterPage.tsx",
    ]) {
      expect(code(path), path).toContain("activeColumnFor(");
    }
  });
});

describe("an optional parent", () => {
  it("is allowed to be missing", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    // A carrier is often added off a phone call before anybody knows
    // where its office is. The route used to look the parent up
    // unconditionally, which turned a missing city into `where id =`.
    expect(MASTER_RESOURCES.transporters.parent?.optional).toBe(true);
    expect(
      MASTER_RESOURCES.transporters.createSchema.safeParse({
        code: "ABC",
        name: "A Carrier",
        contactPerson: "A Person",
        contactMobile: "9820011122",
      }).success,
    ).toBe(true);
  });

  it("is guarded in the route", () => {
    const source = code("src/app/api/v1/admin/master/[resource]/route.ts");
    expect(source).toContain("resource.parent && input[resource.parent.key] !== undefined");
  });
});

describe("the count line", () => {
  it("says one transporter, not one transporters", async () => {
    const { countLabel } = await import("@/lib/admin/listing");
    expect(countLabel(1, "transporters", "transporter")).toBe("1 transporter");
    expect(countLabel(3, "transporters", "transporter")).toBe("3 transporters");
    expect(countLabel(0, "transporters", "transporter")).toBe("0 transporters");
  });

  it("falls back sensibly when no singular was given", async () => {
    const { countLabel } = await import("@/lib/admin/listing");
    expect(countLabel(1, "countries")).toBe("1 country");
    expect(countLabel(1, "FAQs")).toBe("1 FAQ");
    expect(countLabel(1, "expenses")).toBe("1 expense");
    expect(countLabel(1, "users")).toBe("1 user");
  });

  it("does not pretend to know English", async () => {
    const { countLabel } = await import("@/lib/admin/listing");
    /**
     * "boxes" → "boxe" is wrong, and knowingly so: nothing in the plural
     * says whether it lost one letter or two, and a rule that guessed
     * turned "expenses" into "expens". Callers with an awkward noun pass
     * `singular` — which every master screen does.
     */
    expect(countLabel(1, "boxes")).toBe("1 boxe");
    expect(countLabel(1, "boxes", "box")).toBe("1 box");
  });

  it("is used by both toolbars", async () => {
    for (const path of [
      "src/components/admin/ListControls.tsx",
      "src/components/admin/DataTable.tsx",
    ]) {
      expect(code(path), path).toContain("countLabel(");
    }
  });
});
