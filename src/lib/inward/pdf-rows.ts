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

type Doc = Awaited<ReturnType<typeof loadPdf>>;

async function words(doc: Doc): Promise<{ page: number; words: Word[] }[]> {
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

/** A picture on the page, with the same y axis the text lines use. */
export type PdfPicture = { y: number; bytes: Uint8Array; type: "image/webp" };

type PageDoc = Awaited<ReturnType<Doc["getPage"]>>;

/** pdfjs takes ownership of the buffer it is given, so it gets a copy. */
async function loadPdf(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true, isEvalSupported: false }).promise;
}

/**
 * The pictures drawn on a page, where they sit. A PDF draws an image
 * into the unit square under the current transform, so the transform
 * stack is replayed and the image's centre taken from it. Raw pixels
 * come back as RGB/RGBA and are re-encoded as a small WebP — the
 * register shows them at 40 px.
 */
async function pictures(page: PageDoc, pageOffset: number): Promise<PdfPicture[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { default: sharp } = await import("sharp");
  const ops = await page.getOperatorList();
  const out: PdfPicture[] = [];
  type M = [number, number, number, number, number, number];
  const mul = (a: M, b: M): M => [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[];
    if (fn === pdfjs.OPS.save) stack.push(ctm);
    else if (fn === pdfjs.OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === pdfjs.OPS.transform) ctm = mul(args as M, ctm);
    else if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintImageXObjectRepeat) {
      const name = String(args[0]);
      const img = await new Promise<{ width: number; height: number; data?: Uint8ClampedArray; kind?: number } | null>((resolve) => {
        try {
          page.objs.get(name, (o: unknown) => resolve(o as never));
        } catch {
          resolve(null);
        }
      });
      if (!img?.data || !img.width || !img.height) continue;
      const channels = img.kind === 3 ? 4 : img.kind === 2 ? 3 : 0;
      if (!channels) continue; // 1-bit masks are not pictures of goods
      if (img.width < 24 || img.height < 24) continue; // bullets, logos, rules
      const centreY = ctm[2] * 0.5 + ctm[3] * 0.5 + ctm[5];
      try {
        const webp = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
          raw: { width: img.width, height: img.height, channels },
        })
          .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer();
        out.push({ y: centreY - pageOffset, bytes: new Uint8Array(webp), type: "image/webp" });
      } catch {
        // An image sharp cannot read is simply not attached.
      }
    }
  }
  return out;
}

export async function pdfToRows(bytes: Uint8Array): Promise<Cell[][]> {
  return (await pdfToRowsWithPictures(bytes, { pictures: false })).rows;
}

/**
 * The table as cells, plus the picture on each row (keyed like the
 * cells: 1-based row in the returned array), when asked for.
 */
export async function pdfToRowsWithPictures(
  bytes: Uint8Array,
  options: { pictures: boolean } = { pictures: true },
): Promise<{ rows: Cell[][]; pictures: Map<number, PdfPicture> }> {
  const doc = await loadPdf(bytes);
  try {
    return await readDocument(doc, options);
  } finally {
    await doc.destroy();
  }
}

async function readDocument(
  doc: Doc,
  options: { pictures: boolean },
): Promise<{ rows: Cell[][]; pictures: Map<number, PdfPicture> }> {
  const none = { rows: [] as Cell[][], pictures: new Map<number, PdfPicture>() };
  const pages = await words(doc);
  const total = pages.reduce((n, p) => n + p.words.length, 0);
  if (total === 0) return none;

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
  if (columns === null) return none;

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

  // Pictures: each goes to the row whose text is nearest its centre.
  const byRow = new Map<number, PdfPicture>();
  if (options.pictures && rows.length) {
    const found: PdfPicture[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, 20); p += 1) {
      found.push(...(await pictures(await doc.getPage(p), p * 100000)));
    }
    for (const pic of found) {
      let best = 0;
      for (let i = 1; i < rows.length; i += 1) {
        if (Math.abs(rows[i]!.y - pic.y) < Math.abs(rows[best]!.y - pic.y)) best = i;
      }
      if (Math.abs(rows[best]!.y - pic.y) > 60) continue;
      const rowNo = header.length + best + 1;
      if (!byRow.has(rowNo)) byRow.set(rowNo, pic);
    }
  }
  return { rows: [...header, ...rows.map((r) => r.cells)], pictures: byRow };
}
