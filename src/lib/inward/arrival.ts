/**
 * The expected-arrival rule, shared by the server and the form.
 *
 * A lorry booked for today is already late for the dock to plan around,
 * and a date in the past is a typo. So the earliest arrival anyone may
 * enter is TOMORROW — counted in India time, because that is where the
 * warehouses are and where "today" is decided, not in the server's UTC.
 *
 * Pure and dependency-free so the browser form and the API agree on the
 * same day without a round trip.
 */

const ZONE = "Asia/Kolkata";

/** Today's calendar date in India, as YYYY-MM-DD. */
export function indiaToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** A YYYY-MM-DD date moved by whole days (calendar arithmetic, no zone). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + days));
  return t.toISOString().slice(0, 10);
}

/** The first date an inward request may say the goods arrive. */
export function earliestArrival(now: Date = new Date()): string {
  return addDays(indiaToday(now), 1);
}

/** "2026-10-10" → "10 Oct 2026". */
export function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m! - 1];
  return `${d} ${month} ${y}`;
}

/** Null when the date is acceptable (or blank); otherwise what to tell the user. */
export function arrivalProblem(value: string | null | undefined, now: Date = new Date()): string | null {
  if (!value) return null;
  const first = earliestArrival(now);
  // ISO dates compare correctly as strings.
  return value < first ? `Expected arrival must be from tomorrow (${prettyDate(first)}) onwards` : null;
}
