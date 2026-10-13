import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { sql } from "drizzle-orm";

import type { Actor } from "@/lib/auth/guard";
import { fmtDateTime } from "@/lib/format/datetime";
import { InwardError } from "@/lib/inward/ops";

import { rows as run } from "./dash-ops";
import { lensOptions } from "./dashboards";
import type { Filters, Lens } from "./lens";
import { REPORTS, reportByKey, type ReportDef } from "./report-defs";
import { EXPORT_ROWS, PREVIEW_ROWS, type Column, type ReportMeta, type ReportResult } from "./report-types";

function metaOf(r: ReportDef, lens: Lens): ReportMeta {
  const staffLens = lens.kind === "all" || lens.kind === "warehouse";
  return {
    key: r.key,
    no: r.no,
    group: r.group,
    title: r.title,
    description: r.description,
    period: r.period,
    warehouse: r.warehouse !== false,
    importer: r.importer !== false && staffLens,
    statuses: r.statuses ?? [],
    columns: r.columns,
  };
}

/** The reports this person may open, in catalogue order. */
export function catalogFor(actor: Actor): ReportMeta[] {
  const out: ReportMeta[] = [];
  for (const r of REPORTS) {
    const lens = r.lens(actor);
    if (lens) out.push(metaOf(r, lens));
  }
  return out;
}

export async function runReport(actor: Actor, key: string, f: Filters, limit = PREVIEW_ROWS): Promise<ReportResult> {
  const def = reportByKey(key);
  const lens = def?.lens(actor) ?? null;
  if (!def || !lens) throw new InwardError("NOT_FOUND", "No such report");
  const meta = metaOf(def, lens);
  const opts = await lensOptions(lens);
  const statuses = meta.statuses.map((s) => s.value);
  const filters: Filters = {
    ...f,
    warehouseId: meta.warehouse && f.warehouseId && opts.warehouses.some((w) => w.id === f.warehouseId) ? f.warehouseId : null,
    importerId: meta.importer && f.importerId && opts.importers.some((w) => w.id === f.importerId) ? f.importerId : null,
    extra: { ...(f.extra.status && statuses.includes(f.extra.status) ? { status: f.extra.status } : {}) },
  };
  const q = def.query(lens, filters);
  const totalCols = def.columns.filter((c) => c.total);
  const sums = totalCols.length ? sql`, ${sql.join(totalCols.map((c) => sql`coalesce(sum(${sql.identifier(c.key)}), 0)::float as ${sql.identifier(c.key)}`), sql`, `)}` : sql``;
  const [agg] = await run<Record<string, number>>(sql`select count(*)::int as __n ${sums} from (${q}) t`);
  const rows = await run<Record<string, string | number | null>>(sql`select * from (${q}) t limit ${limit}`);
  const totals: Record<string, number> = {};
  for (const c of totalCols) totals[c.key] = Number(agg?.[c.key] ?? 0);
  return {
    meta,
    filters: { period: filters.period, from: filters.from, to: filters.to, warehouseId: filters.warehouseId, importerId: filters.importerId, status: filters.extra.status ?? null },
    options: { warehouses: meta.warehouse ? opts.warehouses : [], importers: meta.importer ? opts.importers : [] },
    rows: rows.map((r) => {
      const o: Record<string, string | number | null> = {};
      for (const c of def.columns) {
        const v = r[c.key];
        o[c.key] = v === null || v === undefined ? null : ["int", "num", "money", "pct", "hours", "days"].includes(c.type) ? Number(v) : String(v);
      }
      return o;
    }),
    count: Number(agg?.__n ?? 0),
    totals,
    generatedAt: new Date().toISOString(),
  };
}

// ── Files ─────────────────────────────────────────────────────────

/** "Dispatch register · 01 Sep 2026 – 30 Sep 2026 · Bhiwandi 1" */
export function subtitleOf(r: ReportResult): string {
  const parts: string[] = [];
  if (r.meta.period) parts.push(`${r.filters.from} to ${r.filters.to}`);
  else parts.push(`As of ${fmtDateTime(r.generatedAt)}`);
  if (r.filters.warehouseId) parts.push(r.options.warehouses.find((w) => w.id === r.filters.warehouseId)?.label ?? "");
  if (r.filters.importerId) parts.push(r.options.importers.find((w) => w.id === r.filters.importerId)?.label ?? "");
  if (r.filters.status) parts.push(r.meta.statuses.find((s) => s.value === r.filters.status)?.label ?? r.filters.status);
  return parts.filter(Boolean).join(" · ");
}

export const fileName = (r: ReportResult, ext: string) =>
  `${r.meta.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/-+$/, "")}-${r.meta.period ? `${r.filters.from}-to-${r.filters.to}` : r.generatedAt.slice(0, 10)}.${ext}`;

function cellText(v: string | number | null, c: Column): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") {
    if (c.type === "money") return v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (c.type === "pct") return `${v}%`;
    return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }
  return v;
}

export function toCsv(r: ReportResult): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [r.meta.columns.map((c) => esc(c.label)).join(",")];
  for (const row of r.rows) lines.push(r.meta.columns.map((c) => esc(row[c.key] === null ? "" : String(row[c.key]))).join(","));
  if (Object.keys(r.totals).length) lines.push(r.meta.columns.map((c, i) => (c.key in r.totals ? String(r.totals[c.key]) : i === 0 ? "Total" : "")).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export async function toXlsx(r: ReportResult): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const aoa: (string | number | null)[][] = [
    [`${r.meta.no} · ${r.meta.title}`],
    [subtitleOf(r)],
    [],
    r.meta.columns.map((c) => c.label),
    ...r.rows.map((row) => r.meta.columns.map((c) => row[c.key])),
  ];
  if (Object.keys(r.totals).length) aoa.push(r.meta.columns.map((c, i) => (c.key in r.totals ? r.totals[c.key]! : i === 0 ? "Total" : null)));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = r.meta.columns.map((c) => ({ wch: Math.min(40, Math.max(c.label.length + 2, ...r.rows.slice(0, 200).map((row) => String(row[c.key] ?? "").length + 1))) }));
  ws["!freeze"] = { xSplit: 0, ySplit: 4 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, r.meta.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

/** Helvetica speaks WinAnsi only: rupee, dashes and dots are spelt out. */
const ascii = (s: string) =>
  s
    .replace(/₹/g, "Rs ")
    .replace(/[–—]/g, "-")
    .replace(/·/g, "-")
    .replace(/×/g, "x")
    .replace(/…/g, "...")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, "->")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

function fit(text: string, font: PDFFont, size: number, width: number): string {
  let t = ascii(text);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
  return `${t}...`;
}

export async function toPdf(r: ReportResult, company = "Genius WMS"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${r.meta.title} - ${subtitleOf(r)}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 842;
  const H = 595;
  const M = 28;
  const size = r.meta.columns.length > 10 ? 6.8 : 7.6;
  const rowH = size + 6;
  const usable = W - M * 2;
  const numeric = (c: Column) => ["int", "num", "money", "pct", "hours", "days"].includes(c.type);
  // Width per column: what its longest text needs, shared out over the page.
  const want = r.meta.columns.map((c) => {
    const sample = r.rows.slice(0, 300).map((row) => ascii(cellText(row[c.key] ?? null, c)));
    const longest = Math.max(bold.widthOfTextAtSize(ascii(c.label), size), ...sample.map((s) => font.widthOfTextAtSize(s, size)));
    return Math.min(Math.max(longest + 8, 34), 190);
  });
  const sum = want.reduce((a, b) => a + b, 0);
  const widths = want.map((w) => (w / sum) * usable);
  const green = rgb(0.11, 0.42, 0.37);
  const grey = rgb(0.35, 0.4, 0.4);
  const line = rgb(0.85, 0.89, 0.88);

  let page = doc.addPage([W, H]);
  let y = H - M;
  const header = (first: boolean) => {
    if (first) {
      page.drawText(ascii(company), { x: M, y: y - 10, size: 9, font: bold, color: green });
      page.drawText(ascii(`${r.meta.no} - ${r.meta.title}`), { x: M, y: y - 26, size: 14, font: bold, color: rgb(0.06, 0.15, 0.14) });
      page.drawText(ascii(subtitleOf(r)), { x: M, y: y - 40, size: 8.5, font, color: grey });
      y -= 54;
    } else {
      page.drawText(ascii(`${r.meta.title} (continued)`), { x: M, y: y - 10, size: 9, font: bold, color: green });
      y -= 20;
    }
    page.drawRectangle({ x: M, y: y - rowH + 2, width: usable, height: rowH, color: rgb(0.92, 0.96, 0.95) });
    let x = M;
    r.meta.columns.forEach((c, i) => {
      const t = fit(c.label, bold, size, widths[i]! - 6);
      const tx = numeric(c) ? x + widths[i]! - 3 - bold.widthOfTextAtSize(t, size) : x + 3;
      page.drawText(t, { x: tx, y: y - rowH + 6, size, font: bold, color: rgb(0.06, 0.15, 0.14) });
      x += widths[i]!;
    });
    y -= rowH;
  };
  const drawRow = (vals: (string | number | null)[], f: PDFFont, shade: boolean) => {
    if (y - rowH < M + 16) {
      page = doc.addPage([W, H]);
      y = H - M;
      header(false);
    }
    if (shade) page.drawRectangle({ x: M, y: y - rowH + 2, width: usable, height: rowH, color: rgb(0.975, 0.985, 0.98) });
    let x = M;
    r.meta.columns.forEach((c, i) => {
      const t = fit(cellText(vals[i] ?? null, c), f, size, widths[i]! - 6);
      const tx = numeric(c) ? x + widths[i]! - 3 - f.widthOfTextAtSize(t, size) : x + 3;
      page.drawText(t, { x: tx, y: y - rowH + 6, size, font: f, color: rgb(0.1, 0.16, 0.16) });
      x += widths[i]!;
    });
    page.drawLine({ start: { x: M, y: y - rowH + 2 }, end: { x: W - M, y: y - rowH + 2 }, thickness: 0.3, color: line });
    y -= rowH;
  };
  header(true);
  if (!r.rows.length) page.drawText("No rows for these filters.", { x: M, y: y - 14, size: 9, font, color: grey });
  r.rows.forEach((row, i) => drawRow(r.meta.columns.map((c) => row[c.key] ?? null), font, i % 2 === 1));
  if (Object.keys(r.totals).length && r.rows.length) drawRow(r.meta.columns.map((c, i) => (c.key in r.totals ? r.totals[c.key]! : i === 0 ? "Total" : null)), bold, false);
  if (r.count > r.rows.length) {
    y -= 6;
    page.drawText(ascii(`Showing the first ${r.rows.length.toLocaleString("en-IN")} of ${r.count.toLocaleString("en-IN")} rows - narrow the filters or download Excel.`), { x: M, y: y - 8, size: 7.5, font, color: grey });
  }
  const pages = doc.getPages();
  const stamp = fmtDateTime(r.generatedAt);
  pages.forEach((p, i) => {
    p.drawText(ascii(`Generated ${stamp} - page ${i + 1} of ${pages.length}`), { x: M, y: 14, size: 7, font, color: grey });
  });
  return doc.save();
}

export { EXPORT_ROWS };
