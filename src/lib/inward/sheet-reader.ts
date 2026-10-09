/**
 * Reading a packing list in the browser.
 *
 * Suppliers' sheets carry a picture per row and run to 8 MB, which is
 * more than one request may carry up to the server here. So the sheet
 * is opened where it was dropped: the cells go up as JSON (tiny), and
 * the pictures follow one at a time, each against the catalogue row
 * the import created. A PDF has no cells to read without a renderer,
 * so it goes up whole — they are small.
 *
 * Nothing here knows which column is which; that is `parsePackingList`
 * on the server, so the mobile app and the portal read the same sheet
 * the same way.
 */

import type { Cell } from "@/lib/inward/packing-list";

export type SheetPictures = Map<number, { blob: Blob; name: string }>;

export type ReadPackingFile =
  | { kind: "rows"; rows: Cell[][]; pictures: SheetPictures; sheet: string }
  | { kind: "pdf"; bytes: ArrayBuffer };

const SHEET_EXT = /\.(xlsx|xlsm|xls|csv)$/i;

export function acceptsPackingFile(name: string): boolean {
  return SHEET_EXT.test(name) || /\.pdf$/i.test(name);
}

export async function readPackingFile(file: File): Promise<ReadPackingFile> {
  const bytes = await file.arrayBuffer();
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") return { kind: "pdf", bytes };

  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "array", cellDates: false });
  const name = wb.SheetNames[0];
  if (!name) throw new Error("The workbook has no sheets");
  const ws = wb.Sheets[name]!;
  // range: 0 keeps row numbers aligned with the sheet even when the
  // list starts a few rows down; blankrows keeps the gaps.
  const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, defval: null, raw: true, blankrows: true, range: 0 });
  const cleaned: Cell[][] = rows.map((r) =>
    r.map((c) => (typeof c === "number" || typeof c === "string" || c === null ? c : c === undefined ? null : String(c))),
  );

  let pictures: SheetPictures = new Map();
  if (/\.xlsx$|\.xlsm$/i.test(file.name)) {
    try {
      pictures = await picturesByRow(bytes, wb.SheetNames.indexOf(name));
    } catch {
      pictures = new Map(); // No pictures is fine; the lines still import.
    }
  }
  return { kind: "rows", rows: cleaned, pictures, sheet: name };
}

/**
 * Pictures anchored in the sheet, keyed by the 1-based row they sit on.
 * Walks the OOXML parts by hand: workbook → sheet rels → drawing →
 * drawing rels → media. Only the first picture on a row is kept.
 */
async function picturesByRow(bytes: ArrayBuffer, sheetIndex: number): Promise<SheetPictures> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  const text = async (path: string) => zip.file(path)?.async("string") ?? null;

  const workbook = await text("xl/workbook.xml");
  const wbRels = await text("xl/_rels/workbook.xml.rels");
  if (!workbook || !wbRels) return new Map();
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*\br:id="([^"]+)"/g)].map((m) => m[1]!);
  const sheetRid = sheets[sheetIndex];
  if (!sheetRid) return new Map();
  const sheetTarget = relTarget(wbRels, sheetRid);
  if (!sheetTarget) return new Map();
  const sheetPath = resolvePath("xl/", sheetTarget);
  const sheetFile = sheetPath.split("/").pop()!;
  const sheetDir = sheetPath.slice(0, sheetPath.length - sheetFile.length);

  const sheetRels = await text(`${sheetDir}_rels/${sheetFile}.rels`);
  if (!sheetRels) return new Map();
  const drawingRel = [...sheetRels.matchAll(/<Relationship\b[^>]*>/g)]
    .map((m) => m[0])
    .find((r) => /\/drawing"/.test(r));
  const drawingTarget = drawingRel?.match(/Target="([^"]+)"/)?.[1];
  if (!drawingTarget) return new Map();
  const drawingPath = resolvePath(sheetDir, drawingTarget);
  const drawingFile = drawingPath.split("/").pop()!;
  const drawingDir = drawingPath.slice(0, drawingPath.length - drawingFile.length);

  const drawing = await text(drawingPath);
  const drawingRels = await text(`${drawingDir}_rels/${drawingFile}.rels`);
  if (!drawing || !drawingRels) return new Map();

  const out: SheetPictures = new Map();
  // Excel prefixes these xdr: / a: / r:; other writers use a default namespace.
  const anchors = drawing.matchAll(
    /<(?:xdr:)?(twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/(?:xdr:)?(?:twoCellAnchor|oneCellAnchor)>/g,
  );
  for (const a of anchors) {
    const block = a[0];
    const row = Number(block.match(/<(?:xdr:)?from>[\s\S]*?<(?:xdr:)?row>(\d+)<\/(?:xdr:)?row>/)?.[1]);
    const embed = block.match(/<(?:a:)?blip\b[^>]*\b(?:r:)?embed="([^"]+)"/)?.[1];
    if (!Number.isInteger(row) || !embed) continue;
    const sheetRow = row + 1;
    if (out.has(sheetRow)) continue;
    const target = relTarget(drawingRels, embed);
    if (!target) continue;
    const mediaPath = resolvePath(drawingDir, target);
    const entry = zip.file(mediaPath);
    if (!entry) continue;
    const ext = mediaPath.split(".").pop()!.toLowerCase();
    const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : null;
    if (!type) continue; // emf/wmf/gif — not something the register shows
    const blob = new Blob([await entry.async("arraybuffer")], { type });
    out.set(sheetRow, { blob, name: mediaPath.split("/").pop()! });
  }
  return out;
}

function relTarget(rels: string, id: string): string | null {
  const re = new RegExp(`<Relationship\\b[^>]*\\bId="${id}"[^>]*>`);
  const m = rels.match(re)?.[0];
  return m?.match(/Target="([^"]+)"/)?.[1] ?? null;
}

/** "xl/worksheets/" + "../drawings/drawing1.xml" → "xl/drawings/drawing1.xml". */
function resolvePath(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}
