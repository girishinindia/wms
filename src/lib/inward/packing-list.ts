/**
 * A packing list, as importers actually send them.
 *
 * The sheet every supplier mails looks like this, give or take a column:
 *
 *   ITEM NO | PICTURE | DESCRIBE | CTN | QTY | (unit) | TT.QTY | KG | TT.KG
 *
 * Nothing is standard beyond that: the header is in row 1 or row 4,
 * "QTY" means pieces per carton on one sheet and the total on another,
 * the unit sits in a column with no header, a totals row closes the
 * list, and "KG" is per carton unless the total column says otherwise.
 * This module turns the cells into lines a request can hold, and says
 * exactly which rows it could not use and why — the person importing
 * decides, not the parser.
 *
 * Pure: cells in, lines out. The route feeds it the sheet; the tests
 * feed it the sample files' rows verbatim.
 */

export type Cell = string | number | null | undefined;

export type ParsedLine = {
  /** 1-based row in the sheet, for the report. */
  row: number;
  code: string | null;
  description: string;
  cartonQty: number;
  piecesPerCarton: number;
  unitCode: string | null;
  kgPerCarton: number;
};

export type Skipped = { row: number; reason: string };

export type ParsedPackingList = {
  headerRow: number;
  lines: ParsedLine[];
  skipped: Skipped[];
  /** Totals the sheet claims, when it has a totals row — handy to show. */
  sheetTotals: { cartons: number | null; kg: number | null } | null;
};

type Column = "code" | "description" | "cartons" | "piecesPerCarton" | "unit" | "totalPieces" | "kgPerCarton" | "totalKg";

/** Header spellings seen in the wild, lower-cased and squeezed. */
const HEADERS: Record<Column, RegExp[]> = {
  code: [/^item\s*(no|number|code|#)?\.?$/, /^(art|article)\s*(no|code)?\.?$/, /^(sku|code|model|style)(\s*no\.?)?$/, /^part\s*no\.?$/],
  description: [/^(describe|description|desc|particulars|item\s*name|name|goods|commodity)\.?$/],
  cartons: [/^(ctn|ctns|carton|cartons|cnt|no\.?\s*of\s*(ctn|cartons?)|total\s*ctns?|box|boxes)\.?$/],
  piecesPerCarton: [/^(qty|q'ty|quantity)(\s*\/?\s*(ctn|carton|per\s*ctn))?$/, /^(pcs|pc|pieces)\s*(\/|per)\s*(ctn|carton)$/, /^pack(ing)?$/],
  unit: [/^(unit|uom|units?|measure)$/],
  totalPieces: [/^(tt|ttl|tot|total)\.?\s*(qty|q'ty|quantity|pcs|pieces)$/, /^(qty|quantity)\s*total$/],
  kgPerCarton: [/^(kg|kgs|n\.?\s*w\.?|g\.?\s*w\.?|weight|wt|kg\s*\/?\s*(ctn|carton))\.?$/, /^(n|g)\.?w\.?\s*\/?\s*ctn$/],
  totalKg: [/^(tt|ttl|tot|total)\.?\s*(kg|kgs|n\.?w\.?|g\.?w\.?|weight|wt)$/, /^(kg|weight)\s*total$/],
};

const squeeze = (v: Cell): string =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();

const asNumber = (v: Cell): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = v.replace(/,/g, "").trim();
  if (t === "" || /^#/.test(t)) return null; // "#REF!" and friends
  const m = t.match(/^-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

const isUnitWord = (v: Cell): boolean => typeof v === "string" && /^[a-z]{2,8}s?$/i.test(v.trim()) && asNumber(v) === null;

function matchHeader(cell: Cell): Column | null {
  const h = squeeze(cell).toLowerCase();
  if (h === "") return null;
  for (const [column, patterns] of Object.entries(HEADERS) as [Column, RegExp[]][]) {
    if (patterns.some((p) => p.test(h))) return column;
  }
  return null;
}

/**
 * Find the header row: the first row that names at least a quantity
 * column and one of code/description. Returns the column map.
 */
function findHeader(rows: Cell[][]): { row: number; map: Map<Column, number> } | null {
  for (let r = 0; r < Math.min(rows.length, 30); r += 1) {
    const map = new Map<Column, number>();
    rows[r]?.forEach((cell, c) => {
      const col = matchHeader(cell);
      if (col && !map.has(col)) map.set(col, c);
    });
    const hasQty = map.has("piecesPerCarton") || map.has("cartons");
    const hasName = map.has("code") || map.has("description");
    if (hasQty && hasName) return { row: r, map };
  }
  return null;
}

export function parsePackingList(rows: Cell[][]): ParsedPackingList {
  const header = findHeader(rows);
  if (!header) {
    return {
      headerRow: 0,
      lines: [],
      skipped: [{ row: 1, reason: "No header row found — expected columns like ITEM NO, DESCRIBE, CTN, QTY, KG" }],
      sheetTotals: null,
    };
  }
  const { map } = header;
  const col = (c: Column): number | undefined => map.get(c);

  // The unit usually has no header: it is the text column right after
  // QTY ("PCS", "SET"). Sniff it from the data when nothing claims it.
  let unitCol = col("unit");
  if (unitCol === undefined && col("piecesPerCarton") !== undefined) {
    const after = col("piecesPerCarton")! + 1;
    const sample = rows.slice(header.row + 1, header.row + 8).map((r) => r?.[after]);
    if (sample.some(isUnitWord) && !sample.some((v) => asNumber(v) !== null)) unitCol = after;
  }

  const lines: ParsedLine[] = [];
  const skipped: Skipped[] = [];
  let sheetTotals: ParsedPackingList["sheetTotals"] = null;

  for (let r = header.row + 1; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const rowNo = r + 1;
    if (row.every((c) => c === null || c === undefined || squeeze(c) === "")) continue;

    const code = col("code") === undefined ? null : squeeze(row[col("code")!]) || null;
    const description = col("description") === undefined ? "" : squeeze(row[col("description")!]);
    const cartons = col("cartons") === undefined ? null : asNumber(row[col("cartons")!]);
    let perCarton = col("piecesPerCarton") === undefined ? null : asNumber(row[col("piecesPerCarton")!]);
    const totalPieces = col("totalPieces") === undefined ? null : asNumber(row[col("totalPieces")!]);
    let kg = col("kgPerCarton") === undefined ? null : asNumber(row[col("kgPerCarton")!]);
    const totalKg = col("totalKg") === undefined ? null : asNumber(row[col("totalKg")!]);
    let unitRaw = unitCol === undefined ? null : squeeze(row[unitCol]);
    // A PDF has no empty-headed column: "120 PCS" lands in QTY as one cell.
    if (!unitRaw && col("piecesPerCarton") !== undefined) {
      const m = squeeze(row[col("piecesPerCarton")!]).match(/^-?[\d,.]+\s+([A-Za-z]{2,8})$/);
      if (m) unitRaw = m[1]!;
    }

    // A totals row: numbers, no name. Keep what it claims, skip it.
    if (code === null && description === "") {
      if (cartons !== null || totalKg !== null) {
        sheetTotals = { cartons, kg: totalKg ?? kg };
        continue;
      }
      skipped.push({ row: rowNo, reason: "No item number or description" });
      continue;
    }

    // "QTY" as a total: derive per-carton when the sheet only has totals.
    if (perCarton === null && totalPieces !== null && cartons) perCarton = totalPieces / cartons;
    if (perCarton !== null && cartons && totalPieces !== null && Math.abs(perCarton * cartons - totalPieces) > 0.5) {
      // QTY was the total after all (QTY × CTN ≠ TT.QTY but QTY ÷ CTN works).
      if (Math.abs(perCarton - totalPieces) < 0.5) perCarton = totalPieces / cartons;
    }
    if (kg === null && totalKg !== null && cartons) kg = totalKg / cartons;
    if (kg !== null && cartons && totalKg !== null && Math.abs(kg * cartons - totalKg) > 0.05 * Math.max(1, totalKg)) {
      // KG was the total: KG ÷ CTN gives the per-carton figure.
      if (Math.abs(kg - totalKg) < 0.01) kg = totalKg / cartons;
    }

    const problems: string[] = [];
    if (cartons === null || cartons <= 0) problems.push("cartons");
    if (perCarton === null || perCarton <= 0) problems.push("pieces per carton");
    if (kg === null || kg <= 0) problems.push("kg per carton");
    if (problems.length) {
      skipped.push({ row: rowNo, reason: `Missing ${problems.join(", ")}` });
      continue;
    }

    lines.push({
      row: rowNo,
      code,
      description: description || code || "",
      cartonQty: Math.round(cartons!),
      piecesPerCarton: Math.round(perCarton!),
      unitCode: unitRaw ? unitRaw.toUpperCase().replace(/[^A-Z]/g, "") || null : null,
      kgPerCarton: Math.round(kg! * 1000) / 1000,
    });
  }

  return { headerRow: header.row + 1, lines, skipped, sheetTotals };
}

/**
 * Map the unit words a packing list uses onto the measurement-unit
 * register: "PCS" / "PC" / "PIECE" → PCS, "SETS" → SET, "PKT" → PKT…
 */
export function unitAlias(word: string | null): string | null {
  if (!word) return null;
  const w = word.toUpperCase().replace(/[^A-Z]/g, "");
  const table: Record<string, string> = {
    PC: "PCS", PCS: "PCS", PIECE: "PCS", PIECES: "PCS", NOS: "PCS", NO: "PCS", EA: "PCS", EACH: "PCS", UNIT: "PCS", UNITS: "PCS",
    SET: "SET", SETS: "SET",
    PKT: "PKT", PKTS: "PKT", PACKET: "PKT", PACKETS: "PKT", PACK: "PKT", PACKS: "PKT", PK: "PKT",
    BOX: "BOX", BOXES: "BOX", BX: "BOX",
    BOTTLE: "BOTTLE", BOTTLES: "BOTTLE", BTL: "BOTTLE", BTLS: "BOTTLE",
    ROLL: "ROLL", ROLLS: "ROLL", RL: "ROLL",
    PAIR: "PAIR", PAIRS: "PAIR", PR: "PAIR", PRS: "PAIR",
    KG: "KG", KGS: "KG", KILO: "KG", KILOGRAM: "KG",
    LTR: "LTR", LTRS: "LTR", L: "LTR", LITRE: "LTR", LITER: "LTR",
    MTR: "MTR", MTRS: "MTR", M: "MTR", METRE: "MTR", METER: "MTR",
    JAR: "JAR", JARS: "JAR",
    DOZ: "DOZ", DOZEN: "DOZ", DZN: "DOZ",
    BAG: "BAG", BAGS: "BAG",
  };
  return table[w] ?? w;
}
