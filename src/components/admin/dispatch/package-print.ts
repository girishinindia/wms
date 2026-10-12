"use client";

import QRCode from "qrcode";

import type { WorkDetail, WorkPackage } from "@/lib/dispatch/ops";

import { printHtml } from "../carton-print";

/**
 * Package labels and the pick list, printed through the browser's own print
 * window (any printer, or "Save as PDF") — the same way carton stickers are.
 *
 * A package label: the code big (PK-000123), "package 2 of 11", the delivery
 * note, the buyer and city, the transporter, cartons and weight, FRAGILE when
 * it is — and the QR that the verify step scans. The QR text starts with the
 * code, so any scanner that reads it gives back PK-000123.
 */

export type PackageLabelSize = "t100x75" | "t100x50" | "a4";

export const PACKAGE_LABEL_SIZES: { id: PackageLabelSize; label: string; hint: string }[] = [
  { id: "t100x75", label: "Thermal 100 × 75 mm", hint: "4 × 3 inch roll" },
  { id: "t100x50", label: "Thermal 100 × 50 mm", hint: "4 × 2 inch roll" },
  { id: "a4", label: "A4 sheet · 4 per page", hint: "Any office printer" },
];

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const KIND: Record<string, string> = { PACKAGE: "Package", BUNDLE: "Bundle", SINGLE: "Carton" };

/** What the QR carries: the code first (that is what verify reads), then the note for a human. */
export function packageQrText(p: WorkPackage, w: WorkDetail): string {
  return [p.code, `DN ${w.dnNo}`, `To ${w.buyerName}${w.buyerCity ? `, ${w.buyerCity}` : ""}`, `${p.cartons} carton${p.cartons === 1 ? "" : "s"}`].join("\n");
}

const CSS: Record<PackageLabelSize, string> = {
  t100x75: `
    @page { size: 100mm 75mm; margin: 0; }
    .sheet { display: block; }
    .pl { width: 100mm; height: 75mm; padding: 3mm; break-after: page; grid-template-columns: 1fr 38mm; }
    .qr { width: 38mm; height: 38mm; } .code { font-size: 20pt; } .big { font-size: 11pt; } .m { font-size: 8.5pt; } .warn { font-size: 12pt; }`,
  t100x50: `
    @page { size: 100mm 50mm; margin: 0; }
    .sheet { display: block; }
    .pl { width: 100mm; height: 50mm; padding: 2.5mm 3mm; break-after: page; grid-template-columns: 1fr 34mm; }
    .qr { width: 34mm; height: 34mm; } .code { font-size: 16pt; } .big { font-size: 9pt; } .m { font-size: 7.5pt; } .warn { font-size: 9pt; }`,
  a4: `
    @page { size: A4; margin: 8mm; }
    .sheet { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 136mm; gap: 4mm; }
    .pl { border: 0.5mm dashed #888; padding: 6mm; grid-template-columns: 1fr; grid-template-rows: auto 1fr; break-inside: avoid; }
    .qr { width: 62mm; height: 62mm; justify-self: center; } .code { font-size: 28pt; } .big { font-size: 13pt; } .m { font-size: 10pt; } .warn { font-size: 15pt; }`,
};

const BASE = `
  * { box-sizing: border-box; margin: 0; }
  html, body { background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
  .pl { display: grid; gap: 2.5mm; overflow: hidden; align-items: center; }
  .t { min-width: 0; display: flex; flex-direction: column; gap: 0.8mm; }
  .code { font-family: "Courier New", monospace; font-weight: 700; letter-spacing: 0.3pt; white-space: nowrap; }
  .big { font-weight: 700; line-height: 1.15; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .m { line-height: 1.25; }
  .warn { font-weight: 800; border: 0.6mm solid #000; padding: 0.4mm 1.5mm; align-self: flex-start; letter-spacing: 0.5pt; }
  .qr svg { width: 100%; height: 100%; display: block; }
`;

export async function printPackageLabels(w: WorkDetail, packages: WorkPackage[], size: PackageLabelSize) {
  const live = w.packageList.filter((p) => p.status !== "CANCELLED");
  const svgs = await Promise.all(packages.map((p) => QRCode.toString(packageQrText(p, w), { type: "svg", errorCorrectionLevel: "M", margin: 0 })));
  const warn = w.handling === "FRAGILE" ? "FRAGILE" : w.handling === "HANDLE_WITH_CARE" ? "HANDLE WITH CARE" : "";
  const body = `<div class="sheet">${packages
    .map((p, i) => {
      const at = live.findIndex((x) => x.id === p.id) + 1;
      const size3 = p.lengthCm && p.widthCm && p.heightCm ? ` · ${p.lengthCm}×${p.widthCm}×${p.heightCm} cm` : "";
      return `<div class="pl"><div class="t">
        <div class="code">${esc(p.code)}</div>
        <div class="m"><b>${esc(KIND[p.kind] ?? "Package")} ${at} of ${live.length}</b> · ${p.cartons} carton${p.cartons === 1 ? "" : "s"}${p.weightKg ? ` · ${p.weightKg} kg` : ""}${size3}</div>
        <div class="big">${esc(w.buyerName)}${w.buyerCity ? `, ${esc(w.buyerCity)}` : ""}</div>
        <div class="m">DN ${esc(w.dnNo)} · ${esc(w.importerName)}</div>
        ${w.transportName ? `<div class="m">Transport: ${esc(w.transportName)}</div>` : ""}
        <div class="m">From ${esc(w.warehouseName)}</div>
        ${warn ? `<div class="warn">${warn}</div>` : ""}
      </div><div class="qr">${svgs[i]}</div></div>`;
    })
    .join("")}</div>`;
  await printHtml(`${w.dnNo} — package labels`, BASE + CSS[size], body);
}

/** The A4 pick list: each item, where its free cartons are, a box to tick. */
export async function printPickList(w: WorkDetail) {
  const css = `
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; margin: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 10pt; }
    h1 { font-size: 15pt; } .sub { color: #333; margin: 1mm 0 4mm; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 4mm; }
    th, td { border: 0.3mm solid #000; padding: 1.5mm 2mm; text-align: left; vertical-align: top; }
    th { background: #eee; font-size: 9pt; }
    .n { text-align: right; font-family: "Courier New", monospace; font-weight: 700; }
    .nos { font-family: "Courier New", monospace; font-size: 8.5pt; }
    .box { display: inline-block; width: 3.5mm; height: 3.5mm; border: 0.3mm solid #000; margin-right: 1mm; vertical-align: middle; }
    .warn { font-weight: 800; border: 0.5mm solid #000; padding: 0.5mm 2mm; display: inline-block; margin-left: 2mm; }
    .sign { margin-top: 8mm; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8mm; font-size: 9pt; }
    .sign div { border-top: 0.3mm solid #000; padding-top: 1mm; }`;
  const warn = w.handling === "FRAGILE" ? "FRAGILE" : w.handling === "HANDLE_WITH_CARE" ? "HANDLE WITH CARE" : "";
  const rows = w.lines
    .map((l, i) => {
      const left = Math.max(0, l.required - l.picked);
      const where = l.locations
        .map(
          (x) =>
            `<div><b>${esc(x.place)}</b>${x.floor ? ` · ${esc(x.floor)}` : ""} · ${x.cartons} carton${x.cartons === 1 ? "" : "s"}<div class="nos">${x.cartonNos
              .slice(0, 24)
              .map((n) => `<span class="box"></span>${esc(n)}`)
              .join(" &nbsp; ")}${x.cartons > 24 ? " …" : ""}</div></div>`,
        )
        .join("");
      return `<tr><td class="n">${i + 1}</td><td>${l.itemCode ? `<b>${esc(l.itemCode)}</b> · ` : ""}${esc(l.description)}<div class="nos">${l.piecesPerCarton} ${esc(l.unitCode ?? "pcs")} / carton</div></td>
        <td class="n">${l.required}</td><td class="n">${l.picked}</td><td class="n">${left}</td><td>${left === 0 ? "All picked" : where || "No free carton found"}</td></tr>`;
    })
    .join("");
  const body = `<h1>Pick list — ${esc(w.dnNo)}${warn ? `<span class="warn">${warn}</span>` : ""}</h1>
    <p class="sub">${esc(w.importerName)} · ${esc(w.warehouseName)} · to <b>${esc(w.buyerName)}</b>${w.buyerCity ? `, ${esc(w.buyerCity)}` : ""}${w.transportName ? ` · by ${esc(w.transportName)}` : ""}${w.priority === "URGENT" ? " · <b>URGENT</b>" : ""}
    · assigned: ${esc(w.assigneeList.map((a) => a.name).join(", ") || "—")}</p>
    ${w.instructions ? `<p class="sub"><b>Packing:</b> ${esc(w.instructions)}</p>` : ""}
    <table><thead><tr><th>#</th><th>Item</th><th>Cartons</th><th>Picked</th><th>Left</th><th>Take from (tick each carton you pick — then scan it)</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="sub">Scan every carton where you pick it. A carton "At dock" is received but not yet in a gala.</p>
    <div class="sign"><div>Picked by</div><div>Checked at packing</div><div>Date / time</div></div>`;
  await printHtml(`${w.dnNo} — pick list`, css, body);
}
