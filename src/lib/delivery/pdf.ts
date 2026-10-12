import "server-only";

import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";

import type { NoteDetail } from "@/lib/delivery/ops";

import { HANDLING_LABEL, PACKING_LABEL } from "./labels";

/**
 * The delivery note as a PDF — laid out like the importer's own Tally
 * delivery notes (A5, the same boxes and columns): "DELIVERY NOTE", the
 * company, note number and date, payment terms, references, buyer (bill
 * to) with the dispatch instructions, then Sl · Description of Goods ·
 * GDN · Per · Alt. Quantity · Quantity, totals, "Recd. in Good
 * Condition", "for <company> / Authorised Signatory".
 *
 * Until it is approved it carries a PENDING APPROVAL (or REJECTED) stamp,
 * so a printout can never be mistaken for a note that may be dispatched.
 * A QR in the corner carries the note number for the warehouse.
 */

const W = 419.52; // A5
const H = 595.32;
const M = 22; // margin
const INK = rgb(0, 0, 0);
const GREY = rgb(0.35, 0.35, 0.35);
const LINE = 0.6;

/** Standard PDF fonts speak WinAnsi only; keep what they can draw. */
function safe(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/₹/g, "Rs.")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-01" (or a timestamp, read in India time) → "1-Oct-26", as the samples write it. */
export function dnDate(iso: string): string {
  let day = iso.slice(0, 10);
  if (iso.length > 10) {
    const t = new Date(iso.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
    if (!Number.isNaN(t.getTime())) day = new Date(t.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  }
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d}-${MONTHS[m - 1]}-${String(y).slice(2)}`;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      // A single word longer than the box is cut, not allowed to overflow.
      let word = w;
      while (font.widthOfTextAtSize(word, size) > width && word.length > 1) {
        let cut = word.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > width) cut -= 1;
        out.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      line = word;
    }
    if (line) out.push(line);
  }
  return out;
}

function fit(text: string, font: PDFFont, size: number, width: number): string {
  let t = safe(text);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`.replace("…", "..."), size) > width) t = t.slice(0, -1);
  return `${t}...`;
}

type Fonts = { reg: PDFFont; bold: PDFFont; ital: PDFFont };

function text(page: PDFPage, s: string, x: number, y: number, size: number, font: PDFFont, color = INK) {
  page.drawText(safe(s), { x, y, size, font, color });
}
function right(page: PDFPage, s: string, xRight: number, y: number, size: number, font: PDFFont, color = INK) {
  const t = safe(s);
  page.drawText(t, { x: xRight - font.widthOfTextAtSize(t, size), y, size, font, color });
}
function center(page: PDFPage, s: string, cx: number, y: number, size: number, font: PDFFont, color = INK) {
  const t = safe(s);
  page.drawText(t, { x: cx - font.widthOfTextAtSize(t, size) / 2, y, size, font, color });
}
function hline(page: PDFPage, x1: number, x2: number, y: number) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: LINE, color: INK });
}
function vline(page: PDFPage, x: number, y1: number, y2: number) {
  page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: LINE, color: INK });
}

const fmt = (n: number) => n.toLocaleString("en-IN");

export async function deliveryNotePdf(n: NoteDetail): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Delivery Note ${n.dnNo}`);
  doc.setAuthor(n.importer.name);
  doc.setCreator("Genius WMS");
  doc.setProducer("Genius WMS");
  const f: Fonts = {
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    ital: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const qrPng = await QRCode.toBuffer(`Delivery Note: ${n.dnNo}\nOrder: ${n.orderNo}\nImporter: ${n.importer.name}\nWarehouse: ${n.warehouseName}`, {
    margin: 0,
    errorCorrectionLevel: "M",
    width: 240,
  });
  const qr = await doc.embedPng(qrPng);

  const L = M;
  const R = W - M;
  const split = 200; // left (company / buyer) | right (references)
  const mid = 300; // the two columns on the right

  // Table columns: Sl | Description | GDN | Per | Alt. Qty | Quantity
  const cSl = L;
  const cDesc = L + 15;
  const cGdn = 218;
  const cPer = 272;
  const cAlt = 310;
  const cQty = 354;

  const rows = n.lineItems.map((l, i) => ({
    sl: String(i + 1),
    desc: wrap(l.itemCode && !l.description.toLowerCase().includes(l.itemCode.toLowerCase()) ? `${l.itemCode} ${l.description}` : l.description, f.bold, 8, cGdn - cDesc - 6),
    ordered: `Ordered: ${fmt(l.orderPieces)} ${l.unitCode ? titleUnit(l.unitCode) : "Pcs"}`,
    gdn: n.warehouseName.toUpperCase(),
    per: `${fmt(l.piecesPerCarton)} ${l.unitCode ? titleUnit(l.unitCode) : "Pcs"}`,
    alt: `${fmt(l.pieces)} ${l.unitCode ? titleUnit(l.unitCode) : "Pcs"}`,
    qty: `${fmt(l.cartons)} Ctn`,
  }));
  const totalPieces = n.lineItems.reduce((s, l) => s + l.pieces, 0);
  const totalCartons = n.lineItems.reduce((s, l) => s + l.cartons, 0);

  // Instructions and remarks print under the table on the last page.
  const notesText = [
    n.header.instructions ? `Special packing: ${n.header.instructions}` : "",
    n.header.deliveryInstructions ? `Delivery: ${n.header.deliveryInstructions}` : "",
    n.header.remarks ? `Remarks: ${n.header.remarks}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const notes = notesText ? wrap(notesText, f.reg, 6.5, R - L - 8).slice(0, 8) : [];
  const footerH = 120 + notes.length * 8;

  // Paginate the item rows: header block on the first page only, the
  // table (with its head) on every page, the total, notes and footer on
  // the last. Each row is its description lines plus the "Ordered" line.
  const lineH = 10;
  const headH = 20;
  const top0 = H - 26;
  const rowH = (r: (typeof rows)[number]) => (Math.max(1, r.desc.length) + 1) * lineH;
  const room = (first: boolean, last: boolean) =>
    (first ? top0 - 230 : top0) - headH - 10 - (M + 16 + (last ? footerH + 24 : 14));
  const pages: (typeof rows)[] = [];
  {
    let current: typeof rows = [];
    let used = 0;
    for (const r of rows) {
      const h = rowH(r);
      if (used + h > room(pages.length === 0, false) && current.length) {
        pages.push(current);
        current = [];
        used = 0;
      }
      current.push(r);
      used += h;
    }
    pages.push(current);
    // The last page also carries the totals and footer: move rows on if they do not fit.
    for (;;) {
      const lastRows = pages[pages.length - 1]!;
      const cap = room(pages.length === 1, true);
      let total = lastRows.reduce((t, r) => t + rowH(r), 0);
      if (total <= cap || lastRows.length === 0) break;
      const moved: typeof rows = [];
      while (total > cap && lastRows.length > 1) {
        const r = lastRows.pop()!;
        moved.unshift(r);
        total -= rowH(r);
      }
      if (!moved.length) break;
      pages.push(moved);
    }
  }

  pages.forEach((pageRows, pi) => {
    const page = doc.addPage([W, H]);
    const last = pi === pages.length - 1;
    center(page, "DELIVERY NOTE", W / 2, H - 20, 11, f.bold);
    if (pages.length > 1) right(page, `Page ${pi + 1} of ${pages.length}`, R, H - 20, 7, f.reg, GREY);

    const top = top0;
    let tableTop: number;
    // Fragile / handle with care: boxed, top left, on every page.
    if (n.header.handling && n.header.handling !== "NORMAL") {
      const tag = HANDLING_LABEL[n.header.handling]!.toUpperCase();
      const tw = f.bold.widthOfTextAtSize(tag, 8.5);
      page.drawRectangle({ x: L, y: H - 23, width: tw + 10, height: 13, borderColor: INK, borderWidth: 1 });
      text(page, tag, L + 5, H - 19.5, 8.5, f.bold);
    }

    if (pi === 0) {
      // ── Header block ──
      const bottom = top - 230;
      page.drawRectangle({ x: L, y: bottom, width: R - L, height: top - bottom, borderColor: INK, borderWidth: LINE });
      vline(page, split, top, bottom);

      // Company
      let y = top - 13;
      text(page, fit(spaced(n.importer.name), f.bold, 10.5, split - L - 60), L + 4, y, 10.5, f.bold);
      y -= 10;
      for (const ln of wrap(n.importer.address ?? "", f.reg, 6.5, split - L - 60).slice(0, 3)) {
        text(page, ln, L + 4, y, 6.5, f.reg, GREY);
        y -= 8;
      }
      if (n.importer.gstin) text(page, `GSTIN: ${n.importer.gstin}`, L + 4, y, 6.5, f.reg, GREY);
      page.drawImage(qr, { x: split - 50, y: top - 52, width: 46, height: 46 });

      // Buyer (Bill to)
      const buyerTop = top - 66;
      hline(page, L, split, buyerTop);
      y = buyerTop - 10;
      text(page, "Buyer (Bill to)", L + 4, y, 7.5, f.reg);
      y -= 11;
      for (const ln of wrap(n.header.buyerName ?? n.buyerName, f.bold, 9, split - L - 8).slice(0, 2)) {
        text(page, ln, L + 4, y, 9, f.bold);
        y -= 10;
      }
      const place = [n.header.buyerCity, n.header.buyerState].filter(Boolean).join(", ");
      const buyerLines = [
        n.header.buyerAddress ?? "",
        [place, n.header.buyerPincode].filter(Boolean).join(" - "),
        n.header.buyerMobile ? `Mob: ${n.header.buyerMobile}` : "",
        n.header.buyerGstin ? `GSTIN: ${n.header.buyerGstin}` : "",
        " ",
        n.header.transportName
          ? `Transporter: ${n.header.transportName}${n.header.transporterMobile ? ` (${n.header.transporterMobile})` : ""}`
          : "",
        n.header.transporterGstin ? `Transporter GSTIN/ID: ${n.header.transporterGstin}` : "",
        `Packing: ${packingLine(n)}`,
        billingLine(n),
        n.header.priority === "URGENT" ? "Priority: URGENT" : "",
        n.header.handling && n.header.handling !== "NORMAL" ? `Handling: ${HANDLING_LABEL[n.header.handling]}` : "",
      ]
        .filter((s) => s === " " || (s && s.trim()))
        .join("\n");
      for (const ln of wrap(buyerLines, f.reg, 7, split - L - 8)) {
        if (y < bottom + 5) break;
        text(page, ln, L + 4, y, 7, f.reg);
        y -= 8.4;
      }

      // References (right): label / value cells as the samples have them.
      const orderDay = dnDate(n.header.orderDate ?? n.dnDate);
      const rowsR: { h: number; left: [string, string]; right: [string, string] | null }[] = [
        { h: 30, left: ["Delivery Note No.", n.dnNo], right: ["Dated", dnDate(n.dnDate)] },
        { h: 22, left: ["Order Date", orderDay], right: ["Mode/Terms of Payment", n.header.paymentMode ?? ""] },
        { h: 26, left: ["Reference No. & Date.", `${n.orderNo} dt. ${orderDay}`], right: ["Other References", `Agent: ${n.createdByName}`] },
        { h: 30, left: ["Buyer's Order No.", n.orderNo], right: ["Dated", orderDay] },
        { h: 26, left: ["Transporter Mob.", n.header.transporterMobile ?? ""], right: ["Status", n.statusLabel] },
        {
          h: 30,
          left: ["Dispatched through", n.header.transportName ?? ""],
          right: ["Destination", n.header.destination ?? [n.header.buyerCity, n.header.buyerPincode].filter(Boolean).join(" - ")],
        },
        { h: 0, left: ["Terms of Delivery", termsLine(n)], right: null },
      ];
      let ry = top;
      rowsR.forEach((row, idx) => {
        const h = row.h || ry - bottom;
        const lastRow = idx === rowsR.length - 1;
        if (!lastRow) hline(page, split, R, ry - h);
        if (row.right) vline(page, mid, ry, ry - h);
        const [ll, lv] = row.left;
        if (ll) text(page, ll, split + 3, ry - 9, 6.5, f.reg);
        if (lv) {
          const size = idx === 0 || idx === 3 ? 9 : 7;
          const font = idx === 0 || idx === 3 ? f.bold : f.reg;
          if (lastRow) {
            let ty = ry - 19;
            for (const ln of wrap(lv, font, size, R - split - 6).slice(0, 4)) {
              text(page, ln, split + 3, ty, size, font);
              ty -= 9;
            }
          } else {
            text(page, fit(lv, font, size, (row.right ? mid : R) - split - 6), split + 3, ry - 20, size, font);
          }
        }
        if (row.right) {
          const [rl, rv] = row.right;
          if (rl) text(page, fit(rl, f.reg, 6.5, R - mid - 6), mid + 3, ry - 9, 6.5, f.reg);
          if (rv) {
            const big = idx === 0 || idx === 1 || idx === 3;
            text(page, fit(rv, big ? f.bold : f.reg, big ? 9 : 7, R - mid - 6), mid + 3, ry - 20, big ? 9 : 7, big ? f.bold : f.reg);
          }
        }
        ry -= h;
      });
      tableTop = bottom;
    } else {
      tableTop = top;
    }

    // ── Item table ──
    const tableBottom = M + 16 + (last ? footerH : 0);
    page.drawRectangle({ x: L, y: tableBottom, width: R - L, height: tableTop - tableBottom, borderColor: INK, borderWidth: LINE });
    hline(page, L, R, tableTop - headH);
    for (const x of [cDesc, cGdn, cPer, cAlt, cQty]) vline(page, x, tableTop, last ? tableBottom + 0 : tableBottom);
    text(page, "Sl", cSl + 3, tableTop - 9, 6.5, f.reg);
    text(page, "No.", cSl + 2, tableTop - 17, 5.5, f.reg);
    center(page, "Description of Goods", (cDesc + cGdn) / 2, tableTop - 9, 7, f.reg);
    center(page, "GDN", (cGdn + cPer) / 2, tableTop - 9, 7, f.reg);
    center(page, "Per", (cPer + cAlt) / 2, tableTop - 9, 7, f.reg);
    center(page, "Crnt/PCS", (cPer + cAlt) / 2, tableTop - 17, 6, f.reg);
    center(page, "Alt.", (cAlt + cQty) / 2, tableTop - 9, 6.5, f.reg);
    center(page, "Quantity", (cAlt + cQty) / 2, tableTop - 17, 6, f.reg);
    center(page, "Quantity", (cQty + R) / 2, tableTop - 9, 7, f.reg);

    let y = tableTop - headH - 10;
    for (const r of pageRows) {
      text(page, r.sl, cSl + 4, y, 8, f.reg);
      r.desc.forEach((ln, i) => text(page, ln, cDesc + 3, y - i * lineH, 8, f.bold));
      text(page, fit(r.ordered, f.reg, 6.5, cGdn - cDesc - 6), cDesc + 3, y - r.desc.length * lineH + 1, 6.5, f.reg, GREY);
      text(page, fit(r.gdn, f.reg, 6.5, cPer - cGdn - 4), cGdn + 3, y, 6.5, f.reg);
      right(page, r.per, cAlt - 3, y, 7.5, f.reg);
      right(page, r.alt, cQty - 3, y, 7.5, f.bold);
      right(page, r.qty, R - 3, y, 7.5, f.bold);
      y -= rowH(r);
    }

    if (!last) right(page, "Continued on next page", R - 3, tableBottom + 4, 6.5, f.ital, GREY);
    if (last) {
      // Total row
      const totalY = tableBottom + 14;
      hline(page, L, R, totalY + 10);
      right(page, "Total", cGdn - 4, totalY - 1, 8, f.reg);
      right(page, `${fmt(totalPieces)} Pcs`, cQty - 3, totalY - 1, 7.5, f.bold);
      right(page, `${fmt(totalCartons)} Ctn`, R - 3, totalY - 1, 7.5, f.bold);
      hline(page, L, R, tableBottom + 2);

      // Footer
      const fTop = tableBottom;
      right(page, "E. & O.E", R - 2, fTop - 9, 6.5, f.ital);
      notes.forEach((ln, i) => text(page, ln, L + 4, fTop - 9 - i * 8, 6.5, f.reg));
      const sigTop = M + 70;
      page.drawRectangle({ x: L, y: M + 16, width: R - L, height: sigTop - (M + 16), borderColor: INK, borderWidth: LINE });
      vline(page, (L + R) / 2 + 20, sigTop, M + 16);
      text(page, "Recd. in Good Condition", L + 4, sigTop - 10, 7.5, f.reg);
      right(page, `for ${spaced(n.importer.name)}`, R - 4, sigTop - 10, 7.5, f.bold);
      right(page, "Authorised Signatory", R - 4, M + 21, 7, f.reg);
      // Who approved — the line a warehouse checks before it picks.
      const approval = approvalLine(n);
      if (approval) {
        for (const [i, ln] of wrap(approval, f.reg, 6, (R - L) - 8).slice(0, 2).entries()) {
          text(page, ln, L + 4, fTop - 9 - notes.length * 8 - i * 7 - 8, 6, f.reg, GREY);
        }
      }
    }
    center(page, "This is a Computer Generated Document", W / 2, M + 4, 6.5, f.reg, GREY);

    // Not yet good to dispatch: say so across the page.
    if (n.status !== "APPROVED") {
      const label = n.status === "REJECTED" ? "REJECTED" : "PENDING APPROVAL";
      const size = n.status === "REJECTED" ? 54 : 40;
      const width = f.bold.widthOfTextAtSize(label, size);
      page.drawText(label, {
        x: W / 2 - (width / 2) * Math.cos(Math.PI / 6),
        y: H / 2 - (width / 2) * Math.sin(Math.PI / 6) - 20,
        size,
        font: f.bold,
        color: n.status === "REJECTED" ? rgb(0.85, 0.2, 0.2) : rgb(0.6, 0.6, 0.6),
        opacity: 0.22,
        rotate: degrees(30),
      });
    }
  });

  return doc.save();
}

/** "AHMS" → "A H M S", the way the samples set a short company name. */
function spaced(name: string): string {
  const t = name.trim();
  return t.length <= 6 && /^[A-Z0-9]+$/.test(t) ? t.split("").join(" ") : t;
}

function titleUnit(u: string): string {
  const t = u.trim();
  if (/^pcs?$/i.test(t)) return "Pcs";
  return t.length <= 4 ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t;
}

function packingLine(n: NoteDetail): string {
  const p = n.header.packing;
  if (p === "BUNDLE") return n.header.bundles ? `${n.header.bundles} Bundle${n.header.bundles === 1 ? "" : "s"}` : "Bundle";
  if (p === "OTHER") return n.header.packingOther ? `Other - ${n.header.packingOther}` : "Other";
  return PACKING_LABEL[p] ?? p;
}

function billingLine(n: NoteDetail): string {
  if (n.header.billing === "WITH_BILL") {
    return n.header.billAmount ? `With Bill [${Math.round(n.header.billAmount)}]` : "With Bill";
  }
  if (n.header.billing === "WITHOUT_BILL") return "Without Bill";
  return "";
}

function termsLine(n: NoteDetail): string {
  return [
    billingLine(n),
    packingLine(n),
    n.header.priority === "URGENT" ? "Urgent" : "",
    n.header.handling && n.header.handling !== "NORMAL" ? HANDLING_LABEL[n.header.handling] : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function approvalLine(n: NoteDetail): string {
  if (n.status === "APPROVED") {
    const how =
      n.approvalKind === "AUTO"
        ? "Auto-approved (trusted sales agent)"
        : n.approvalKind === "CONFIRMED"
          ? `Approved by ${n.approvedByName ?? ""} after confirming with ${n.confirmPerson ?? "the importer"}`
          : n.approvalKind === "IMPORTER_CREATED"
            ? `Created by the importer (${n.approvedByName ?? ""})`
            : `Approved by ${n.approvedByName ?? "the importer"}`;
    return `${how}${n.approvedAt ? ` on ${dnDate(n.approvedAt)}` : ""} · Sales agent: ${n.createdByName}`;
  }
  if (n.status === "REJECTED") return `Rejected: ${n.rejectReason ?? ""}`;
  return `Waiting for the importer's approval · Sales agent: ${n.createdByName}`;
}
