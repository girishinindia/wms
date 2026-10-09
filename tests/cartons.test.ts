import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth/guard";
import { cartonNo, cartonNoFromScan, initials, kg, qrText, type LabelData } from "@/lib/inward/carton-format";
import { cartonCan } from "@/lib/inward/cartons";

/**
 * Cartons: the number, what the QR says, reading a scan back, and who may
 * touch it. The scan rules themselves (first scan wins, duplicates never
 * count) live in SQL `where status in (...)` and are exercised end to end.
 */

const actorWith = (permissions: { permission: string; scope: "OWN" | "WAREHOUSE" | "ALL"; warehouseIds?: number[] }[]) =>
  ({
    session: { userId: 1, email: "x@test.invalid", firstName: "X", lastName: "Y" },
    roles: [],
    permissions: permissions.map((p) => ({ warehouseIds: [], importerIds: [], ...p })),
    isSuperAdmin: false,
  }) as unknown as Actor;

const label: LabelData = {
  cartonNo: "INR-000006-0101",
  seq: 101,
  total: 872,
  inwardCode: "INR-000006",
  warehouseName: "Bhiwandi Central",
  importerName: "Acme Imports Pvt Ltd",
  importerMobile: "9876543210",
  importerEmail: "info@acme.in",
  importerLogoUrl: null,
  itemCode: "CM72PC",
  description: "Hair rubber 72pc in a pkt",
  piecesPerCarton: 200,
  unitCode: "PKT",
  kgPerCarton: 13,
  vehicle: "GJ05AB1234",
  driverName: "Ramesh Yadav",
  driverMobile: "9876543211",
};

describe("carton numbers", () => {
  it("are the inward number and a four-digit count, growing past 9999", () => {
    expect(cartonNo("INR-000006", 1)).toBe("INR-000006-0001");
    expect(cartonNo("INR-000006", 872)).toBe("INR-000006-0872");
    expect(cartonNo("INR-000006", 12345)).toBe("INR-000006-12345");
  });
});

describe("the QR", () => {
  const q = qrText(label);

  it("carries every field asked for, as lines a phone can show", () => {
    for (const bit of [
      "Carton: INR-000006-0101",
      "Importer: Acme Imports Pvt Ltd",
      "Mobile: 9876543210",
      "Email: info@acme.in",
      "Item: CM72PC - Hair rubber 72pc in a pkt",
      "Pcs/Carton: 200 PKT",
      "KG: 13",
      "Vehicle: GJ05AB1234",
      "Driver: Ramesh Yadav (9876543211)",
    ]) {
      expect(q).toContain(bit);
    }
  });

  it("stays small enough to scan off a 40 mm sticker", () => {
    expect(q.length).toBeLessThan(330);
    const long = qrText({ ...label, description: "x".repeat(400), importerName: "y".repeat(200), importerEmail: "z".repeat(200) });
    expect(long.length).toBeLessThan(400);
  });

  it("reads the carton back from a full QR, a typed number, or noise", () => {
    expect(cartonNoFromScan(q)).toBe("INR-000006-0101");
    expect(cartonNoFromScan("inr-000006-0101")).toBe("INR-000006-0101");
    expect(cartonNoFromScan("  INR-000006-0101\n")).toBe("INR-000006-0101");
    // The inward line alone is not a carton.
    expect(cartonNoFromScan("Inward: INR-000006")).toBeNull();
    expect(cartonNoFromScan("hello")).toBeNull();
    expect(cartonNoFromScan("")).toBeNull();
  });

  it("writes weights the way people do", () => {
    expect(kg(13)).toBe("13");
    expect(kg(6.5)).toBe("6.5");
    expect(kg(8.125)).toBe("8.125");
  });

  it("falls back to initials when there is no logo", () => {
    expect(initials("Acme Imports Pvt Ltd")).toBe("AI");
    expect(initials("Zenvora")).toBe("ZE");
  });
});

describe("who works the cartons", () => {
  const superAdmin = actorWith([
    { permission: "inward.goods.update", scope: "ALL" },
    { permission: "inward.goods.create", scope: "ALL" },
  ]);
  const dock = actorWith([
    { permission: "inward.goods.update", scope: "WAREHOUSE", warehouseIds: [5] },
    { permission: "inward.goods.create", scope: "WAREHOUSE", warehouseIds: [5] },
  ]);
  const importer = actorWith([{ permission: "inward.goods.read", scope: "OWN" }]);
  const row = (status: string, warehouseId = 5) => ({ status: status as never, warehouseId });

  it("super admin and the request's own warehouse, once acknowledged", () => {
    expect(cartonCan(superAdmin, row("ACKNOWLEDGED"))).toEqual({ view: true, generate: true, work: true });
    expect(cartonCan(dock, row("IN_PROCESS"))).toEqual({ view: true, generate: true, work: true });
  });

  it("another warehouse, the importer, and early or closed requests get nothing to do", () => {
    expect(cartonCan(dock, row("ACKNOWLEDGED", 6))).toEqual({ view: false, generate: false, work: false });
    expect(cartonCan(importer, row("ACKNOWLEDGED"))).toEqual({ view: false, generate: false, work: false });
    expect(cartonCan(superAdmin, row("SUBMITTED"))).toEqual({ view: false, generate: false, work: false });
    expect(cartonCan(superAdmin, row("COMPLETED"))).toEqual({ view: true, generate: false, work: false });
  });
});

describe("the SQL", () => {
  const s = readFileSync(new URL("../../sql/32_inward_cartons.sql", import.meta.url), "utf8");
  it("never reuses a number and keeps every scan", () => {
    expect(s).toMatch(/carton_no\s+text not null unique/);
    expect(s).toMatch(/client_scan_id\s+text unique/);
    expect(s).toMatch(/'RECEIVED','DUPLICATE','OTHER_REQUEST','UNKNOWN','HOLD','RELEASED'/);
  });
  it("adds the logo to the importer and touches nothing else", () => {
    expect(s).toMatch(/alter table importer add column if not exists logo_url text/);
    expect(s.match(/^\s*alter table/gim)).toHaveLength(1);
    expect(s).not.toMatch(/^\s*drop /im);
  });
});
