/**
 * Dates, rendered the same on both sides of the wire.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────
 *
 * `toLocaleString` reads the TIME ZONE OF THE MACHINE unless told
 * otherwise. Every admin screen here is server-rendered and then
 * hydrated, so the same instant is formatted twice: once by a server
 * running in UTC, once by a browser in Mumbai. Five and a half hours
 * apart, and React finds text it did not render:
 *
 *     server HTML   26 Aug 2026, 05:10 am
 *     browser       26 Aug 2026, 10:40 am
 *     → Minified React error #418 (args[]=text)
 *
 * React throws that subtree away and re-renders it on the client. The
 * page mostly survives, which is why this went unnoticed: an error in
 * the console and a flash of the wrong time.
 *
 * A date WITHOUT a time is not safe either — it just fails less
 * visibly. Between 00:00 and 05:30 IST the UTC clock is still on the
 * previous day, so roughly a quarter of the time a date-only field
 * shows the wrong day, with no console error to say so.
 *
 * ── WHY IT IS SHARED ────────────────────────────────────────────────
 *
 * Four call sites in this codebase already passed `timeZone:
 * "Asia/Kolkata"` and twelve did not. That ratio is the argument: this
 * cannot be a thing each author remembers. It is the default here, and
 * `tests/datetime.test.ts` fails the build if a component formats a
 * Date any other way.
 *
 * ── WHY Asia/Kolkata ────────────────────────────────────────────────
 *
 * Not a new decision — the one the four correct call sites already
 * made. The product is India-only: `+91` is a fixed prefix on every
 * mobile field, money is formatted `en-IN`, and the warehouses are in
 * Maharashtra. A warehouse clerk reading a timestamp wants the time on
 * the clock on the wall, not UTC and not the timezone of whichever
 * region the server happens to run in.
 *
 * If the product ever operates outside one zone, this is the file to
 * change, and per-user preference is the change to make — not removing
 * the pin, which just brings the mismatch back.
 */

const ZONE = "Asia/Kolkata";
const LOCALE = "en-IN";

/**
 * Built once each, not per call.
 *
 * `Intl.DateTimeFormat` construction is the expensive part — parsing
 * the locale and loading the zone's rules — and these render inside
 * table cells, so a list of 300 rows would otherwise build 300 of them
 * on every keystroke in the search box.
 */
const DAY = new Intl.DateTimeFormat(LOCALE, {
  day: "2-digit", month: "short", year: "numeric", timeZone: ZONE,
});

const DATE_TIME = new Intl.DateTimeFormat(LOCALE, {
  day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", timeZone: ZONE,
});

const TIME = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: ZONE,
});

/**
 * An em dash for absent, and for unparseable.
 *
 * These take whatever the database handed the page — a timestamp, null
 * on a nullable column, occasionally a string that is not a date at
 * all. `new Date("nonsense")` is an Invalid Date, and formatting one
 * produces the literal text "Invalid Date" in a table cell. A dash is
 * the same thing the rest of the panel already shows for "nothing
 * here", and it does not look like a bug the reader has to report.
 */
const EMPTY = "—";

function parse(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `26 Aug 2026` */
export function fmtDay(value: string | Date | null | undefined): string {
  const date = parse(value);
  return date ? DAY.format(date) : EMPTY;
}

/** `26 Aug 2026, 10:40 am` */
export function fmtDateTime(value: string | Date | null | undefined): string {
  const date = parse(value);
  return date ? DATE_TIME.format(date) : EMPTY;
}

/** `10:40:22 am` — the clock alone, for a column that shows the day
 *  separately above it. */
export function fmtTime(value: string | Date | null | undefined): string {
  const date = parse(value);
  return date ? TIME.format(date) : EMPTY;
}
