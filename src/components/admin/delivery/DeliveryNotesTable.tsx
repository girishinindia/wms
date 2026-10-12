"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Card, Empty, StatusBadge } from "@/components/admin/ui";
import type { NoteSummary } from "@/lib/delivery/ops";
import { fmtDay } from "@/lib/format/datetime";

const CHIPS = [
  { value: "ALL", label: "All" },
  { value: "PENDING", label: "Pending approval" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "CANCELLED", label: "Cancelled" },
] as const;

const n = (v: number) => v.toLocaleString("en-IN");

/** The list, filtered on the screen as you type — every note in reach is already here. */
export default function DeliveryNotesTable({
  notes,
  showImporter,
  showAgent,
}: {
  notes: NoteSummary[];
  showImporter: boolean;
  showAgent: boolean;
}) {
  const [status, setStatus] = useState<(typeof CHIPS)[number]["value"]>("ALL");
  const [q, setQ] = useState("");

  const searched = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return notes;
    return notes.filter((r) => {
      const hay = [r.dnNo, r.orderNo, r.buyerName, r.destination ?? "", r.warehouseName, r.importerName, r.createdByName]
        .join(" ")
        .toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [notes, q]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: searched.length, PENDING: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0 };
    for (const r of searched) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [searched]);
  const rows = status === "ALL" ? searched : searched.filter((r) => r.status === status);

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
              onClick={() => setStatus(c.value)}
              className={`rounded-full border px-3 py-1.5 text-xs ${
                status === c.value
                  ? "border-patina bg-patina/15 text-patina"
                  : "border-verdigris-300/15 text-verdigris-200/70 hover:border-verdigris-300/35"
              }`}
            >
              {c.label} <span className="font-mono opacity-70">{counts[c.value] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <Empty
            title={notes.length === 0 ? "No delivery notes yet" : "Nothing matches"}
            hint={notes.length === 0 ? "Delivery notes appear here as soon as they are created." : "Try another word or status."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" id="dn-table">
              <thead>
                <tr className="border-b border-verdigris-300/10 text-left text-[0.72rem] uppercase tracking-[0.1em] text-verdigris-300">
                  <th className="px-4 py-3 font-medium">Delivery note</th>
                  <th className="px-4 py-3 font-medium">Buyer</th>
                  {showImporter ? <th className="px-4 py-3 font-medium">Importer</th> : null}
                  <th className="px-4 py-3 font-medium">Warehouse</th>
                  <th className="px-4 py-3 text-right font-medium">Cartons</th>
                  {showAgent ? <th className="px-4 py-3 font-medium">Sales agent</th> : null}
                  <th className="px-4 py-3 font-medium">Status</th>
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
