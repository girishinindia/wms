/**
 * Floor and gala codes, and what a gala's QR label says.
 *
 * Pure, so the server, the label printer, the store screen and the tests
 * agree on one shape:
 *
 *   Warehouse WH-0001 › Floor 1 (F1) › Gala 2 (F1-G02)
 *   QR: "Gala: WH-0001-F1-G02" + the names, readable by any phone.
 */

export const floorCode = (floorNo: number) => `F${floorNo}`;

/** F1-G02, F1-G10, F1-G100 — two digits until a floor passes 99 galas. */
export const galaCode = (floorNo: number, galaNo: number) =>
  `F${floorNo}-G${String(galaNo).padStart(2, "0")}`;

export type GalaLabel = {
  warehouseCode: string;
  warehouseName: string;
  floorNo: number;
  galaNo: number;
  code: string;
};

/** The full ID in the QR: the warehouse code in front, so a label from
 *  one site can never pass for the same gala at another. */
export const galaFullId = (warehouseCode: string, code: string) => `${warehouseCode}-${code}`;

export function galaQrText(l: GalaLabel): string {
  return [
    `Gala: ${galaFullId(l.warehouseCode, l.code)}`,
    `Warehouse: ${l.warehouseName}`,
    `Floor ${l.floorNo} · Gala ${l.galaNo}`,
  ].join("\n");
}

// The warehouse code is whatever the register says (WH-0001, BOM-01…),
// so anything before "-F<n>-G<nn>" is taken as the warehouse.
const FULL = /([A-Z0-9][A-Z0-9-]*?)-(F\d{1,2}-G\d{2,3})\b/i;
const SHORT = /^\s*(F\d{1,2})\s*-?\s*G\s*(\d{1,3})\s*$/i;

/**
 * A scanned or typed gala → { warehouseCode?, code }, or null.
 * "Gala: WH-0001-F1-G02 …" (the QR) → both; "f1-g2" / "F1G02" typed → code only.
 */
export function galaFromScan(raw: string): { warehouseCode: string | null; code: string } | null {
  const text = raw.trim();
  if (!text) return null;
  const full = FULL.exec(text);
  if (full) return { warehouseCode: full[1]!.toUpperCase(), code: full[2]!.toUpperCase() };
  const short = SHORT.exec(text);
  if (short) {
    const floor = short[1]!.toUpperCase();
    return { warehouseCode: null, code: `${floor}-G${String(Number(short[2])).padStart(2, "0")}` };
  }
  return null;
}
