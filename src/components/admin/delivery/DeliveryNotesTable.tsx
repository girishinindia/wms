"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Card, Empty, StatusBadge } from "@/components/admin/ui";
import type { NoteSummary } from "@/lib/delivery/ops";
import { fmtDay } from "@/lib/format/datetime";

import { downloadCsv, remember, type CsvColumn } from "../csv";

const CHIPS = [
  { value: "ALL", label: "All" },
  { value: "PENDING", label: "Pending approval" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "CANCELLED", label: "Cancelled" },
] as const;

const WORK: Record<string, string> = {
  NEW: "New",
  ASSIGNED: "Assigned",
  PARTIALLY_PICKED: "Picking",
  PICKED: "Picked",
  PACKAGING_IN_PROGRESS: "Packing",
  PARTIALLY_PACKAGED: "Partly packed",
  PACKAGED: "Packed",
  VERIFICATION_PENDING: "Verifying",
  READY_FOR_DISPATCH: "Ready for dispatch",
  RETURNING: "Put back to storage",
  CANCELLED: "Closed",
  ON_HOLD: "On hold",
};

type SortKey = "PENDING" | "NEWEST" | "OLDEST" | "NUMBER" | "BUYER" | "CARTONS" | "WAREHOUSE";
const SORTS: { id: SortKey; label: string }[] = [
  { id: "PENDING", label: "Pending first, then newest" },
  { id: "NEWEST", label: "Newest first" },
  { id: "OLDEST", label: "Oldest first" },
  { id: "NUMBER", label: "Note number" },
  { id: "BUYER", label: "Buyer A–Z" },
  { id: "CARTONS", label: "Most cartons" },
  { id: "WAREHOUSE", label: "Warehouse" },
];

type Filters = { status: string; warehouse: string; importer: string; agent: string; priority: string; work: string; from: string; to: string; sort: SortKey };
const EMPTY: Filters = { status: "ALL", warehouse: "", importer: "", agent: "", priority: "", work: "", from: "", to: "", sort: "PENDING" };
const KEY = "wms.dnFilters";

const n = (v: number) => v.toLocaleString("en-IN");
const select = "rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-2.5 py-2 text-sm text-verdigris-50";
const small = "rounded-xl border border-verdigris-300/15 px-3 py-2 text-xs text-verdigris-100 hover:border-verdigris-300/35 disabled:opacity-40";

/**
 * The list, filtered on the screen as you type — every note in reach is
 * already here. Status chips, more filters, sort (also by clicking a column
 * heading), and a download of exactly the rows shown. The choices are
 * remembered on this computer.
 */
export default function DeliveryNotesTable({
  notes,
  showImporter,
  showAgent,
}: {
  notes: NoteSummary[];
  showImporter: boolean;
  showAgent: boolean;
}) {
  const [f, setF] = useState<Filters>(EMPTY);
  const [q, setQ] = useState("");
  const [more, setMore] = useState(false);

  useEffect(() => {
    const saved = remember.get(KEY);
    if (!saved) return;
    try {
      const v = { ...EMPTY, ...(JSON.parse(saved) as Partial<Filters>) };
      if (!SORTS.some((s) => s.id === v.sort)) v.sort = "PENDING";
      setF(v);
      if (v.warehouse || v.importer || v.agent || v.priority || v.work || v.from || v.to) setMore(true);
    } catch {
      /* ignore a broken saved value */
    }
  }, []);
  const set = (p: Partial<Filters>) =>
    setF((cur) => {
      const next = { ...cur, ...p };
      remember.set(KEY, JSON.stringify(next));
      return next;
    });

  const options = useMemo(
    () => ({
      warehouses: [...new Set(notes.map((r) => r.warehouseName))].sort(),
      importers: [...new Set(notes.map((r) => r.importerName))].sort(),
      agents: [...new Set(notes.map((r) => r.createdByName))].sort(),
      work: [...new Set(notes.map((r) => r.workStatus))],
    }),
    [notes],
  );

  const searched = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return notes.filter((r) => {
      if (f.warehouse && r.warehouseName !== f.warehouse) return false;
      if (f.importer && r.importerName !== f.importer) return false;
      if (f.agent && r.createdByName !== f.agent) return false;
      if (f.priority && r.priority !== f.priority) return false;
      if (f.work && r.workStatus !== f.work) return false;
      if (f.from && r.dnDate < f.from) return false;
      if (f.to && r.dnDate > f.to) return false;
      if (!words.length) return true;
      const hay = [r.dnNo, r.orderNo, r.buyerName, r.destination ?? "", r.warehouseName, r.importerName, r.createdByName].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [notes, q, f]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: searched.length, PENDING: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0 };
    for (const r of searched) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [searched]);
  const rows = useMemo(() => {
    const list = f.status === "ALL" ? [...searched] : searched.filter((r) => r.status === f.status);
    const newest = (a: NoteSummary, b: NoteSummary) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id;
    const by: Record<SortKey, (a: NoteSummary, b: NoteSummary) => number> = {
      PENDING: (a, b) => Number(b.status === "PENDING") - Number(a.status === "PENDING") || newest(a, b),
      NEWEST: newest,
      OLDEST: (a, b) => -newest(a, b),
      NUMBER: (a, b) => a.dnNo.localeCompare(b.dnNo, undefined, { numeric: true }),
      BUYER: (a, b) => a.buyerName.localeCompare(b.buyerName) || newest(a, b),
      CARTONS: (a, b) => b.cartons - a.cartons || newest(a, b),
      WAREHOUSE: (a, b) => a.warehouseName.localeCompare(b.warehouseName) || newest(a, b),
    };
    return list.sort(by[f.sort]);
  }, [searched, f.status, f.sort]);
  const extra = [f.warehouse, f.importer, f.agent, f.priority, f.work, f.from, f.to].filter(Boolean).length;

  // A column heading sorts by it; the note column flips newest / oldest.
  const th = (label: string, key: SortKey | null, right = false) => {
    const on = key !== null && (f.sort === key || (key === "NEWEST" && f.sort === "OLDEST"));
    return (
      <th className={`px-4 py-3 font-medium ${right ? "text-right" : ""}`}>
        {key ? (
          <button
            type="button"
            className={`uppercase tracking-[0.1em] hover:text-patina ${on ? "text-patina" : ""}`}
            onClick={() => set({ sort: key === "NEWEST" && f.sort === "NEWEST" ? "OLDEST" : key })}
          >
            {label}
            {on ? (f.sort === "OLDEST" ? " ▴" : " ▾") : ""}
          </button>
        ) : (
          label
        )}
      </th>
    );
  };

  const csv: CsvColumn<NoteSummary>[] = [
    { label: "Delivery note", value: (r) => r.dnNo },
    { label: "Date", value: (r) => r.dnDate },
    { label: "Order", value: (r) => r.orderNo },
    { label: "Buyer", value: (r) => r.buyerName },
    { label: "Destination", value: (r) => r.destination },
    { label: "Importer", value: (r) => r.importerName },
    { label: "Warehouse", value: (r) => r.warehouseName },
    { label: "Items", value: (r) => r.lines },
    { label: "Cartons", value: (r) => r.cartons },
    { label: "Pieces", value: (r) => r.pieces },
    { label: "Sales agent", value: (r) => r.createdByName },
    { label: "Priority", value: (r) => (r.priority === "URGENT" ? "Urgent" : "Normal") },
    { label: "Status", value: (r) => r.statusLabel },
    { label: "In the warehouse", value: (r) => WORK[r.workStatus] ?? r.workStatus },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="dn-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search number, buyer, agent, warehouse…"
          className="w-full max-w-sm rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-3.5 py-2.5 text-sm text-verdigris-50 placeholder:text-verdigris-200/35"
        />
        <div className="flex flex-wrap gap-1.5">
          {CHIPS.map((c) => (
            <button
              key={c.value}
              type="button"
              id={`dn-chip-${c.value.toLowerCase()}`}
              onClick={() => set({ status: c.value })}
              className={`rounded-full border px-3 py-1.5 text-xs ${
                f.status === c.value
                  ? "border-patina bg-patina/15 text-patina"
                  : "border-verdigris-300/15 text-verdigris-200/70 hover:border-verdigris-300/35"
              }`}
            >
              {c.label} <span className="font-mono opacity-70">{counts[c.value] ?? 0}</span>
            </button>
          ))}
        </div>
        <button type="button" id="dn-filters-toggle" onClick={() => setMore((v) => !v)} className={small}>
          Filters{extra ? ` (${extra})` : ""} {more ? "▴" : "▾"}
        </button>
        <select id="dn-sort" aria-label="Sort" className={select} value={f.sort} onChange={(e) => set({ sort: e.target.value as SortKey })}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="button" id="dn-download" disabled={rows.length === 0} onClick={() => downloadCsv("Delivery notes", csv, rows)} className={small}>
          Download Excel (CSV)
        </button>
      </div>

      {more ? (
        <div className="flex flex-wrap items-center gap-2" id="dn-filters">
          {options.warehouses.length > 1 ? (
            <select id="dn-f-warehouse" aria-label="Warehouse" className={select} value={f.warehouse} onChange={(e) => set({ warehouse: e.target.value })}>
              <option value="">All warehouses</option>
              {options.warehouses.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          ) : null}
          {showImporter && options.importers.length > 1 ? (
            <select id="dn-f-importer" aria-label="Importer" className={select} value={f.importer} onChange={(e) => set({ importer: e.target.value })}>
              <option value="">All importers</option>
              {options.importers.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          ) : null}
          {showAgent ? (
            <select id="dn-f-agent" aria-label="Made by" className={select} value={f.agent} onChange={(e) => set({ agent: e.target.value })}>
              <option value="">Made by anyone</option>
              {options.agents.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          ) : null}
          <select id="dn-f-priority" aria-label="Priority" className={select} value={f.priority} onChange={(e) => set({ priority: e.target.value })}>
            <option value="">Any priority</option>
            <option value="URGENT">Urgent</option>
            <option value="NORMAL">Normal</option>
          </select>
          <select id="dn-f-work" aria-label="In the warehouse" className={select} value={f.work} onChange={(e) => set({ work: e.target.value })}>
            <option value="">Any warehouse step</option>
            {Object.keys(WORK)
              .filter((k) => options.work.includes(k))
              .map((k) => (
                <option key={k} value={k}>
                  {WORK[k]}
                </option>
              ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-verdigris-200/70">
            Date from
            <input type="date" id="dn-f-from" className={select} value={f.from} onChange={(e) => set({ from: e.target.value })} />
          </label>
          <label className="flex items-center gap-1 text-xs text-verdigris-200/70">
            to
            <input type="date" id="dn-f-to" className={select} value={f.to} onChange={(e) => set({ to: e.target.value })} />
          </label>
          {extra ? (
            <button
              type="button"
              id="dn-f-clear"
              className="text-xs text-verdigris-300 hover:text-patina"
              onClick={() => set({ warehouse: "", importer: "", agent: "", priority: "", work: "", from: "", to: "" })}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <Empty
            title={notes.length === 0 ? "No delivery notes yet" : "Nothing matches"}
            hint={notes.length === 0 ? "Delivery notes appear here as soon as they are created." : "Try another word, status or filter."}
          />
        ) : (
          <div className="overflow-x-auto">
            <p className="px-4 pt-3 text-xs text-verdigris-200/60" id="dn-count">
              {n(rows.length)} delivery note{rows.length === 1 ? "" : "s"} · {n(rows.reduce((s, r) => s + r.cartons, 0))} cartons
            </p>
            <table className="w-full text-sm" id="dn-table">
              <thead>
                <tr className="border-b border-verdigris-300/10 text-left text-[0.72rem] uppercase tracking-[0.1em] text-verdigris-300">
                  {th("Delivery note", "NEWEST")}
                  {th("Buyer", "BUYER")}
                  {showImporter ? th("Importer", null) : null}
                  {th("Warehouse", "WAREHOUSE")}
                  {th("Cartons", "CARTONS", true)}
                  {showAgent ? th("Sales agent", null) : null}
                  {th("Status", "PENDING")}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-verdigris-300/5 last:border-0 hover:bg-verdigris-400/5">
                    <td className="px-4 py-3">
                      <Link href={`/admin/delivery-notes/${r.id}`} className="font-mono font-semibold text-verdigris-50 hover:text-patina">
                        {r.dnNo}
                      </Link>
                      <p className="text-xs text-verdigris-200/55">
                        {fmtDay(r.dnDate)} · {r.orderNo}
                        {r.priority === "URGENT" ? <span className="ml-1.5 text-amber-300">urgent</span> : null}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-verdigris-50">{r.buyerName}</p>
                      {r.destination ? <p className="text-xs text-verdigris-200/55">{r.destination}</p> : null}
                    </td>
                    {showImporter ? <td className="px-4 py-3 text-verdigris-100">{r.importerName}</td> : null}
                    <td className="px-4 py-3 text-verdigris-100">{r.warehouseName}</td>
                    <td className="px-4 py-3 text-right font-mono text-verdigris-50">
                      {n(r.cartons)}
                      <p className="text-xs text-verdigris-200/50">{n(r.pieces)} pcs</p>
                    </td>
                    {showAgent ? <td className="px-4 py-3 text-verdigris-100">{r.createdByName}</td> : null}
                    <td className="px-4 py-3">
                      <StatusBadge value={r.status === "PENDING" ? "PENDING_APPROVAL" : r.status} />
                      {r.approvalKind === "AUTO" ? <p className="mt-1 text-[0.7rem] text-emerald-300/80">auto-approved</p> : null}
                      {r.status !== "REJECTED" && r.status !== "CANCELLED" && r.workStatus !== "NEW" ? (
                        <p className="mt-1 text-[0.7rem] text-verdigris-200/65">{WORK[r.workStatus] ?? r.workStatus}</p>
                      ) : null}
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
