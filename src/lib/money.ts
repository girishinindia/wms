/**
 * Rupees on the screen, paise in the database.
 *
 * No "server-only" here on purpose: the drawer converts one way to fill
 * an input and the API converts the other way to store a row, and the
 * whole point of this file is that both directions live in one place. A
 * rounding rule implemented twice is a rounding rule that disagrees with
 * itself the first time somebody types 0.145.
 *
 * Everything stored is an INTEGER number of paise. Money is never a
 * float: 0.1 + 0.2 is not 0.3 in binary floating point, and a rounding
 * error in a rent figure is a phone call, not a rounding error.
 */

/** ₹10 crore, in paise. Matches the CHECK on `expense.amount_paise`. */
export const MAX_PAISE = 100_000_000_000;

/**
 * "42300.00" — for the value of a text input.
 *
 * Always two decimals, never grouped: a thousands separator inside an
 * `<input>` is something the user has to delete before they can type.
 */
export function paiseToInput(paise: number): string {
  return (paise / 100).toFixed(2);
}

/**
 * "₹42,300.00" — for reading.
 *
 * Indian grouping (`en-IN`), so ₹1,00,00,000 reads the way a lakh and a
 * crore are actually written here, not as 10,000,000.
 */
export function formatPaise(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

/**
 * What somebody typed → paise, or null if it was not a number.
 *
 * Accepts what people actually paste: `₹`, spaces, and the commas from a
 * copied invoice line. Rejects anything with more than two decimals
 * rather than silently rounding it — `1234.567` is a typo or a foreign
 * currency, and quietly storing ₹1,234.57 is the wrong kind of helpful.
 *
 * `Math.round` on the last step, not truncation: 12.34 in binary is
 * 12.339999999999999857891452847979962825775146484375, so `* 100` gives
 * 1233.9999999999998 and `Math.trunc` would file a bill one paisa short.
 */
export function inputToPaise(raw: string | number): number | null {
  const text = String(raw).replace(/[₹,\s]/g, "").trim();
  if (text === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const paise = Math.round(Number(text) * 100);
  return Number.isSafeInteger(paise) ? paise : null;
}
