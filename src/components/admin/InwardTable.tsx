"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Card, Empty, StatusBadge } from "@/components/admin/ui";
import type { InwardSummary } from "@/lib/inward/ops";

/**
 * The inward request list. One component for both sides: the dock reads
 * the importer column, the importer reads the warehouse column, and the
 * filter chips drop "Drafts" for the dock because it never sees one.
 */

const FILTERS: Array<{ label: string; value: string | null }> = [
  { label: "Open", value: "OPEN" },
  { label: "Drafts", value: "DRAFT" },
  { label: "Submitted", value: "SUBMITTED" },
  { label: "Needs changes", value: "NEEDS_CHANGES" },
  { label: "Acknowledged", value: "ACKNOWLEDGED" },
  { label: "In process", value: "IN_PROCESS" },
  { label: "Completed", value: "COMPLETED" },
  { label: "All", value: null },
];

export function fmt(n: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}

export default function InwardTable({
  rows,
  side,
  status,
  q,
  canCreate,
}: {
  rows: InwardSummary[];
  side: "importer" | "warehouse" | "all";
  status: string | null;
  q: string;
  canCreate: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(q);
  const dock = side === "warehouse";

  const go = (next: { status?: string | null; q?: string }) => {
    const p = new URLSearchParams(params.toString());
    if (next.status !== undefined) {
      if (next.status === null) p.delete("status");
      else p.set("status", next.status);
    }
    if (next.q !== undefined) {
      if (next.q.trim() === "") p.delete("q");
      else p.set("q", next.q.trim());
    }
    router.push(`/admin/inward${p.toString() ? `?${p.toString()}` : ""}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: search });
          }}
          className="flex-1 min-w-[16rem]"
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={dock ? "Number, container or importer…" : "Number or container…"}
            className="w-full rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-4 py-2.5 text-sm text-verdigris-50 placeholder:text-verdigris-200/35 focus:outline-none focus:ring-2 focus:ring-patina/25"
            aria-label="Search inward requests"
          />
        </form>
        {canCreate ? (
          <Link
            href="/admin/inward/new"
            className="rounded-xl bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina"
          >
            + New request
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.filter((f) => !(dock && f.value === "DRAFT")).map((f) => {
          const active = (status ?? null) === f.value || (status === undefined && f.value === "OPEN");
          return (
            <button
              key={f.label}
              type="button"
              onClick={() => go({ status: f.value })}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-patina/50 bg-patina/15 text-patina"
                  : "border-verdigris-300/15 text-verdigris-200/65 hover:border-verdigris-300/35"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <Empty
          title={dock ? "Nothing in the inbox" : "No requests here"}
          hint={
            dock
              ? "Importers' requests to your sites appear as they are submitted."
              : canCreate
                ? "Tell a warehouse what is coming with New request."
                : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-900/50 text-left text-xs uppercase tracking-[0.1em] text-verdigris-300">
                <tr>
                  <th className="px-4 py-3">Number</th>
                  <th className="px-4 py-3">Container</th>
                  <th className="px-4 py-3">{dock ? "Importer" : "Warehouse"}</th>
                  <th className="px-4 py-3">Expected</th>
                  <th className="px-4 py-3 text-right">Cartons</th>
                  <th className="px-4 py-3 text-right">Kg</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-verdigris-300/10">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-ink-900/40">
                    <td className="px-4 py-3 font-mono text-verdigris-100">
                      <Link href={`/admin/inward/${r.id}`} className="hover:text-patina">
                        {r.code}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-verdigris-50">{r.containerNumber ?? "—"}</td>
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
