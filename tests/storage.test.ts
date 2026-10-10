import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { floorCode, galaCode, galaFromScan, galaFullId, galaQrText } from "@/lib/storage/location-format";
import { ADMIN_NAV_ITEMS, visibleNav } from "@/components/admin/nav";

/**
 * Storage: warehouse › floor › gala, nothing deeper. Floors F1, F2…;
 * galas F1-G01…; the QR carries the warehouse code as well.
 */
describe("floor and gala codes", () => {
  it("are short and padded the same way everywhere", () => {
    expect(floorCode(1)).toBe("F1");
    expect(galaCode(1, 2)).toBe("F1-G02");
    expect(galaCode(12, 7)).toBe("F12-G07");
    expect(galaCode(1, 120)).toBe("F1-G120");
    expect(galaFullId("WH-0001", "F1-G02")).toBe("WH-0001-F1-G02");
  });

  it("the QR reads like a label and parses back", () => {
    const qr = galaQrText({ warehouseCode: "WH-0001", warehouseName: "Bhiwandi Central", floorNo: 1, galaNo: 2, code: "F1-G02" });
    expect(qr.split("\n")[0]).toBe("Gala: WH-0001-F1-G02");
    expect(qr).toContain("Floor 1 · Gala 2");
    expect(galaFromScan(qr)).toEqual({ warehouseCode: "WH-0001", code: "F1-G02" });
  });

  it("works for any warehouse code, and for a typed gala", () => {
    expect(galaFromScan("Gala: BOM-01-F2-G10")).toEqual({ warehouseCode: "BOM-01", code: "F2-G10" });
    expect(galaFromScan("f1-g2")).toEqual({ warehouseCode: null, code: "F1-G02" });
    expect(galaFromScan("F3G07")).toEqual({ warehouseCode: null, code: "F3-G07" });
  });

  it("never mistakes a carton sticker for a gala", () => {
    expect(galaFromScan("Carton: INR-000006-0001\nInward: INR-000006")).toBeNull();
    expect(galaFromScan("INR-000006-0001")).toBeNull();
    expect(galaFromScan("")).toBeNull();
  });
});

describe("who stores", () => {
  const labels = (set: { permission: string; scope: "OWN" | "WAREHOUSE" | "ALL" }[]) => visibleNav(set).map((i) => i.label);

  it("the storage manager and warehouse admin get both entries; an importer neither", () => {
    expect(labels([{ permission: "storage.goods.update", scope: "WAREHOUSE" }])).toEqual(
      expect.arrayContaining(["Store cartons", "Floors and galas"]),
    );
    expect(labels([{ permission: "storage.goods.read", scope: "OWN" }, { permission: "storage.goods.update", scope: "OWN" }])).not.toContain(
      "Store cartons",
    );
    expect(ADMIN_NAV_ITEMS.find((i) => i.href === "/admin/storage")?.permission).toBe("storage.goods.update");
  });

  it("the schema keeps the shape to floors and galas, and history for every move", () => {
    const sql = readFileSync(new URL("../../sql/34_storage_locations.sql", import.meta.url), "utf8");
    expect(sql).toContain("create table if not exists warehouse_floor");
    expect(sql).toContain("create table if not exists warehouse_gala");
    expect(sql).toContain("create table if not exists carton_movement");
    expect(sql).not.toMatch(/\b(zone|rack)\b.*\bnot null\b/i);
  });

  it("renaming, switching off and deleting are the super admin's and warehouse admin's, not the storage manager's", () => {
    const sql = readFileSync(new URL("../../sql/35_location_rights.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/delete from role_permission\s+where role = 'STORAGE_MANAGER' and permission = 'warehouse.location.update'/);
    expect(sql).toContain("('WAREHOUSE_ADMIN', 'warehouse.location.delete', 'WAREHOUSE')");
    expect(sql).not.toMatch(/STORAGE_MANAGER', 'warehouse.location.(update|delete)/);
  });
});
