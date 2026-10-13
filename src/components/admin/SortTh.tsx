"use client";

import { useMemo, useState, type ReactNode } from "react";

import { ChevronIcon } from "@/components/icons";

/**
 * Column sorting for the tables that load their rows whole — the inward
 * list, delivery notes, pick & pack, outward, and the lines inside a
 * request or a note. The DataTable screens (importers, users, the master
 * lists) sort through TanStack; this gives the hand-built tables the
 * same behaviour and the same arrow:
 *
 *   first click  ↑ ascending (numbers and dates: largest / newest first)
 *   second click ↓ the other way
 *   third click  back to the screen's own order
 *
 * Empty values always go last, whichever way.
 */

export type SortValue = string | number | null | undefined;
export type SortState = { key: string; dir: "asc" | "desc" } | null;

/** The rows in the given order. Empty values last; ties keep the screen's order. */
export function sortRows<T>(rows: T[], get: Record<string, (row: T) => SortValue>, sort: SortState): T[] {
  if (!sort || !get[sort.key]) return rows;
  const pick = get[sort.key]!;
  const sign = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: pick(row) }))
    .sort((a, b) => {
      const x = a.v;
      const y = b.v;
      const xe = x === null || x === undefined || x === "";
      const ye = y === null || y === undefined || y === "";
      if (xe || ye) return xe && ye ? a.i - b.i : xe ? 1 : -1;
      const c =
        typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y), "en-IN", { numeric: true, sensitivity: "base" });
      return c * sign || a.i - b.i;
    })
    .map((e) => e.row);
}

/** A heading click: ↑, ↓, then off. Numbers and dates start high. */
export function nextSort(current: SortState, key: string, numeric = false): SortState {
  const first: "asc" | "desc" = numeric ? "desc" : "asc";
  if (!current || current.key !== key) return { key, dir: first };
  if (current.dir === first) return { key, dir: first === "asc" ? "desc" : "asc" };
  return null;
}

export function useSort<T>(rows: T[], get: Record<string, (row: T) => SortValue>) {
  const [sort, setSort] = useState<SortState>(null);
  // `get` is a fresh object each render; the keys are what matter.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => sortRows(rows, get, sort), [rows, sort]);
  const toggle = (key: string, numeric = false) => setSort((s) => nextSort(s, key, numeric));
  /** Back to the screen's own order (e.g. when its sort menu changes). */
  const clear = () => setSort(null);
  return { rows: sorted, sort, toggle, clear, set: setSort };
}

/** A header cell that sorts its column. */
export function SortTh({
  label,
  k,
  sort,
  onSort,
  numeric = false,
  right = false,
  className = "px-4 py-3",
}: {
  label: ReactNode;
  k: string;
  sort: SortState;
  onSort: (key: string, numeric?: boolean) => void;
  numeric?: boolean;
  right?: boolean;
  className?: string;
}) {
  const dir = sort?.key === k ? sort.dir : null;
  return (
    <th
      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
      className={`${className} ${right ? "text-right" : "text-left"} ${dir ? "text-verdigris-100" : ""}`}
    >
      <button
        type="button"
        data-sort={k}
        onClick={() => onSort(k, numeric)}
        className={`inline-flex items-center gap-1 uppercase hover:text-verdigris-50 ${right ? "flex-row-reverse" : ""}`}
        title="Sort"
      >
        {label}
        <ChevronIcon aria-hidden className={`h-3 w-3 transition-transform ${dir ? "opacity-100" : "opacity-35"} ${dir === "asc" ? "rotate-180" : ""}`} />
      </button>
    </th>
  );
}

/**
 * The same sort for a grid of cards, where there is no column heading
 * to click: a small menu of "what to sort by". The first entry is the
 * screen's own order.
 */
export function SortMenu({
  id,
  options,
  sort,
  onPick,
}: {
  id: string;
  options: { value: string; label: string; key?: string; dir?: "asc" | "desc" }[];
  sort: SortState;
  onPick: (s: SortState) => void;
}) {
  const current = options.find((o) => o.key && sort && o.key === sort.key && o.dir === sort.dir)?.value ?? options[0]?.value ?? "";
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-verdigris-200/65">
      Sort
      <select
        id={id}
        value={current}
        onChange={(e) => {
          const o = options.find((x) => x.value === e.target.value);
          onPick(o?.key ? { key: o.key, dir: o.dir ?? "asc" } : null);
        }}
        className="rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-xs text-verdigris-100"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
