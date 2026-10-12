import { existsSync, readFileSync } from "node:fs";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { fyOf, headerProblem, type Header, type NoteDetail } from "@/lib/delivery/ops";
import { deliveryNotePdf } from "@/lib/delivery/pdf";
import { editNoteSchema, holdLineSchema, seriesSchema } from "@/lib/validation/api-delivery";

/**
 * Delivery notes: the financial year in the number, request shapes, and the
 * PDF. Holding stock, the 15-minute expiry and the one-note-per-warehouse
 * split are SQL (wms.dn_hold / dn_submit) and are exercised end to end.
 */

describe("fyOf — Indian financial year, April to March, in IST", () => {
  it("April onwards is the new year", () => {
    expect(fyOf(new Date("2026-04-01T00:00:00+05:30")).fy).toBe("26-27");
    expect(fyOf(new Date("2027-03-31T23:59:00+05:30")).fy).toBe("26-27");
  });
  it("before April is still last year", () => {
    expect(fyOf(new Date("2026-03-31T23:59:00+05:30")).fy).toBe("25-26");
  });
  it("uses the Indian date, not UTC", () => {
    // 31 Mar 20:00 UTC is 1 Apr 01:30 in India.
    const r = fyOf(new Date("2027-03-31T20:00:00Z"));
    expect(r.fy).toBe("27-28");
    expect(r.today).toBe("2027-04-01");
  });
  it("wraps the century", () => {
    expect(fyOf(new Date("2099-06-01T12:00:00Z")).fy).toBe("99-00");
  });
});

describe("request shapes", () => {
  it("holding cartons needs whole, non-negative numbers", () => {
    expect(holdLineSchema.safeParse({ warehouseId: 5, key: "i12:24", cartons: 3 }).success).toBe(true);
    expect(holdLineSchema.safeParse({ warehouseId: 5, key: "i12:24", cartons: -1 }).success).toBe(false);
    expect(holdLineSchema.safeParse({ warehouseId: 5, key: "i12:24", cartons: 1.5 }).success).toBe(false);
  });
  it("an edited note keeps at least one item", () => {
    const r = editNoteSchema.safeParse({ lines: [] });
    expect(r.success).toBe(false);
    expect(editNoteSchema.safeParse({ lines: [{ key: "i1:10", cartons: 2 }] }).success).toBe(true);
  });
  it("numbering starts at 1 or more", () => {
    expect(seriesSchema.safeParse({ nextNo: 0 }).success).toBe(false);
    expect(seriesSchema.safeParse({ nextNo: 13887, prefix: "" }).success).toBe(true);
  });
});

const note = (lines: number, status: NoteDetail["status"] = "PENDING"): NoteDetail =>
  ({
    id: 5, dnNo: "/26-27/13892", dnDate: "2026-10-12", orderNo: "E/26-27/13260", status, statusLabel: status,
    approvalKind: status === "APPROVED" ? "IMPORTER" : null, importerId: 3, importerName: "Acme Imports",
    warehouseId: 7, warehouseName: "Surat Test Site", buyerName: "True Enterprise Gujarat", destination: "Rajkot",
    priority: "URGENT", cartons: lines * 2, pieces: lines * 24, lines, createdBy: 18, createdByName: "Ravi Agent",
    createdAt: "2026-10-11 21:10:09+00",
    header: {
      clientId: 1, buyerName: "True Enterprise Gujarat", buyerMobile: "8866864545",
      buyerAddress: "Ambika commercial complex, raiya road, Rajkot\n360007", buyerGstin: "24ABCDE1234F1Z5",
      destination: "Rajkot", transportName: "Gujrat transport", paymentMode: "Account", billing: "WITH_BILL",
      billAmount: 19380, priority: "URGENT", packing: "BUNDLE", bundles: 2, instructions: "Fragile — glass items ₹ inside",
      orderDate: "2026-10-10", buyerCity: "Rajkot", buyerState: "Gujarat", buyerPincode: "360007",
      transporterMobile: "9898989898", transporterGstin: "TR-77", handling: "FRAGILE", packingOther: null,
      deliveryInstructions: "Call before delivery", remarks: "Payment on delivery",
    },
    importer: { name: "Acme Imports", address: "Unit 4, Andheri East", gstin: null, mobile: "9800000010" },
    warehouseCode: "WH-0099", approvedByName: status === "APPROVED" ? "Importer Owner" : null,
    approvedAt: status === "APPROVED" ? "2026-10-11 22:00:00+00" : null, confirmMethod: null, confirmPerson: null,
    confirmNote: null, rejectedByName: null, rejectedAt: null, rejectReason: null, version: 1, editedAt: null,
    lineItems: Array.from({ length: lines }, (_, i) => ({
      key: `i${i}:12`, itemCode: `ITM-${1000 + i}`, description: `Kitchen tissue roll, 2 ply, long name number ${i + 1}`,
      piecesPerCarton: 12, unitCode: "PCS", cartons: 2, pieces: 24, orderPieces: 20,
    })),
    events: [{ action: "SUBMITTED", by: "Ravi Agent", at: "2026-10-11 21:10:09+00", remarks: null }],
    can: { approve: false, reject: false, confirmNeeded: false, edit: false },
  }) as unknown as NoteDetail;

const good: Header = {
  orderDate: "2026-10-10", clientId: 1, buyerName: "True Enterprise", buyerMobile: "8866864545", buyerAddress: "Raiya road",
  buyerCity: "Rajkot", buyerState: "Gujarat", buyerCityId: null, buyerPincode: "360007", buyerGstin: null, destination: null,
  transporterId: null, transportName: "Gujarat Transport", transporterMobile: "9898989898", transporterGstin: null,
  paymentMode: "UPI", billing: "WITHOUT_BILL", billAmount: null, priority: "NORMAL", packing: "CARTON", packingOther: null,
  bundles: null, handling: "NORMAL", instructions: null, deliveryInstructions: null, remarks: null,
};

describe("required fields of a delivery note", () => {
  const today = "2026-10-12";
  it("a complete note passes", () => {
    expect(headerProblem(good, today)).toBeNull();
  });
  it("names every missing required field", () => {
    const empty = { ...good, orderDate: null, buyerCity: null, buyerState: null, buyerPincode: null, transporterMobile: null, paymentMode: null, billing: null };
    expect(Object.keys(headerProblem(empty, today) ?? {}).sort()).toEqual(
      ["billing", "buyerCity", "buyerPincode", "buyerState", "orderDate", "paymentMode", "transporterMobile"].sort(),
    );
  });
  it("an order date cannot be in the future", () => {
    expect(headerProblem({ ...good, orderDate: "2026-10-13" }, today)?.orderDate).toMatch(/future/);
  });
  it("mobiles are 10 digits, the PIN 6", () => {
    const p = headerProblem({ ...good, buyerMobile: "12345", transporterMobile: "98989", buyerPincode: "36000" }, today)!;
    expect(p.buyerMobile).toMatch(/10-digit/);
    expect(p.transporterMobile).toMatch(/10-digit/);
    expect(p.buyerPincode).toMatch(/6 digits/);
    expect(headerProblem({ ...good, buyerMobile: "+91 88668 64545" }, today)).toBeNull();
  });
  it("with bill needs the amount; bundles need a count; other packing says what", () => {
    expect(headerProblem({ ...good, billing: "WITH_BILL" }, today)?.billAmount).toBeTruthy();
    expect(headerProblem({ ...good, billing: "WITH_BILL", billAmount: 19380 }, today)).toBeNull();
    expect(headerProblem({ ...good, packing: "BUNDLE" }, today)?.bundles).toBeTruthy();
    expect(headerProblem({ ...good, packing: "OTHER" }, today)?.packingOther).toBeTruthy();
    expect(headerProblem({ ...good, packing: "PACKAGE" }, today)).toBeNull();
  });
});

describe("delivery note PDF", () => {
  it("is an A5 PDF", async () => {
    const bytes = await deliveryNotePdf(note(3, "APPROVED"));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(420);
    expect(Math.round(height)).toBe(595);
    expect(doc.getTitle()).toContain("/26-27/13892");
  });
  it("runs onto more pages when the items do", async () => {
    const doc = await PDFDocument.load(await deliveryNotePdf(note(40)));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});

// The sql/ folder sits beside web-api and is not in this repository, so CI skips this.
const sql38 = new URL("../../sql/38_delivery_notes.sql", import.meta.url);
describe.skipIf(!existsSync(sql38))("SQL 38", () => {
  const ddl = existsSync(sql38) ? readFileSync(sql38, "utf8") : "";
  it("only touches the wms schema", () => {
    expect(ddl).toMatch(/^set search_path = wms;$/m);
    expect(ddl).not.toMatch(/\b(public|auth|storage|extensions|cron|net)\.[a-z_]/i);
  });
  it("pins search_path on every function", () => {
    const fns = ddl.match(/create\s+or\s+replace\s+function/gi)?.length ?? 0;
    const pinned = ddl.match(/set\s+search_path\s*=\s*wms,\s*public/gi)?.length ?? 0;
    expect(fns).toBeGreaterThan(0);
    expect(pinned).toBe(fns);
  });
});
