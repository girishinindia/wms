/**
 * How old someone has to be, in one place.
 *
 * No `server-only` and no zod on purpose: the schema needs this to
 * refuse a birth date, and the form needs the same value for the date
 * picker's `max` so the day never appears in the first place. Two
 * answers to "how old is old enough" is how a form offers a date the
 * server then rejects.
 *
 * Computed per call rather than at module load. A server process lives
 * for days, and a boundary frozen at boot is one that quietly goes stale
 * the first time the clock passes midnight.
 */

export const ADULT_YEARS = 18;

/** India Standard Time is UTC+5:30 and never observes DST. Working in
 *  UTC would move the boundary by a day for anyone filling the form
 *  between midnight and half past five in the morning. */
const IST_OFFSET_MINUTES = 330;

/**
 * The latest birth date that still makes someone an adult today —
 * a plain `YYYY-MM-DD`, so it compares correctly as a string and drops
 * straight into an `<input type="date" max>`.
 */
export function latestAdultBirthDate(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  const year = ist.getUTCFullYear() - ADULT_YEARS;
  const month = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const day = String(ist.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** True when a `YYYY-MM-DD` birth date is old enough. */
export function isAdultBirthDate(value: string, now: Date = new Date()): boolean {
  return value <= latestAdultBirthDate(now);
}

export const ADULT_MESSAGE = `A sales agent must be at least ${ADULT_YEARS} years old`;
