"use client";

/**
 * A list as a file Excel opens straight away: comma separated, every
 * value quoted when it needs to be, and a byte-order mark so Excel reads
 * Indian names and ₹ correctly. Built in the browser from exactly the rows
 * on screen (after search, filters and sort) — no trip to the server.
 */

export type CsvColumn<T> = { label: string; value: (row: T) => string | number | null | undefined };

const cell = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // A leading = + - @ would be run as a formula by Excel: keep it text.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  return [columns.map((c) => cell(c.label)).join(","), ...rows.map((r) => columns.map((c) => cell(c.value(r))).join(","))].join("\r\n");
}

/** "Delivery notes 2026-10-12.csv" — today's date in India. */
export function csvName(what: string): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  // Plain letters only: some browsers drop a file name with "·" or "—" in it.
  const safe = what
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/[^\x20-\x7E]+/g, "-")
    .replace(/\s*-\s*-+\s*|\s+-\s+/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
  return `${safe} ${day}.csv`;
}

export function downloadCsv<T>(name: string, columns: CsvColumn<T>[], rows: T[]) {
  const blob = new Blob(["﻿", toCsv(columns, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = csvName(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Local storage that never throws (private windows, blocked storage). */
export const remember = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* not remembered */
    }
  },
};
