import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { parsePackingList, unitAlias, type Cell } from "@/lib/inward/packing-list";
import { itemSaveSchema, packingRowsSchema } from "@/lib/validation/api-inward";

vi.mock("server-only", () => ({}));

/**
 * Packing lists, as suppliers actually send them. The two fixtures are
 * real sheets (cells only, pictures stripped): one plain, one with a
 * totals row, a #REF! cell, a row with no item number and a row with
 * no description. What is pinned is that every usable row becomes a
 * line with the right numbers, and every unusable one is named.
 */
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/packing-lists.json", import.meta.url), "utf8")) as Record<
  string,
  Cell[][]
>;

describe("a packing list sheet", () => {
  it("reads every row of the plain list, unit from the unnamed column", () => {
    const p = parsePackingList(fixtures["762_AGT.xlsx"]!);
    expect(p.headerRow).toBe(1);
    expect(p.lines).toHaveLength(13);
    expect(p.skipped).toEqual([]);
    expect(p.lines[0]).toMatchObject({ code: "TQ BAG", description: "BAG", cartonQty: 50, piecesPerCarton: 120, unitCode: "PCS", kgPerCarton: 43 });
    expect(p.lines[4]).toMatchObject({ code: "XD306 TINKLE RAZOR", piecesPerCarton: 1200, unitCode: "SET", kgPerCarton: 26.4 });
    expect(p.lines[8]!.unitCode).toBe("JAR");
  });

  it("keeps the totals row out of the lines but reports what it claims", () => {
    const p = parsePackingList(fixtures["980_agt.xlsx"]!);
    expect(p.lines).toHaveLength(32);
    expect(p.sheetTotals).toEqual({ cartons: 980, kg: 17304.5 });
  });

  it("a #REF! total does not lose the row — kg per carton is its own column", () => {
    const p = parsePackingList(fixtures["980_agt.xlsx"]!);
    expect(p.lines[0]).toMatchObject({ code: "5049 WIRE CLIP", cartonQty: 100, kgPerCarton: 21 });
  });

  it("a row with no item number is still a line, just not a catalogue entry", () => {
    const p = parsePackingList(fixtures["980_agt.xlsx"]!);
    const washer = p.lines.find((l) => l.description === "CAR WASHER GUN");
    expect(washer).toMatchObject({ code: null, cartonQty: 50, piecesPerCarton: 10, unitCode: "SET" });
  });

  it("a row with no description falls back to its item number", () => {
    const p = parsePackingList(fixtures["980_agt.xlsx"]!);
    expect(p.lines.find((l) => l.code === "GUN")?.description).toBe("GUN");
  });

  it("derives per-carton figures when the sheet only has totals", () => {
    const p = parsePackingList([
      ["Item", "Description", "Cartons", "Total Qty", "Total Kg"],
      ["A1", "Widget", 10, 1200, 250],
    ]);
    expect(p.lines[0]).toMatchObject({ cartonQty: 10, piecesPerCarton: 120, kgPerCarton: 25 });
  });

  it("names what a bad row is missing, and the header it could not find", () => {
    const p = parsePackingList([
      ["ITEM NO", "DESCRIBE", "CTN", "QTY", "KG"],
      ["X1", "No cartons", null, 10, 2],
      ["X2", "No weight", 5, 10, null],
    ]);
    expect(p.lines).toEqual([]);
    expect(p.skipped).toEqual([
      { row: 2, reason: "Missing cartons" },
      { row: 3, reason: "Missing kg per carton" },
    ]);
    expect(parsePackingList([["just", "some", "text"]]).skipped[0]!.reason).toMatch(/No header row/);
  });

  it("a PDF squeezes the unit into the QTY cell; it is still read", () => {
    const p = parsePackingList([
      ["ITEM NO", "DESCRIBE", "CTN", "QTY", "TT.QTY", "KG", "TT.KG"],
      ["TQ BAG", "BAG", "50", "120 PCS", "6000", "43", "2150"],
    ]);
    expect(p.lines[0]).toMatchObject({ piecesPerCarton: 120, unitCode: "PCS" });
  });

  it("maps the words suppliers use onto the register", () => {
    expect(unitAlias("pcs")).toBe("PCS");
    expect(unitAlias("Pieces")).toBe("PCS");
    expect(unitAlias("SETS")).toBe("SET");
    expect(unitAlias("pkts")).toBe("PKT");
    expect(unitAlias("bottle")).toBe("BOTTLE");
    expect(unitAlias(null)).toBeNull();
  });
});

describe("the catalogue item", () => {
  it("takes the importer's own code, or none to be minted", () => {
    expect(itemSaveSchema.parse({ code: " 5049 wire clip ", description: "Cloth clip" }).code).toBe("5049 wire clip");
    expect(itemSaveSchema.parse({ code: "", description: "Cloth clip" }).code).toBeNull();
    expect(itemSaveSchema.safeParse({ code: "bad;code", description: "x y" }).success).toBe(false);
    expect("hsnCode" in itemSaveSchema.shape).toBe(false);
  });

  it("an import body is a sheet of cells, nothing else", () => {
    expect(packingRowsSchema.safeParse({ rows: [["ITEM NO", 1, null]] }).success).toBe(true);
    expect(packingRowsSchema.safeParse({ rows: [] }).success).toBe(false);
    expect(packingRowsSchema.safeParse({ rows: [[{ evil: true }]] }).success).toBe(false);
  });
});

describe("the SQL pack", () => {
  const sql = readFileSync(new URL("../../sql/30_item_code.sql", import.meta.url), "utf8");
  it("drops HSN and makes the code unique per importer regardless of case", () => {
    expect(sql).toMatch(/drop column if exists hsn_code/);
    expect(sql).toMatch(/on item \(importer_id, upper\(btrim\(code\)\)\)\s+where deleted_at is null/);
  });
});
