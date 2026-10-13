import "server-only";

import { sql, type SQL } from "drizzle-orm";

import type { Filters } from "./lens";

/**
 * Time buckets for trend charts: a day each up to two months, a week each
 * up to six months, then a month each — so a chart never has 300 bars.
 */
export type Unit = "day" | "week" | "month";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function unitOf(f: Filters): Unit {
  const days = (day(f.to) - day(f.from)) / 86_400_000 + 1;
  return days <= 62 ? "day" : days <= 184 ? "week" : "month";
}

/** The bucket start dates (YYYY-MM-DD) covering the period. */
export function bucketsOf(f: Filters, unit: Unit = unitOf(f)): string[] {
  const out: string[] = [];
  let ms = day(f.from);
  if (unit === "week") {
    const dow = (new Date(ms).getUTCDay() + 6) % 7; // Monday = 0, as date_trunc('week')
    ms -= dow * 86_400_000;
  }
  if (unit === "month") ms = day(`${f.from.slice(0, 7)}-01`);
  while (ms <= day(f.to) && out.length < 400) {
    out.push(iso(ms));
    if (unit === "month") {
      const d = new Date(ms);
      ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    } else ms += (unit === "week" ? 7 : 1) * 86_400_000;
  }
  return out;
}

export function bucketLabel(b: string, unit: Unit): string {
  const m = MONTHS[Number(b.slice(5, 7)) - 1];
  if (unit === "month") return `${m} ${b.slice(2, 4)}`;
  return `${Number(b.slice(8, 10))} ${m}`;
}

/** SQL: the bucket (as text YYYY-MM-DD) of a timestamp, India time. */
export function bucketSql(ts: SQL, unit: Unit): SQL {
  return sql`to_char(date_trunc(${unit}, ${ts} at time zone 'Asia/Kolkata'), 'YYYY-MM-DD')`;
}

/** Rows {b, n} → numbers in bucket order (missing buckets are 0). */
export function align(buckets: string[], rows: { b: string; n: number | string }[]): number[] {
  const m = new Map(rows.map((r) => [r.b, Number(r.n)]));
  return buckets.map((b) => m.get(b) ?? 0);
}
