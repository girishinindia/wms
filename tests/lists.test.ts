import { describe, expect, it } from "vitest";

import { csvName, toCsv } from "@/components/admin/csv";

/** The Excel download of a list: quoting, formula guard, file name. */
describe("CSV download", () => {
  it("quotes commas, quotes and new lines", () => {
    const csv = toCsv([{ label: "Name", value: (r: { a: string }) => r.a }], [{ a: 'Acme, "Imports"' }, { a: "two\nlines" }]);
    expect(csv).toBe('Name\r\n"Acme, ""Imports"""\r\n"two\nlines"');
  });
  it("never lets a value run as an Excel formula, but keeps negative numbers", () => {
    const csv = toCsv([{ label: "V", value: (r: { v: string }) => r.v }], [{ v: "=SUM(A1)" }, { v: "-12.5" }, { v: "@cmd" }]);
    expect(csv.split("\r\n").slice(1)).toEqual(["'=SUM(A1)", "-12.5", "'@cmd"]);
  });
  it("empty values stay empty", () => {
    expect(toCsv([{ label: "X", value: () => null }], [{}])).toBe("X\r\n");
  });
  it("names the file with the day", () => {
    expect(csvName("Cartons F1-G03")).toMatch(/^Cartons F1-G03 \d{4}-\d{2}-\d{2}\.csv$/);
    expect(csvName("a/b:c")).toMatch(/^a-b-c /);
  });
});

describe("CSV file name", () => {
  it("keeps to plain letters", () => {
    expect(csvName("Cartons F1-G02 · Gala 2")).toMatch(/^Cartons F1-G02 - Gala 2 \d{4}-\d{2}-\d{2}\.csv$/);
  });
});
