"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Card, Empty, StatusBadge } from "@/components/admin/ui";
import { api } from "@/lib/api/client";
import {
  activeFilterCount,
  applyBoard,
  ARRIVAL_OPTIONS,
  EMPTY_FILTERS,
  filtersFromParams,
  filtersToParams,
  optionsOf,
  SORT_OPTIONS,
  STAGE_OPTIONS,
  type BoardFilters,
  type StatusChip,
} from "@/lib/inward/board";
import type { BoardRow } from "@/lib/inward/ops";

/**
 * The inward request list. One component for both sides: the dock reads
 * the importer column, the importer reads the warehouse column, and the
 * status chips drop "Drafts" for the dock because it never sees one.
 *
 * Every request in reach comes with the page, so search, chips, filters
 * and sort run right here as you type — no trip to the server. Only when
 * there are more than the page carries is the server asked, once, a
 * moment after the typing stops.
 */

const CHIPS: Array<{ label: string; value: StatusChip }> = [
  { label: "Open", value: "OPEN" },
  { label: "Drafts", value: "DRAFT" },
  { label: "Submitted", value: "SUBMITTED" },
  { label: "Needs changes", value: "NEEDS_CHANGES" },
  { label: "Acknowledged", value: "ACKNOWLEDGED" },
  { label: "In process", value: "IN_PROCESS" },
  { label: "Completed", value: "COMPLETED" },
  { label: "Cancelled", value: "CANCELLED" },
  { label: "All", value: "ALL" },
];

const KEY = "wms.inwardFilters";

export function fmt(n: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}

const select =
  "w-full rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 focus:outline-none focus:ring-2 focus:ring-patina/25";

export default function InwardTable({
  rows: initialRows,
  truncated: initialTruncated,
  side,
  initial,
  canCreate,
}: {
  rows: BoardRow[];
  truncated: boolean;
  side: "importer" | "warehouse" | "all";
  initial: BoardFilters;
  canCreate: boolean;
}) {
  const [f, setF] = useState<BoardFilters>(initial);
  const [rows, setRows] = useState(initialRows);
  const [truncated, setTruncated] = useState(initialTruncated);
  const [searching, setSearching] = useState(false);
  const [more, setMore] = useState(activeFilterCount(initial) > 0);
  const dock = side === "warehouse";
  // A platform user sees every importer and every site, so both columns.
  const both = side === "all";
  const box = useRef<HTMLInputElement>(null);

  // No view in the address: the one used last on this computer.
  useEffect(() => {
    if (window.location.search) return;
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved) {
        const restored = filtersFromParams(new URLSearchParams(saved));
        setF(restored);
        if (activeFilterCount(restored) > 0) setMore(true);
      }
    } catch {
      /* not remembered */
    }
  }, []);

  // Keep the address bar and this computer's memory in step, without reloading.
  useEffect(() => {
    const qs = filtersToParams(f).toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", url);
    try {
      // The view is remembered; the typed words are not.
      window.localStorage.setItem(KEY, filtersToParams({ ...f, q: "" }).toString());
    } catch {
      /* not remembered */
    }
  }, [f]);

  // "/" jumps to the search box, as on most lists.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && t?.tagName !== "INPUT" && t?.tagName !== "TEXTAREA" && t?.tagName !== "SELECT") {
        e.preventDefault();
        box.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // More requests than the page carries: ask the server for the typed words.
  const seq = useRef(0);
  useEffect(() => {
    if (!initialTruncated) return;
    const q = f.q.trim();
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      if (!q) {
        setRows(initialRows);
        setTruncated(initialTruncated);
        return;
      }
      setSearching(true);
      const r = await api<{ rows: BoardRow[]; truncated: boolean }>(
        `/inward-requests?view=board&q=${encodeURIComponent(q)}`,
        { method: "GET" },
      );
      if (mine !== seq.current) return;
      setSearching(false);
      if (r.ok) {
        setRows(r.data.rows);
        setTruncated(r.data.truncated);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [f.q, initialRows, initialTruncated]);

  const { rows: shown, counts } = useMemo(() => applyBoard(rows, f), [rows, f]);
  const warehouses = useMemo(() => optionsOf(rows, (r) => r.warehouse), [rows]);
  const importers = useMemo(() => optionsOf(rows, (r) => r.importer), [rows]);
  const transporters = useMemo(() => optionsOf(rows, (r) => r.transporter), [rows]);
  const ports = useMemo(() => optionsOf(rows, (r) => r.port), [rows]);
  const types = useMemo(() => optionsOf(rows, (r) => r.containerType), [rows]);

  const set = (p: Partial<BoardFilters>) => setF((cur) => ({ ...cur, ...p }));
  const num = (v: string) => (v ? Number(v) : null);
  const extra = activeFilterCount(f);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <input
            ref={box}
            id="inward-search"
            value={f.q}
            onChange={(e) => set({ q: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") set({ q: "" });
            }}
            placeholder={
              dock || both
                ? "Search number, container, importer, transporter, vehicle, driver or item…"
                : "Search number, container, transporter, vehicle, driver or item…"
            }
            className="w-full rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-4 py-2.5 pr-16 text-sm text-verdigris-50 placeholder:text-verdigris-200/35 focus:outline-none focus:ring-2 focus:ring-patina/25"
            aria-label="Search inward requests"
          />
          <div className="absolute inset-y-0 right-3 flex items-center gap-2">
            {searching ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-patina/30 border-t-patina" aria-label="Searching" />
            ) : null}
            {f.q ? (
              <button
                type="button"
                id="inward-search-clear"
                onClick={() => set({ q: "" })}
                className="text-lg leading-none text-verdigris-200/50 hover:text-patina"
                aria-label="Clear search"
              >
                ×
              </button>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          id="inward-filters-toggle"
          onClick={() => setMore((m) => !m)}
          className={`rounded-xl border px-4 py-2.5 text-sm transition-colors ${
            extra ? "border-patina/50 bg-patina/10 text-patina" : "border-verdigris-300/15 text-verdigris-100 hover:border-verdigris-300/35"
          }`}
        >
          Filters{extra ? ` (${extra})` : ""} {more ? "▴" : "▾"}
        </button>
        {canCreate ? (
          <Link
            href="/admin/inward/new"
            className="rounded-xl bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina"
          >
            + New request
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2" id="inward-chips">
        {CHIPS.filter((c) => !(dock && c.value === "DRAFT")).map((c) => {
          const active = f.status === c.value;
          return (
            <button
              key={c.value}
              type="button"
              id={`chip-${c.value}`}
              onClick={() => set({ status: c.value })}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active ? "border-patina/50 bg-patina/15 text-patina" : "border-verdigris-300/15 text-verdigris-200/65 hover:border-verdigris-300/35"
              }`}
            >
              {c.label} <span className={active ? "" : "text-verdigris-200/45"}>{fmt(counts[c.value])}</span>
            </button>
          );
        })}
      </div>

      {more ? (
        <div id="inward-filters">
          <Card className="p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(both || dock) && warehouses.length > 1 ? (
                <select id="f-warehouse" className={select} value={f.warehouseId ?? ""} onChange={(e) => set({ warehouseId: num(e.target.value) })} aria-label="Warehouse">
                  <option value="">All warehouses</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              ) : null}
              {side !== "importer" ? (
                <select id="f-importer" className={select} value={f.importerId ?? ""} onChange={(e) => set({ importerId: num(e.target.value) })} aria-label="Importer">
                  <option value="">All importers</option>
                  {importers.map((i) => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
              ) : null}
              <select
                id="f-arrival"
                className={select}
                value={f.arrival}
                onChange={(e) => set({ arrival: e.target.value as BoardFilters["arrival"] })}
                aria-label="Expected arrival"
              >
                {ARRIVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {f.arrival === "range" ? (
                <div className="flex items-center gap-2">
                  <input id="f-from" type="date" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} className={`${select} min-w-0`} aria-label="Arrival from" />
                  <span className="text-xs text-verdigris-200/50">to</span>
                  <input id="f-to" type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} className={`${select} min-w-0`} aria-label="Arrival to" />
                </div>
              ) : null}
              <select id="f-transporter" className={select} value={f.transporterId ?? ""} onChange={(e) => set({ transporterId: num(e.target.value) })} aria-label="Transporter">
                <option value="">All transporters</option>
                {transporters.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <select id="f-port" className={select} value={f.portId ?? ""} onChange={(e) => set({ portId: num(e.target.value) })} aria-label="Port">
                <option value="">All ports</option>
                {ports.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <select id="f-type" className={select} value={f.containerTypeId ?? ""} onChange={(e) => set({ containerTypeId: num(e.target.value) })} aria-label="Container type">
                <option value="">All container types</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {side !== "importer" ? (
                <select id="f-stage" className={select} value={f.stage} onChange={(e) => set({ stage: e.target.value as BoardFilters["stage"] })} aria-label="Carton stage">
                  {STAGE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : null}
              <select id="f-sort" className={select} value={f.sort} onChange={(e) => set({ sort: e.target.value as BoardFilters["sort"] })} aria-label="Sort">
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>Sort: {o.label}</option>
                ))}
              </select>
            </div>
            {extra || f.q ? (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  id="f-clear"
                  onClick={() => setF({ ...EMPTY_FILTERS, status: f.status })}
                  className="text-xs text-verdigris-200/60 hover:text-patina"
                >
                  Clear search and filters
                </button>
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}

      <p className="text-xs text-verdigris-200/55" id="inward-count">
        {shown.length === 1 ? "1 request" : `${fmt(shown.length)} requests`}
        {truncated && !f.q.trim() ? " · showing the latest — type to search all" : ""}
      </p>

      {shown.length === 0 ? (
        <Empty
          title={f.q || extra ? "Nothing matches" : dock ? "Nothing in the inbox" : "No requests here"}
          hint={
            f.q || extra
              ? "Try fewer words, another status chip, or clear the filters."
              : dock
                ? "Importers' requests to your sites appear as they are submitted."
                : canCreate
                  ? "Tell a warehouse what is coming with New request."
                  : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" id="inward-table">
              <thead className="bg-ink-900/50 text-left text-xs uppercase tracking-[0.1em] text-verdigris-300">
                <tr>
                  <th className="px-4 py-3">Number</th>
                  <th className="px-4 py-3">Container</th>
                  {both ? <th className="px-4 py-3">Importer</th> : null}
                  <th className="px-4 py-3">{dock ? "Importer" : "Warehouse"}</th>
                  <th className="px-4 py-3">Expected</th>
                  <th className="px-4 py-3 text-right">Cartons</th>
                  <th className="px-4 py-3 text-right">Kg</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-verdigris-300/10">
                {shown.map((r) => (
                  <tr key={r.id} className="hover:bg-ink-900/40">
                    <td className="px-4 py-3 font-mono text-verdigris-100">
                      <Link href={`/admin/inward/${r.id}`} className="hover:text-patina">
                        {r.code}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-verdigris-50">{r.containerNumber ?? "—"}</td>
                    {both ? <td className="px-4 py-3 text-verdigris-100">{r.importer.name}</td> : null}
                    <td className="px-4 py-3 text-verdigris-100">{dock ? r.importer.name : r.warehouse.name}</td>
                    <td className="px-4 py-3 text-verdigris-200/70">{r.expectedArrival ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-verdigris-100">{fmt(r.totals.cartons)}</td>
                    <td className="px-4 py-3 text-right text-verdigris-100">{fmt(r.totals.kg)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge value={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
