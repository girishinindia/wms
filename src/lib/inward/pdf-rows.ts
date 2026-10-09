import "server-only";

import type { Cell } from "@/lib/inward/packing-list";

/**
 * A packing list that arrived as a PDF — the same table, printed.
 *
 * A PDF has no cells, only words at positions. The header row (ITEM NO,
 * DESCRIBE, CTN, QTY…) gives the column positions; every later word is
 * dropped into the column whose header is nearest, lines are grouped
 * by their baseline, and the result is handed to the same parser the
 * spreadsheet goes through. Works for PDFs with real text — a scanned
 * picture of a list has no words to read, and says so.
 */

type Word = { text: string; x: number; y: number; w: number };

const HEADER_HINT = /^(item|describe|description|ctn|ctns|qty|q'ty|kg|kgs|tt\.?qty|tt\.?kg|total|unit|carton|pcs)/i;

async function words(bytes: Uint8Array): Promise<{ page: number; words: Word[] }[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false }).promise;
  const pages: { page: number; words: Word[] }[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, 20); p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const out: Word[] = [];
    for (const item of content.items) {
      if (!("str" in item) || item.str.trim() === "") continue;
      const [, , , , x, y] = item.transform as number[];
      out.push({ text: item.str.trim(), x, y, w: item.width });
    }
    pages.push({ page: p, words: out });
  }
  await doc.destroy();
  return pages;
}

/** Group words into visual lines by baseline, left to right. */
function toLines(ws: Word[], tolerance = 3): Word[][] {
  const sorted = [...ws].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Word[][] = [];
  for (const w of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0]!.y - w.y) <= tolerance) line.push(w);
    else lines.push([w]);
  }
  return lines.map((l) => l.sort((a, b) => a.x - b.x));
}

/** Words that sit next to each other are one cell ("HAIR RUBBER 72PC"). */
function mergeAdjacent(line: Word[], gap = 6): Word[] {
  const out: Word[] = [];
  for (const w of line) {
    const last = out[out.length - 1];
    if (last && w.x - (last.x + last.w) <= gap) {
      last.text = `${last.text} ${w.text}`;
      last.w = w.x + w.w - last.x;
    } else out.push({ ...w });
  }
  return out;
}

type Placed = { y: number; cells: Cell[]; numeric: boolean };

export async function pdfToRows(bytes: Uint8Array): Promise<Cell[][]> {
  const pages = await words(bytes);
  const total = pages.reduce((n, p) => n + p.words.length, 0);
  if (total === 0) return [];

  let columns: { x: number; text: string }[] | null = null;
  const header: Cell[][] = [];
  const placed: Placed[] = [];

  for (const page of pages) {
    const pageOffset = page.page * 100000; // keep pages in order on one y axis
    for (const raw of toLines(page.words)) {
      const line = mergeAdjacent(raw);
      const looksHeader = line.length >= 3 && line.filter((w) => HEADER_HINT.test(w.text)).length >= Math.ceil(line.length / 2);
      if (columns === null) {
        // The header: a line where most cells look like column names.
        if (looksHeader) {
          columns = line.map((w) => ({ x: w.x + w.w / 2, text: w.text }));
          header.push(columns.map((c) => c.text));
        }
        continue;
      }
      if (looksHeader) continue; // repeated on the next page
      // Drop every cell into the nearest header column by centre.
      const cells: Cell[] = columns.map(() => null);
      for (const w of line) {
        const centre = w.x + w.w / 2;
        let best = 0;
        for (let i = 1; i < columns.length; i += 1) {
          if (Math.abs(columns[i]!.x - centre) < Math.abs(columns[best]!.x - centre)) best = i;
        }
        cells[best] = cells[best] === null ? w.text : `${cells[best]} ${w.text}`;
      }
      const numeric = cells.filter((c) => typeof c === "string" && /^-?[\d,]+(\.\d+)?$/.test(c.trim())).length >= 2;
      placed.push({ y: -(pageOffset - line[0]!.y), cells, numeric });
    }
  }
  if (columns === null) return [];

  // A wrapped description prints as a line of its own with no numbers
  // on it. It belongs to the nearest line that has numbers — above or
  // below, whichever is closer, since cells centre vertically.
  const rows: Placed[] = placed.filter((p) => p.numeric);
  for (const text of placed.filter((p) => !p.numeric)) {
    if (rows.length === 0) break;
    let target = rows[0]!;
    for (const r of rows) if (Math.abs(r.y - text.y) < Math.abs(target.y - text.y)) target = r;
    if (Math.abs(target.y - text.y) > 40) continue; // a footer, a note — not part of a row
    const above = text.y > target.y; // y grows upwards on a PDF page
    text.cells.forEach((c, i) => {
      if (c === null) return;
      const have = target.cells[i];
      target.cells[i] = have === null || have === undefined ? c : above ? `${c} ${have}` : `${have} ${c}`;
    });
  }
  return [...header, ...rows.map((r) => r.cells)];
}
