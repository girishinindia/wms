import { describe, expect, it } from "vitest";

import {
  activeFilterCount,
  applyBoard,
  EMPTY_FILTERS,
  filtersFromParams,
  filtersToParams,
  optionsOf,
  todayIST,
  type BoardFilters,
} from "@/lib/inward/board";
import type { BoardRow } from "@/lib/inward/ops";

/** The inward list filters on the screen — what each filter keeps. */

const row = (p: Partial<BoardRow> & { id: number }): BoardRow =>
  ({
    code: `INR-${String(p.id).padStart(6, "0")}`,
    status: "SUBMITTED",
    statusLabel: "Submitted",
    importer: { id: 1, code: "IMP-1", name: "Acme Imports" },
    warehouse: { id: 5, code: "BOM-01", name: "Bhiwandi 1" },
    containerNumber: "MSKU1234567",
    containerType: { id: 1, code: "40HC", name: "40 ft High Cube" },
    port: { id: 1, code: "INNSA", name: "Nhava Sheva" },
    expectedArrival: "2026-10-15",
    remarks: null,
    transporter: { id: 9, name: "Speedy Roadways", mobile: null, status: "ACTIVE" },
    vehicle: { id: 3, registrationNumber: "MH04AB1234", typeName: null, capacityKg: null },
    driver: { id: 4, name: "Ramesh Patel", mobile: null, licenceNumber: null },
    totals: { cartons: 10, pieces: 100, kg: 50, lines: 1 },
    documents: 0,
    needsChangesNote: null,
    submittedAt: null,
    acknowledgedAt: null,
    completedAt: null,
    cancelledAt: null,
    lastStatusAt: null,
    createdAt: `2026-10-0${p.id % 9 || 1} 10:00:00+00`,
    updatedAt: "2026-10-09 10:00:00+00",
    cartonCounts: { generated: 0, printed: 0, received: 0, hold: 0, stored: 0 },
    find: "",
    ...p,
  }) as BoardRow;

const withFind = (r: BoardRow): BoardRow => ({
  ...r,
  find: [r.code, r.containerNumber, r.importer.name, r.warehouse.name, r.transporter?.name, r.vehicle?.registrationNumber, r.driver?.name, "5049 wire clip"]
    .join(" ")
    .toLowerCase(),
});

const rows = [
  row({ id: 1, status: "SUBMITTED", expectedArrival: "2026-10-11" }),
  row({ id: 2, status: "ACKNOWLEDGED", expectedArrival: "2026-10-09", cartonCounts: { generated: 0, printed: 0, received: 0, hold: 0, stored: 0 } }),
  row({ id: 3, status: "IN_PROCESS", expectedArrival: "2026-10-12", cartonCounts: { generated: 10, printed: 10, received: 4, hold: 1, stored: 2 }, totals: { cartons: 980, pieces: 1, kg: 1, lines: 1 } }),
  row({ id: 4, status: "COMPLETED", expectedArrival: "2026-10-01", cartonCounts: { generated: 10, printed: 10, received: 10, hold: 0, stored: 10 } }),
  row({ id: 5, status: "DRAFT", expectedArrival: null, containerNumber: "TEST1234567", warehouse: { id: 7, code: "WH-0099", name: "Surat" } }),
  row({ id: 6, status: "CANCELLED", importer: { id: 2, code: "IMP-2", name: "Zenith Traders" }, transporter: null }),
  row({ id: 7, status: "ACKNOWLEDGED", cartonCounts: { generated: 20, printed: 5, received: 0, hold: 0, stored: 0 } }),
].map(withFind);

const today = "2026-10-11"; // a Sunday
const F = (p: Partial<BoardFilters>): BoardFilters => ({ ...EMPTY_FILTERS, ...p });
const ids = (f: Partial<BoardFilters>) => applyBoard(rows, F(f), today).rows.map((r) => r.id);

describe("the inward list on the screen", () => {
  it("Open shows the five open statuses; All shows everything; chips count", () => {
    expect(ids({}).sort()).toEqual([1, 2, 3, 5, 7]);
    expect(ids({ status: "ALL" })).toHaveLength(7);
    const { counts } = applyBoard(rows, F({}), today);
    expect(counts.OPEN).toBe(5);
    expect(counts.ACKNOWLEDGED).toBe(2);
    expect(counts.CANCELLED).toBe(1);
    expect(counts.ALL).toBe(7);
  });

  it("search matches any word anywhere, in any case, including transporter, vehicle, driver and items", () => {
    expect(ids({ status: "ALL", q: "zenith" })).toEqual([6]);
    expect(ids({ status: "ALL", q: "test12" })).toEqual([5]);
    expect(ids({ status: "ALL", q: "mh04" })).toHaveLength(7);
    expect(ids({ status: "ALL", q: "ramesh wire" })).toHaveLength(7);
    expect(ids({ status: "ALL", q: "speedy zenith" })).toEqual([]); // Zenith's request has no transporter
    expect(ids({ status: "ALL", q: "inr-000003" })).toEqual([3]);
  });

  it("chip counts follow the search", () => {
    const { counts } = applyBoard(rows, F({ q: "zenith" }), today);
    expect(counts.ALL).toBe(1);
    expect(counts.OPEN).toBe(0);
  });

  it("warehouse, importer, transporter filters", () => {
    expect(ids({ status: "ALL", warehouseId: 7 })).toEqual([5]);
    expect(ids({ status: "ALL", importerId: 2 })).toEqual([6]);
    expect(ids({ status: "ALL", transporterId: 9 })).toHaveLength(6);
  });

  it("arrival: overdue only counts open requests; today, tomorrow, week, next 7, range", () => {
    expect(ids({ status: "ALL", arrival: "overdue" })).toEqual([2]);
    expect(ids({ status: "ALL", arrival: "today" })).toEqual([1]);
    expect(ids({ status: "ALL", arrival: "tomorrow" })).toEqual([3]);
    expect(ids({ status: "ALL", arrival: "week" }).sort()).toEqual([1, 2]); // Mon 5 – Sun 11 Oct
    expect(ids({ status: "ALL", arrival: "next7" }).sort()).toEqual([1, 3, 6, 7]);
    expect(ids({ status: "ALL", arrival: "range", from: "2026-10-09", to: "2026-10-11" }).sort()).toEqual([1, 2]);
  });

  it("carton stage", () => {
    expect(ids({ status: "ALL", stage: "not_numbered" })).toEqual([2]);
    expect(ids({ status: "ALL", stage: "print_pending" })).toEqual([7]);
    expect(ids({ status: "ALL", stage: "receiving" })).toEqual([3]);
    expect(ids({ status: "ALL", stage: "all_received" })).toEqual([4]);
    expect(ids({ status: "ALL", stage: "not_stored" })).toEqual([3]);
  });

  it("sorts", () => {
    expect(ids({ status: "ALL", sort: "cartons" })[0]).toBe(3);
    expect(ids({ status: "ALL", sort: "number" })[0]).toBe(7);
    expect(ids({ sort: "action" })[0]).toBe(1); // submitted first
  });

  it("the view survives the address bar", () => {
    const f = F({ status: "ACKNOWLEDGED", q: "acme", warehouseId: 5, arrival: "range", from: "2026-10-01", to: "2026-10-31", stage: "receiving", sort: "arrival" });
    expect(filtersFromParams(filtersToParams(f))).toEqual(f);
    expect(filtersToParams(EMPTY_FILTERS).toString()).toBe("");
    expect(filtersFromParams(new URLSearchParams("status=NOPE&warehouseId=-3&arrival=zzz")).status).toBe("OPEN");
    expect(activeFilterCount(f)).toBe(4);
  });

  it("filter boxes offer only what exists", () => {
    expect(optionsOf(rows, (r) => r.importer).map((i) => i.name)).toEqual(["Acme Imports", "Zenith Traders"]);
    expect(optionsOf(rows, (r) => r.transporter)).toHaveLength(1);
  });

  it("today is counted in India", () => {
    expect(todayIST(new Date("2026-10-10T20:00:00Z"))).toBe("2026-10-11");
  });
});
