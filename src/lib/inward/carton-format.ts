/**
 * Carton numbers and what the QR on a carton sticker says.
 *
 * Pure, so the server, the print page and the tests agree on one shape.
 */

/** INR-000006 + 101 → INR-000006-0101. Grows past 9999 rather than wrapping. */
export function cartonNo(requestCode: string, seq: number): string {
  return `${requestCode}-${String(seq).padStart(4, "0")}`;
}

const CARTON_LINE = /^\s*Carton:\s*(\S+)/im;
const CARTON_NO = /\b(INR-\d{6,}-\d{4,})\b/i;

/**
 * Whatever the scanner handed over → the carton number in it, or null.
 *
 * A scan is the whole QR text (several lines, "Carton: …" among them); a
 * hand-typed entry is just the number, maybe in lower case or with spaces.
 */
export function cartonNoFromScan(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const line = CARTON_LINE.exec(text)?.[1];
  const hit = CARTON_NO.exec(line ?? text)?.[1] ?? CARTON_NO.exec(text.replace(/\s+/g, ""))?.[1];
  return hit ? hit.toUpperCase() : null;
}

export type LabelData = {
  cartonNo: string;
  seq: number;
  total: number;
  inwardCode: string;
  warehouseName: string;
  importerName: string;
  importerMobile: string | null;
  importerEmail: string | null;
  importerLogoUrl: string | null;
  itemCode: string | null;
  description: string;
  piecesPerCarton: number;
  unitCode: string | null;
  kgPerCarton: number;
  vehicle: string | null;
  driverName: string | null;
  driverMobile: string | null;
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** "13.000" → "13", "6.500" → "6.5" — what a person writes. */
export function kg(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

/**
 * The text inside the QR. Plain "Label: value" lines, so ANY phone camera
 * shows something a person can read — and our scanner finds the carton
 * number on the first line. Kept to about 300 characters so the code stays
 * easy to read off a 40 mm thermal sticker.
 */
export function qrText(l: LabelData): string {
  const lines = [
    `Carton: ${l.cartonNo}`,
    `Inward: ${l.inwardCode}`,
    `Importer: ${clip(l.importerName, 50)}`,
    l.importerMobile ? `Mobile: ${l.importerMobile}` : null,
    l.importerEmail ? `Email: ${clip(l.importerEmail, 60)}` : null,
    `Item: ${[l.itemCode, clip(l.description, 60)].filter(Boolean).join(" - ")}`,
    `Pcs/Carton: ${l.piecesPerCarton}${l.unitCode ? ` ${l.unitCode}` : ""}`,
    `KG: ${kg(l.kgPerCarton)}`,
    l.vehicle ? `Vehicle: ${l.vehicle}` : null,
    l.driverName ? `Driver: ${l.driverName}${l.driverMobile ? ` (${l.driverMobile})` : ""}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Initials for the logo square when the importer has no logo yet. */
export function initials(name: string): string {
  const words = name
    .replace(/\b(pvt|private|ltd|limited|llp|inc|co)\b\.?/gi, "")
    .split(/\s+/)
    .filter(Boolean);
  return (words.length >= 2 ? words[0]![0]! + words[1]![0]! : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

const AT = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
const DAY = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

/** "10:56 am" today, "9 Oct, 10:56 am" before — for "already received at …". */
export function scanWhen(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) return "";
  // Postgres text: "2026-10-11 05:26:06.8+00" — make it ISO ("…T…+00:00").
  const d = value instanceof Date ? value : new Date(String(value).replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  if (Number.isNaN(d.getTime())) return "";
  const time = AT.format(d).replace(/\s?([AP]M)$/i, (_m, x: string) => ` ${x.toLowerCase()}`);
  return DAY.format(d) === DAY.format(now) ? time : `${DAY.format(d)}, ${time}`;
}

/** "Already received by Hardik Chaudhary at 10:56 am — not counted again." */
export function alreadyText(what: string, by: string | null | undefined, at: string | Date | null | undefined): string {
  const who = by?.trim() ? ` by ${by.trim()}` : "";
  const when = scanWhen(at);
  return `${what}${who}${when ? ` at ${when}` : ""} — not counted again`;
}
