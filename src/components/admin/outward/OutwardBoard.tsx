"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { SortMenu, SortTh, useSort } from "@/components/admin/SortTh";
import { Card, Empty } from "@/components/admin/ui";
import { api } from "@/lib/api/client";
import { fmtDay } from "@/lib/format/datetime";
import type { DoRow, OutwardBoard as Board, OutwardView, ReadyNote } from "@/lib/outward/ops";

import { downloadCsv, type CsvColumn } from "../csv";

const TABS: { id: OutwardView; label: string; hint: string }[] = [
  { id: "READY", label: "Ready to load", hint: "Verified packages waiting for a dispatch order" },
  { id: "LOADING", label: "Loading", hint: "Dispatch orders being checked and loaded" },
  { id: "LOADED", label: "Loaded", hint: "On the vehicle — confirm when it leaves" },
  { id: "LR_PENDING", label: "LR pending", hint: "Left — the Lorry Receipt is still to come" },
  { id: "LR_VERIFY", label: "LR to verify", hint: "LR attached — the manager checks it" },
  { id: "DONE", label: "Done", hint: "Left, with a verified LR" },
  { id: "ALL", label: "All", hint: "Every dispatch order, cancelled ones too" },
];

const TONE: Record<string, string> = {
  PENDING_VERIFICATION: "border-amber-400/40 bg-amber-500/10 text-amber-100",
  READY_FOR_OUTWARD: "border-patina/40 bg-patina/10 text-verdigris-50",
  LOADING_IN_PROGRESS: "border-sky-400/40 bg-sky-500/10 text-sky-100",
  LOADED: "border-violet-400/40 bg-violet-500/10 text-violet-100",
  DISPATCHED: "border-emerald-400/40 bg-emerald-500/10 text-emerald-100",
  ON_HOLD: "border-rose-400/50 bg-rose-500/10 text-rose-100",
  CANCELLED: "border-verdigris-300/20 bg-ink-900/60 text-verdigris-200/60",
};
const LR_TONE: Record<string, string> = {
  MISSING: "text-rose-300",
  REJECTED: "text-rose-300",
  PENDING: "text-amber-200",
  COLLECTED: "text-amber-200",
  SUBMITTED: "text-amber-200",
  UPLOADED: "text-sky-200",
  VERIFIED: "text-emerald-300",
};

const n = (v: number) => v.toLocaleString("en-IN");

export function DoPill({ status, label }: { status: string; label: string }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[0.75rem] font-medium ${TONE[status] ?? TONE.CANCELLED}`}>{label}</span>;
}

const csv: CsvColumn<DoRow>[] = [
  { label: "Dispatch order", value: (d) => d.doNo },
  { label: "Delivery note", value: (d) => d.dnNo },
  { label: "Status", value: (d) => d.statusLabel },
  { label: "Buyer", value: (d) => d.buyerName ?? "" },
  { label: "Destination", value: (d) => d.destination ?? "" },
  { label: "Importer", value: (d) => d.importerName },
  { label: "Warehouse", value: (d) => d.warehouseName },
  { label: "Transporter", value: (d) => d.transportName ?? "" },
  { label: "Vehicle", value: (d) => d.vehicleNo ?? "" },
  { label: "Driver", value: (d) => d.driverName ?? "" },
  { label: "Packages", value: (d) => d.packages },
  { label: "Cartons", value: (d) => d.cartons },
  { label: "Dispatched at", value: (d) => d.dispatchedAt ?? "" },
  { label: "LR", value: (d) => d.lrLabel },
];

/** The outward board: one tab per step, a count on each, search across DO / note / vehicle / LR / carton. */
export default function OutwardBoard({ initial, canCreate }: { initial: Board; canCreate: boolean }) {
  const [board, setBoard] = useState(initial);
  const [view, setView] = useState<OutwardView>(initial.view);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const first = useRef(true);

  const load = useCallback(async (v: OutwardView, text: string) => {
    setLoading(true);
    const r = await api<Board>(`/outward?view=${v}${text.trim() ? `&q=${encodeURIComponent(text.trim())}` : ""}`, { method: "GET" });
    setLoading(false);
    if (r.ok) setBoard(r.data);
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => void load(view, q), 250);
    return () => clearTimeout(t);
  }, [view, q, load]);

  // Vehicles come and go: keep the board fresh.
  useEffect(() => {
    const t = setInterval(() => void load(view, q), 30_000);
    return () => clearInterval(t);
  }, [view, q, load]);

  const tab = TABS.find((t) => t.id === view)!;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="outward-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="DO no., note no., buyer, vehicle, LR no., carton…"
          className="w-full max-w-sm rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-3.5 py-2.5 text-sm text-verdigris-50 placeholder:text-verdigris-200/35"
        />
        {view !== "READY" ? (
          <button
            type="button"
            id="outward-download"
            disabled={board.orders.length === 0}
            onClick={() => downloadCsv("Dispatch orders", csv, board.orders)}
            className="rounded-xl border border-verdigris-300/15 px-3 py-2 text-xs text-verdigris-100 hover:border-verdigris-300/35 disabled:opacity-40"
          >
            Download Excel (CSV)
          </button>
        ) : null}
        {loading ? <span className="text-xs text-verdigris-200/50">Loading…</span> : null}
      </div>
      <div className="flex flex-wrap gap-1.5" id="outward-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`outward-tab-${t.id}`}
            aria-selected={view === t.id}
            onClick={() => setView(t.id)}
            className={`rounded-full border px-3 py-1.5 text-xs ${
              view === t.id ? "border-patina bg-patina/15 text-verdigris-50" : "border-verdigris-300/15 text-verdigris-200/70 hover:border-verdigris-300/35"
            }`}
          >
            {t.label}
            <span className={`ml-1.5 rounded-full px-1.5 py-0.5 font-mono text-[0.68rem] ${board.counts[t.id] ? "bg-patina/25 text-verdigris-50" : "text-verdigris-200/45"}`}>
              {n(board.counts[t.id] ?? 0)}
            </span>
          </button>
        ))}
      </div>
      <p className="text-xs text-verdigris-200/55">{tab.hint}</p>

      {view === "READY" ? <ReadyList notes={board.ready} canCreate={canCreate} /> : <OrderList orders={board.orders} view={view} />}
    </div>
  );
}

function ReadyList({ notes, canCreate }: { notes: ReadyNote[]; canCreate: boolean }) {
  const { rows, sort, set } = useSort(notes, {
    note: (r) => r.dnNo,
    buyer: (r) => r.buyerName,
    packages: (r) => r.readyPackages,
    cartons: (r) => r.readyCartons,
    urgent: (r) => (r.priority === "URGENT" ? 1 : 0),
    ready: (r) => r.readyAt,
  });
  if (!notes.length) return <Card className="p-6"><Empty title="Nothing waiting" hint="A delivery note shows here once its packages are verified and it is approved." /></Card>;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <SortMenu
          id="outward-ready-sort"
          sort={sort}
          onPick={set}
          options={[
            { value: "", label: "Board order" },
            { value: "urgent", label: "Urgent first", key: "urgent", dir: "desc" },
            { value: "ready-old", label: "Ready longest", key: "ready", dir: "asc" },
            { value: "note", label: "Note number", key: "note", dir: "asc" },
            { value: "buyer", label: "Buyer, A to Z", key: "buyer", dir: "asc" },
            { value: "packages", label: "Most packages", key: "packages", dir: "desc" },
            { value: "cartons", label: "Most cartons", key: "cartons", dir: "desc" },
          ]}
        />
      </div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" id="outward-ready">
      {rows.map((r) => (
        <Card key={r.id} className="flex flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/admin/delivery-notes/${r.id}`} className="font-mono text-sm font-semibold text-verdigris-50 hover:text-patina">
                {r.dnNo}
              </Link>
              <p className="truncate text-sm text-verdigris-100">{r.buyerName}{r.destination ? ` · ${r.destination}` : ""}</p>
              <p className="truncate text-xs text-verdigris-200/60">{r.importerName} · {r.warehouseName}</p>
            </div>
            {r.priority === "URGENT" ? <span className="rounded-full border border-rose-400/40 px-2 py-0.5 text-[0.7rem] text-rose-200">Urgent</span> : null}
          </div>
          <p className="text-sm text-verdigris-50">
            <b className="font-mono">{n(r.readyPackages)}</b> package{r.readyPackages === 1 ? "" : "s"} · <b className="font-mono">{n(r.readyCartons)}</b> carton{r.readyCartons === 1 ? "" : "s"} ready
            {r.open > r.readyCartons ? <span className="text-xs text-amber-200"> · {n(r.open - r.readyCartons)} more still being packed</span> : null}
          </p>
          <p className="text-xs text-verdigris-200/60">{r.transportName ? `Transport: ${r.transportName}` : "No transporter on the note yet"}{r.readyAt ? ` · ready ${fmtDay(r.readyAt)}` : ""}</p>
          {canCreate ? (
            <Link
              href={`/admin/outward/new?note=${r.id}`}
              id={`outward-create-${r.id}`}
              className="mt-auto rounded-xl bg-verdigris-400 px-4 py-2 text-center text-sm font-semibold text-ink-900 hover:bg-patina"
            >
              Make dispatch order
            </Link>
          ) : null}
        </Card>
      ))}
    </div>
    </div>
  );
}

function OrderList({ orders, view }: { orders: DoRow[]; view: OutwardView }) {
  const { rows, sort, toggle } = useSort(orders, {
    do: (d) => d.doNo,
    buyer: (d) => d.buyerName,
    vehicle: (d) => d.vehicleNo,
    packages: (d) => d.packages,
    status: (d) => d.statusLabel,
    lr: (d) => d.lrLabel,
  });
  if (!orders.length) return <Card className="p-6"><Empty title="Nothing here" hint="Try another tab, or clear the search." /></Card>;
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" id="outward-table">
          <thead>
            <tr className="border-b border-verdigris-300/10 text-left text-[0.72rem] uppercase tracking-[0.1em] text-verdigris-300">
              <SortTh label="Dispatch order" k="do" sort={sort} onSort={toggle} className="px-4 py-3 font-medium" />
              <SortTh label="Buyer" k="buyer" sort={sort} onSort={toggle} className="px-4 py-3 font-medium" />
              <SortTh label="Vehicle" k="vehicle" sort={sort} onSort={toggle} className="px-4 py-3 font-medium" />
              <SortTh label="Packages" k="packages" sort={sort} onSort={toggle} numeric right className="px-4 py-3 font-medium" />
              <SortTh label="Status" k="status" sort={sort} onSort={toggle} className="px-4 py-3 font-medium" />
              <SortTh label="LR" k="lr" sort={sort} onSort={toggle} className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="border-b border-verdigris-300/5 hover:bg-patina/5" id={`outward-row-${d.id}`}>
                <td className="px-4 py-3">
                  <Link href={`/admin/outward/${d.id}`} className="font-mono font-semibold text-verdigris-50 hover:text-patina">{d.doNo}</Link>
                  <p className="font-mono text-xs text-verdigris-200/55">{d.dnNo}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="text-verdigris-100">{d.buyerName}</p>
                  <p className="text-xs text-verdigris-200/55">{[d.destination, d.importerName].filter(Boolean).join(" · ")}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-mono text-verdigris-100">{d.vehicleNo ?? <span className="text-amber-200">—</span>}</p>
                  <p className="text-xs text-verdigris-200/55">{d.transportName ?? ""}</p>
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {view === "LOADING" && d.status === "LOADING_IN_PROGRESS" ? `${n(d.loaded)} / ${n(d.packages)}` : n(d.packages)}
                  <p className="text-xs text-verdigris-200/55">{n(d.cartons)} ctn</p>
                </td>
                <td className="px-4 py-3">
                  <DoPill status={d.status} label={d.statusLabel} />
                  {d.status === "ON_HOLD" && d.holdReason ? <p className="mt-1 max-w-[16rem] truncate text-xs text-rose-200/80">{d.holdReason}</p> : null}
                  {d.dispatchedAt ? <p className="mt-1 text-xs text-verdigris-200/55">left {fmtDay(d.dispatchedAt)}</p> : null}
                </td>
                <td className={`px-4 py-3 text-xs ${LR_TONE[d.lrStatus] ?? "text-verdigris-200/50"}`}>
                  {d.lrLabel}
                  {d.lrDaysOut !== null && d.lrDaysOut > 0 ? <span className="block text-[0.7rem] opacity-80">{d.lrDaysOut} day{d.lrDaysOut === 1 ? "" : "s"} since it left</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
