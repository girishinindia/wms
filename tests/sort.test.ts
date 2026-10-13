import { describe, expect, it } from "vitest";

import { nextSort, sortRows, type SortState } from "@/components/admin/SortTh";

type Row = { no: string; cartons: number | null; buyer: string };
const ROWS: Row[] = [
  { no: "DN-10", cartons: 5, buyer: "beta" },
  { no: "DN-2", cartons: null, buyer: "Alpha" },
  { no: "DN-1", cartons: 12, buyer: "gamma" },
];
const GET = { no: (r: Row) => r.no, cartons: (r: Row) => r.cartons, buyer: (r: Row) => r.buyer };

describe("column sorting on the hand-built tables", () => {
  it("keeps the screen's order until a heading is clicked", () => {
    expect(sortRows(ROWS, GET, null)).toBe(ROWS);
  });

  it("sorts text naturally (DN-2 before DN-10), then flips, then lets go", () => {
    let s: SortState = nextSort(null, "no");
    expect(sortRows(ROWS, GET, s).map((r) => r.no)).toEqual(["DN-1", "DN-2", "DN-10"]);
    s = nextSort(s, "no");
    expect(sortRows(ROWS, GET, s).map((r) => r.no)).toEqual(["DN-10", "DN-2", "DN-1"]);
    expect(nextSort(s, "no")).toBeNull();
  });

  it("starts numbers at the largest and puts blanks last both ways", () => {
    let s: SortState = nextSort(null, "cartons", true);
    expect(sortRows(ROWS, GET, s).map((r) => r.cartons)).toEqual([12, 5, null]);
    s = nextSort(s, "cartons", true);
    expect(sortRows(ROWS, GET, s).map((r) => r.cartons)).toEqual([5, 12, null]);
  });

  it("ignores upper and lower case", () => {
    expect(sortRows(ROWS, GET, { key: "buyer", dir: "asc" }).map((r) => r.buyer)).toEqual(["Alpha", "beta", "gamma"]);
  });

  it("starts again on a new column", () => {
    expect(nextSort({ key: "no", dir: "desc" }, "buyer")).toEqual({ key: "buyer", dir: "asc" });
  });
});
