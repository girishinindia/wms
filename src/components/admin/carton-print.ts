"use client";

import QRCode from "qrcode";

import { initials, kg } from "@/lib/inward/carton-format";

/**
 * Carton stickers, printed through the browser's own print window — so
 * whatever printer the PC has (a Zebra/TSC thermal, an office laser with
 * sticker sheets, or "Save as PDF") just works, with no driver of ours.
 *
 * Each sticker: the importer's logo (or initials), name and mobile, the
 * carton number big, item code and description, pieces per carton with
 * the unit, kg — and the QR, which carries all of that plus the email,
 * vehicle and driver.
 */

export type StickerSize = "t100x50" | "t100x75" | "a4";

export const STICKER_SIZES: { id: StickerSize; label: string; hint: string }[] = [
  { id: "t100x50", label: "Thermal 100 × 50 mm", hint: "4 × 2 inch roll" },
  { id: "t100x75", label: "Thermal 100 × 75 mm", hint: "4 × 3 inch roll" },
  { id: "a4", label: "A4 sheet · 14 per page", hint: "Any office printer, 99 × 38 mm stickers" },
];

export type PrintableLabel = {
  id: number;
  cartonNo: string;
  seq: number;
  total: number;
  importerName: string;
  importerMobile: string | null;
  importerLogoUrl: string | null;
  itemCode: string | null;
  description: string;
  piecesPerCarton: number;
  unitCode: string | null;
  kgPerCarton: number;
  warehouseName: string;
  qr: string;
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const CSS: Record<StickerSize, string> = {
  t100x50: `
    @page { size: 100mm 50mm; margin: 0; }
    .sheet { display: block; }
    .label { width: 100mm; height: 50mm; padding: 2.5mm 3mm; break-after: page; grid-template-columns: 1fr 40mm; }
    .qr { width: 40mm; height: 40mm; }
    .no { font-size: 15pt; } .name { font-size: 10pt; } .meta { font-size: 8pt; } .logo { width: 10mm; height: 10mm; font-size: 10pt; }`,
  t100x75: `
    @page { size: 100mm 75mm; margin: 0; }
    .sheet { display: block; }
    .label { width: 100mm; height: 75mm; padding: 3.5mm 4mm; break-after: page; grid-template-columns: 1fr 48mm; }
    .qr { width: 48mm; height: 48mm; }
    .no { font-size: 17pt; } .name { font-size: 11pt; } .meta { font-size: 9.5pt; } .logo { width: 13mm; height: 13mm; font-size: 12pt; }`,
  a4: `
    @page { size: A4; margin: 10.7mm 4.6mm; }
    .sheet { display: grid; grid-template-columns: 99.1mm 99.1mm; grid-auto-rows: 38.1mm; column-gap: 2.5mm; }
    .label { width: 99.1mm; height: 38.1mm; padding: 2mm 2.5mm; grid-template-columns: 1fr 32mm; break-inside: avoid; }
    .qr { width: 32mm; height: 32mm; }
    .no { font-size: 12.5pt; } .name { font-size: 8.5pt; } .meta { font-size: 7pt; } .logo { width: 8mm; height: 8mm; font-size: 8pt; }`,
};

function stickerHtml(l: PrintableLabel, qrSvg: string): string {
  const logo = l.importerLogoUrl
    ? `<img class="logo" src="${esc(l.importerLogoUrl)}" alt="">`
    : `<div class="logo initials">${esc(initials(l.importerName))}</div>`;
  const item = [l.itemCode, l.description].filter(Boolean).join(" · ");
  return `
  <div class="label">
    <div class="left">
      <div class="head">${logo}<div><div class="name">${esc(l.importerName)}</div>${
        l.importerMobile ? `<div class="meta">+91 ${esc(l.importerMobile)}</div>` : ""
      }</div></div>
      <div class="no">${esc(l.cartonNo)}</div>
      <div class="meta item">${esc(item)}</div>
      <div class="meta"><b>${l.piecesPerCarton} ${esc(l.unitCode ?? "PCS")}</b> / carton · <b>${esc(kg(l.kgPerCarton))} kg</b></div>
      <div class="meta muted">Carton ${l.seq} of ${l.total} · ${esc(l.warehouseName)}</div>
    </div>
    <div class="qr">${qrSvg}</div>
  </div>`;
}

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  html, body { background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
  .label { display: grid; gap: 2mm; overflow: hidden; align-items: center; }
  .left { min-width: 0; display: flex; flex-direction: column; gap: 0.8mm; }
  .head { display: flex; align-items: center; gap: 1.6mm; min-width: 0; }
  .head > div { min-width: 0; }
  .logo { object-fit: contain; flex: none; }
  .initials { border: 0.35mm solid #000; border-radius: 1mm; display: flex; align-items: center; justify-content: center; font-weight: 700; }
  .name { font-weight: 700; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase; }
  .no { font-family: "Courier New", monospace; font-weight: 700; letter-spacing: 0.2pt; white-space: nowrap; }
  .meta { line-height: 1.2; }
  .item { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .muted { color: #333; }
  .qr svg { width: 100%; height: 100%; display: block; }
`;

/** Wait for every <img> in the document (logos) — a sticker printed before
 *  its logo loads comes out with a hole in it. */
async function imagesReady(doc: Document, timeoutMs = 4000) {
  const imgs = Array.from(doc.images);
  await Promise.race([
    Promise.all(imgs.map((im) => (im.complete ? Promise.resolve() : new Promise((r) => ((im.onload = r), (im.onerror = r)))))),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
}

/** Print through a hidden frame and the browser's print window. */
async function printHtml(title: string, css: string, body: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${body}</body></html>`);
  doc.close();
  await imagesReady(doc);
  const win = frame.contentWindow!;
  const done = () => setTimeout(() => frame.remove(), 1000);
  win.addEventListener("afterprint", done, { once: true });
  win.focus();
  win.print();
  // Some browsers never fire afterprint; tidy up regardless.
  setTimeout(done, 60_000);
}

export async function printStickers(labels: PrintableLabel[], size: StickerSize, title: string) {
  const svgs = await Promise.all(
    labels.map((l) => QRCode.toString(l.qr, { type: "svg", errorCorrectionLevel: "M", margin: 0 })),
  );
  const body = `<div class="sheet">${labels.map((l, i) => stickerHtml(l, svgs[i]!)).join("")}</div>`;
  await printHtml(title, BASE_CSS + CSS[size], body);
}

/**
 * Printer down: an A4 list of the carton numbers, big, grouped by item —
 * to write on each carton with a marker. Scanning by typing the number
 * then receives it as "label pending".
 */
export async function printMarkerList(labels: PrintableLabel[], title: string) {
  const groups = new Map<string, PrintableLabel[]>();
  for (const l of labels) {
    const k = [l.itemCode, l.description].filter(Boolean).join(" · ");
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const css = `
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; margin: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; }
    h1 { font-size: 14pt; margin-bottom: 2mm; } h2 { font-size: 11pt; margin: 5mm 0 2mm; }
    p { font-size: 9pt; color: #333; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.5mm; }
    .n { border: 0.3mm solid #000; padding: 2mm; font-family: "Courier New", monospace; font-size: 12pt; font-weight: 700; display: flex; justify-content: space-between; }
    .box { width: 4mm; height: 4mm; border: 0.3mm solid #000; display: inline-block; }`;
  const body =
    `<h1>${esc(title)} — carton numbers to write by hand</h1>` +
    `<p>Write the number on the carton with a marker and tick the box. At the dock, type the number on the scan screen — the carton is received as "label pending"; print and paste its sticker when the printer is back.</p>` +
    [...groups.entries()]
      .map(
        ([k, ls]) =>
          `<h2>${esc(k)} · ${ls.length} cartons · ${ls[0]!.piecesPerCarton} ${esc(ls[0]!.unitCode ?? "PCS")} / carton</h2><div class="grid">${ls
            .map((l) => `<div class="n"><span>${esc(l.cartonNo)}</span><span class="box"></span></div>`)
            .join("")}</div>`,
      )
      .join("");
  await printHtml(`${title} — marker list`, css, body);
}

/** The QR as an SVG string, for the on-screen preview. */
export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 0 });
}

// ── Gala labels ───────────────────────────────────────────────────

export type GalaLabelSize = "a4" | "t100x75";

export const GALA_LABEL_SIZES: { id: GalaLabelSize; label: string; hint: string }[] = [
  { id: "a4", label: "A4 · 4 per page", hint: "Wall labels, readable from a distance" },
  { id: "t100x75", label: "Thermal 100 × 75 mm", hint: "Sticker roll" },
];

export type PrintableGala = { code: string; fullId: string; qr: string; warehouseName: string; floorName: string; galaName: string };

/**
 * One label per gala: the gala code huge (read from across the floor), the
 * warehouse / floor / gala in words, and the QR the phone or scanner reads.
 */
export async function printGalaLabels(galas: PrintableGala[], size: GalaLabelSize, title: string) {
  const svgs = await Promise.all(
    galas.map((g) => QRCode.toString(g.qr, { type: "svg", errorCorrectionLevel: "M", margin: 0 })),
  );
  const css =
    BASE_CSS_GALA +
    (size === "a4"
      ? `@page { size: A4; margin: 8mm; }
         .sheet { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 138mm; gap: 4mm; }
         .gl { border: 0.6mm solid #000; border-radius: 3mm; padding: 6mm; }
         .gc { font-size: 46pt; } .gq { width: 72mm; height: 72mm; } .gw { font-size: 12pt; }`
      : `@page { size: 100mm 75mm; margin: 0; }
         .sheet { display: block; }
         .gl { width: 100mm; height: 75mm; padding: 3mm 4mm; break-after: page; flex-direction: row; gap: 4mm; }
         .gc { font-size: 26pt; } .gq { width: 48mm; height: 48mm; } .gw { font-size: 9pt; }`);
  const body = `<div class="sheet">${galas
    .map(
      (g, i) => `<div class="gl"><div class="gt"><div class="gc">${esc(g.code)}</div>
        <div class="gw"><b>${esc(g.galaName)}</b> · ${esc(g.floorName)}</div>
        <div class="gw">${esc(g.warehouseName)}</div><div class="gw gm">${esc(g.fullId)}</div></div>
        <div class="gq">${svgs[i]}</div></div>`,
    )
    .join("")}</div>`;
  await printHtml(title, css, body);
}

const BASE_CSS_GALA = `
  * { box-sizing: border-box; margin: 0; }
  html, body { background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
  .gl { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; overflow: hidden; break-inside: avoid; }
  .gt { display: flex; flex-direction: column; gap: 1.5mm; align-items: center; }
  .gc { font-family: "Courier New", monospace; font-weight: 700; letter-spacing: 1pt; line-height: 1; }
  .gm { font-family: "Courier New", monospace; color: #333; }
  .gq svg { width: 100%; height: 100%; display: block; }
`;
