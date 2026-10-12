"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Card, Empty, StatusBadge } from "@/components/admin/ui";
import { api } from "@/lib/api/client";
import type { WorkRow } from "@/lib/dispatch/ops";
import { fmtDay } from "@/lib/format/datetime";

const VIEWS = [
  { value: "OPEN", label: "To do" },
  { value: "MINE", label: "Assigned to me" },
  { value: "READY", label: "Ready for dispatch" },
  { value: "PUTBACK", label: "Put back" },
  { value: "ALL", label: "All" },
] as const;
type View = (typeof VIEWS)[number]["value"];

const n = (v: number) => v.toLocaleString("en-IN");

/** The work queue: urgent first, then oldest. Refreshes every 30 seconds. */
export default function DispatchQueue({ initial }: { initial: WorkRow[] }) {
  const [view, setView] = useState<View>("OPEN");
  const [rows, setRows] = useState(initial);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const first = useRef(true);

  const load = useCallback(async (v: View) => {
    setLoading(true);
    const r = await api<{ notes: WorkRow[] }>(`/dispatch?view=${v}`, { method: "GET" });
    setLoading(false);
    if (r.ok) setRows(r.data.notes);
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void load(view);
  }, [view, load]);

  useEffect(() => {
    const t = setInterval(() => void load(view), 30_000);
    return () => clearInterval(t);
  }, [view, load]);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return rows;
    return rows.filter((r) => {
      const hay = [r.dnNo, r.buyerName, r.buyerCity ?? "", r.importerName, r.warehouseName, ...r.assignees].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [rows, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="work-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search number, buyer, importer, person…"
          className="w-full max-w-sm rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-3.5 py-2.5 text-sm text-verdigris-50 placeholder:text-verdigris-200/35"
        />
        <div className="flex flex-wrap gap-1.5" id="work-views">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              id={`work-view-${v.value.toLowerCase()}`}
              onClick={() => setView(v.value)}
              className={`rounded-full border px-3 py-1.5 text-xs ${
                view === v.value ? "border-patina bg-patina/15 text-patina" : "border-verdigris-300/15 text-verdigris-200/70 hover:border-verdigris-300/35"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {loading ? <span className="text-xs text-verdigris-200/50">Loading…</span> : null}
      </div>

      <Card className="overflow-hidden">
        {shown.length === 0 ? (
          <Empty title="Nothing here" hint={view === "MINE" ? "No delivery note is assigned to you right now." : "No delivery note matches."} />
        ) : (
          <div className="overflow-x-auto">
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
                        <p className="mt-1 text-xs text-rose-300/80">{r.status === "REJECTED" ? "Rejected" : "Cancelled"} · {n(r.returning)} to put back</p>
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
