"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Card, Empty, StatusBadge } from "@/components/admin/ui";
import { api } from "@/lib/api/client";
import type { WorkRow } from "@/lib/dispatch/ops";
import { fmtDay } from "@/lib/format/datetime";

import { downloadCsv, remember, type CsvColumn } from "../csv";

const VIEWS = [
  { value: "OPEN", label: "To do" },
  { value: "MINE", label: "Assigned to me" },
  { value: "READY", label: "Ready for outward" },
  { value: "PUTBACK", label: "Put back" },
  { value: "ALL", label: "All" },
] as const;
type View = (typeof VIEWS)[number]["value"];

type SortKey = "URGENT" | "OLDEST" | "NEWEST" | "LEAST" | "MOST";
const SORTS: { id: SortKey; label: string }[] = [
  { id: "URGENT", label: "Urgent first, then oldest" },
  { id: "OLDEST", label: "Oldest first" },
  { id: "NEWEST", label: "Newest first" },
  { id: "LEAST", label: "Least picked first" },
  { id: "MOST", label: "Most cartons first" },
];

type Filters = { view: View; warehouse: string; step: string; approval: string; priority: string; handling: string; person: string; sort: SortKey };
const EMPTY: Filters = { view: "OPEN", warehouse: "", step: "", approval: "", priority: "", handling: "", person: "", sort: "URGENT" };
const KEY = "wms.workFilters";

const n = (v: number) => v.toLocaleString("en-IN");
const select = "rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-2.5 py-2 text-sm text-verdigris-50";
const small = "rounded-xl border border-verdigris-300/15 px-3 py-2 text-xs text-verdigris-100 hover:border-verdigris-300/35 disabled:opacity-40";
// A carton number (INR-000002-0001, or just its digits) is looked up on the server: which note was it picked for?
const CARTONISH = /\d{4}/;

/** The work queue. Filters, sort and the view are remembered; the list refreshes every 30 seconds. */
export default function DispatchQueue({ initial }: { initial: WorkRow[] }) {
  const [f, setF] = useState<Filters>(EMPTY);
  const [rows, setRows] = useState(initial);
  const [q, setQ] = useState("");
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const ready = useRef(false);

  const serverQ = CARTONISH.test(q) ? q.trim() : "";
  const load = useCallback(async (v: View, sq: string) => {
    setLoading(true);
    // A carton is looked for in every note, whatever the tab.
    const r = await api<{ notes: WorkRow[] }>(`/dispatch?view=${sq ? "ALL" : v}${sq ? `&q=${encodeURIComponent(sq)}` : ""}`, { method: "GET" });
    setLoading(false);
    if (r.ok) setRows(r.data.notes);
  }, []);

  useEffect(() => {
    const saved = remember.get(KEY);
    if (saved) {
      try {
        const v = { ...EMPTY, ...(JSON.parse(saved) as Partial<Filters>) };
        setF(v);
        if (v.warehouse || v.step || v.approval || v.priority || v.handling || v.person) setMore(true);
      } catch {
        /* ignore a broken saved value */
      }
    }
    ready.current = true;
  }, []);
  const set = (p: Partial<Filters>) =>
    setF((cur) => {
      const next = { ...cur, ...p };
      remember.set(KEY, JSON.stringify(next));
      return next;
    });

  useEffect(() => {
    if (!ready.current && f.view === "OPEN" && !serverQ) return;
    const t = setTimeout(() => void load(f.view, serverQ), serverQ ? 300 : 0);
    return () => clearTimeout(t);
  }, [f.view, serverQ, load]);

  useEffect(() => {
    const t = setInterval(() => void load(f.view, serverQ), 30_000);
    return () => clearInterval(t);
  }, [f.view, serverQ, load]);

  const options = useMemo(
    () => ({
      warehouses: [...new Set(rows.map((r) => r.warehouseName))].sort(),
      steps: [...new Map(rows.map((r) => [r.workStatus, r.workLabel])).entries()],
      people: [...new Set(rows.flatMap((r) => r.assignees))].sort(),
    }),
    [rows],
  );

  const shown = useMemo(() => {
    const words = serverQ ? [] : q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = rows.filter((r) => {
      if (f.warehouse && r.warehouseName !== f.warehouse) return false;
      if (f.step && r.workStatus !== f.step) return false;
      if (f.approval && r.status !== f.approval) return false;
      if (f.priority && r.priority !== f.priority) return false;
      if (f.handling && r.handling !== f.handling) return false;
      if (f.person === "__none" ? r.assignees.length > 0 : f.person && !r.assignees.includes(f.person)) return false;
      if (!words.length) return true;
      const hay = [r.dnNo, r.buyerName, r.buyerCity ?? "", r.importerName, r.warehouseName, ...r.assignees].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const oldest = (a: WorkRow, b: WorkRow) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id;
    const by: Record<SortKey, (a: WorkRow, b: WorkRow) => number> = {
      URGENT: (a, b) => Number(b.priority === "URGENT") - Number(a.priority === "URGENT") || oldest(a, b),
      OLDEST: oldest,
      NEWEST: (a, b) => -oldest(a, b),
      LEAST: (a, b) => a.picked / Math.max(1, a.required) - b.picked / Math.max(1, b.required) || oldest(a, b),
      MOST: (a, b) => b.required - a.required || oldest(a, b),
    };
    return list.sort(by[f.sort]);
  }, [rows, q, serverQ, f]);
  const extra = [f.warehouse, f.step, f.approval, f.priority, f.handling, f.person].filter(Boolean).length;

  const csv: CsvColumn<WorkRow>[] = [
    { label: "Delivery note", value: (r) => r.dnNo },
    { label: "Date", value: (r) => r.dnDate },
    { label: "Buyer", value: (r) => r.buyerName },
    { label: "City", value: (r) => r.buyerCity },
    { label: "Importer", value: (r) => r.importerName },
    { label: "Warehouse", value: (r) => r.warehouseName },
    { label: "Approval", value: (r) => r.status },
    { label: "Step", value: (r) => r.workLabel },
    { label: "Priority", value: (r) => (r.priority === "URGENT" ? "Urgent" : "Normal") },
    { label: "Handling", value: (r) => r.handling },
    { label: "Cartons", value: (r) => r.required },
    { label: "Picked", value: (r) => r.picked },
    { label: "Packed", value: (r) => r.packed },
    { label: "Packages", value: (r) => r.packages },
    { label: "To put back", value: (r) => r.returning },
    { label: "Assigned", value: (r) => r.assignees.join(", ") },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="work-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search number, buyer, importer, person — or a carton number…"
          className="w-full max-w-sm rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-3.5 py-2.5 text-sm text-verdigris-50 placeholder:text-verdigris-200/35"
        />
        <div className="flex flex-wrap gap-1.5" id="work-views">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              id={`work-view-${v.value.toLowerCase()}`}
              onClick={() => set({ view: v.value })}
              className={`rounded-full border px-3 py-1.5 text-xs ${
                f.view === v.value ? "border-patina bg-patina/15 text-patina" : "border-verdigris-300/15 text-verdigris-200/70 hover:border-verdigris-300/35"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <button type="button" id="work-filters-toggle" onClick={() => setMore((v) => !v)} className={small}>
          Filters{extra ? ` (${extra})` : ""} {more ? "▴" : "▾"}
        </button>
        <select id="work-sort" aria-label="Sort" className={select} value={f.sort} onChange={(e) => set({ sort: e.target.value as SortKey })}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="button" id="work-download" disabled={shown.length === 0} onClick={() => downloadCsv("Pick and pack", csv, shown)} className={small}>
          Download Excel (CSV)
        </button>
        {loading ? <span className="text-xs text-verdigris-200/50">Loading…</span> : null}
      </div>

      {more ? (
        <div className="flex flex-wrap items-center gap-2" id="work-filters">
          {options.warehouses.length > 1 ? (
            <select id="work-f-warehouse" aria-label="Warehouse" className={select} value={f.warehouse} onChange={(e) => set({ warehouse: e.target.value })}>
              <option value="">All warehouses</option>
              {options.warehouses.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          ) : null}
          <select id="work-f-step" aria-label="Step" className={select} value={f.step} onChange={(e) => set({ step: e.target.value })}>
            <option value="">Any step</option>
            {options.steps.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <select id="work-f-approval" aria-label="Approval" className={select} value={f.approval} onChange={(e) => set({ approval: e.target.value })}>
            <option value="">Approved or not</option>
            <option value="APPROVED">Approved</option>
            <option value="PENDING">Not approved yet</option>
            <option value="REJECTED">Rejected</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <select id="work-f-priority" aria-label="Priority" className={select} value={f.priority} onChange={(e) => set({ priority: e.target.value })}>
            <option value="">Any priority</option>
            <option value="URGENT">Urgent</option>
            <option value="NORMAL">Normal</option>
          </select>
          <select id="work-f-handling" aria-label="Handling" className={select} value={f.handling} onChange={(e) => set({ handling: e.target.value })}>
            <option value="">Any handling</option>
            <option value="FRAGILE">Fragile</option>
            <option value="HANDLE_WITH_CARE">Handle with care</option>
            <option value="NORMAL">Normal</option>
          </select>
          <select id="work-f-person" aria-label="Assigned to" className={select} value={f.person} onChange={(e) => set({ person: e.target.value })}>
            <option value="">Assigned to anyone</option>
            <option value="__none">Nobody assigned</option>
            {options.people.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          {extra ? (
            <button
              type="button"
              id="work-f-clear"
              className="text-xs text-verdigris-300 hover:text-patina"
              onClick={() => set({ warehouse: "", step: "", approval: "", priority: "", handling: "", person: "" })}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}

      <Card className="overflow-hidden">
        {shown.length === 0 ? (
          <Empty
            title="Nothing here"
            hint={serverQ ? "No delivery note has that carton." : f.view === "MINE" ? "No delivery note is assigned to you right now." : "No delivery note matches."}
          />
        ) : (
          <div className="overflow-x-auto">
            <p className="px-4 pt-3 text-xs text-verdigris-200/60" id="work-count">
              {n(shown.length)} delivery note{shown.length === 1 ? "" : "s"} · {n(shown.reduce((s, r) => s + r.required, 0))} cartons ·{" "}
              {n(shown.reduce((s, r) => s + r.picked, 0))} picked
            </p>
            <table className="w-full text-sm" id="work-table">
              <thead>
                <tr className="border-b border-verdigris-300/10 text-left text-[0.72rem] uppercase tracking-[0.1em] text-verdigris-300">
                  <th className="px-4 py-3 font-medium">Delivery note</th>
                  <th className="px-4 py-3 font-medium">Buyer</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Picked</th>
                  <th className="px-4 py-3 text-right font-medium">Packed</th>
                  <th className="px-4 py-3 font-medium">Assigned</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-b border-verdigris-300/5 hover:bg-ink-900/30">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/dispatch/${r.id}`} className="font-mono font-semibold text-verdigris-50 hover:text-patina">
                        {r.dnNo}
                      </Link>
                      <p className="text-xs text-verdigris-200/55">
                        {fmtDay(r.dnDate)} · {r.warehouseName}
                        {r.priority === "URGENT" ? <span className="ml-1.5 text-amber-300">· Urgent</span> : null}
                        {r.handling !== "NORMAL" ? <span className="ml-1.5 text-rose-300">· {r.handling === "FRAGILE" ? "Fragile" : "Handle with care"}</span> : null}
                      </p>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="text-verdigris-50">{r.buyerName}</p>
                      <p className="text-xs text-verdigris-200/55">
                        {r.buyerCity ? `${r.buyerCity} · ` : ""}
                        {r.importerName}
                      </p>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge value={r.workStatus} />
                      {r.status === "PENDING" ? <p className="mt-1 text-xs text-amber-300/80">Not approved yet</p> : null}
                      {r.status === "REJECTED" || r.status === "CANCELLED" ? (
                        <p className="mt-1 text-xs text-rose-300/80">
                          {r.status === "REJECTED" ? "Rejected" : "Cancelled"} · {n(r.returning)} to put back
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-verdigris-100">
                      {n(r.picked)} / {n(r.required)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-verdigris-100">
                      {n(r.packed)}
                      <span className="block text-xs text-verdigris-200/50">{n(r.packages)} pkg</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-verdigris-100">
                      {r.assignees.length ? r.assignees.join(", ") : <span className="text-verdigris-200/45">Nobody yet</span>}
                      {r.mine ? <span className="ml-1 rounded-full border border-patina/40 px-1.5 text-[10px] text-patina">you</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
