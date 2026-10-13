"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";

import { Card } from "@/components/admin/ui";
import { api } from "@/lib/api/client";
import { fmtDateTime } from "@/lib/format/datetime";
import { PREVIEW_ROWS, type Column, type ReportResult } from "@/lib/insights/report-types";
import { PERIOD_LABELS } from "@/lib/insights/types";

type Query = { period: string; from: string; to: string; warehouseId: number | null; importerId: number | null; status: string | null };

const NUM = new Set(["int", "num", "money", "pct", "hours", "days"]);

function show(v: string | number | null, c: Column): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") {
    if (c.type === "money") return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (c.type === "pct") return `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;
    if (c.type === "hours") return `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })} h`;
    if (c.type === "days") return `${v} d`;
    return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }
  if (c.key === "photo" && v.startsWith("http")) return "Photo";
  return v;
}

/** One report: filters on top, the preview table (sortable), totals, and the downloads. */
export default function ReportView({ initial }: { initial: ReportResult }) {
  const router = useRouter();
  const path = usePathname();
  const [r, setR] = useState(initial);
  const [q, setQ] = useState<Query>(initial.filters);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const seq = useRef(0);

  const params = useCallback((x: Query) => {
    const p = new URLSearchParams({ period: x.period });
    if (x.period === "custom") {
      p.set("from", x.from);
      p.set("to", x.to);
    }
    if (x.warehouseId) p.set("warehouseId", String(x.warehouseId));
    if (x.importerId) p.set("importerId", String(x.importerId));
    if (x.status) p.set("status", x.status);
    return p;
  }, []);

  const change = async (patch: Partial<Query>) => {
    const next = { ...q, ...patch };
    setQ(next);
    const mine = ++seq.current;
    setLoading(true);
    const p = params(next);
    router.replace(`${path}?${p.toString()}`, { scroll: false });
    const res = await api<{ report: ReportResult }>(`/insights/reports/${r.meta.key}?${p.toString()}`, { method: "GET" });
    if (mine !== seq.current) return;
    setLoading(false);
    if (!res.ok) return setError(res.error.message);
    setError(null);
    setR(res.data.report);
  };

  const rows = useMemo(() => {
    if (!sort) return r.rows;
    const c = r.meta.columns.find((x) => x.key === sort.key);
    const num = c && NUM.has(c.type);
    return [...r.rows].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (num ? Number(x) - Number(y) : String(x).localeCompare(String(y), "en-IN", { numeric: true })) * sort.dir;
    });
  }, [r, sort]);

  const dl = (format: string) => `/api/v1/insights/reports/${r.meta.key}?${params(q).toString()}&format=${format}`;
  const sel = "rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-xs text-verdigris-100";
  const hasTotals = Object.keys(r.totals).length > 0 && r.rows.length > 0;

  return (
    <div className="space-y-4" id="report">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2" id="report-filters">
          {r.meta.period ? (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Period">
              {Object.entries(PERIOD_LABELS).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  id={`report-period-${k}`}
                  aria-pressed={q.period === k}
                  onClick={() => void change({ period: k })}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs ${q.period === k ? "border-patina bg-patina/15 text-verdigris-50" : "border-verdigris-300/15 text-verdigris-200/70 hover:border-verdigris-300/35"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <span className="rounded-lg border border-verdigris-300/15 px-2.5 py-1.5 text-xs text-verdigris-200/70">As of now</span>
          )}
          {r.meta.period && q.period === "custom" ? (
            <span className="flex items-center gap-1 text-xs text-verdigris-200/60">
              <input type="date" id="report-from" value={q.from} max={q.to} onChange={(e) => e.target.value && void change({ from: e.target.value })} className={sel} />
              to
              <input type="date" id="report-to" value={q.to} min={q.from} onChange={(e) => e.target.value && void change({ to: e.target.value })} className={sel} />
            </span>
          ) : null}
          {r.options.warehouses.length > 1 ? (
            <select id="report-warehouse" value={q.warehouseId ?? ""} onChange={(e) => void change({ warehouseId: e.target.value ? Number(e.target.value) : null })} className={sel}>
              <option value="">All warehouses</option>
              {r.options.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
          ) : null}
          {r.options.importers.length > 1 ? (
            <select id="report-importer" value={q.importerId ?? ""} onChange={(e) => void change({ importerId: e.target.value ? Number(e.target.value) : null })} className={`${sel} max-w-[14rem]`}>
              <option value="">All importers</option>
              {r.options.importers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
          ) : null}
          {r.meta.statuses.length ? (
            <select id="report-status" value={q.status ?? ""} onChange={(e) => void change({ status: e.target.value || null })} className={sel}>
              <option value="">Any status</option>
              {r.meta.statuses.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          ) : null}
          {loading ? <span className="text-xs text-verdigris-200/50">Updating…</span> : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-verdigris-300/10 pt-3">
          <p className="text-xs text-verdigris-200/65" id="report-count">
            {r.count.toLocaleString("en-IN")} row{r.count === 1 ? "" : "s"}
            {r.meta.period ? ` · ${r.filters.from} to ${r.filters.to}` : ""}
            {r.count > r.rows.length ? ` · showing the first ${PREVIEW_ROWS.toLocaleString("en-IN")} — the Excel and CSV files have them all` : ""}
          </p>
          <div className="flex flex-wrap gap-2" id="report-downloads">
            <a href={dl("xlsx")} id="report-xlsx" className="rounded-xl bg-verdigris-400 px-3.5 py-2 text-xs font-semibold text-ink-900 hover:bg-patina">
              Excel
            </a>
            <a href={dl("csv")} id="report-csv" className="rounded-xl border border-verdigris-300/20 px-3.5 py-2 text-xs text-verdigris-100 hover:border-verdigris-300/45">
              CSV
            </a>
            <a href={dl("pdf")} id="report-pdf" target="_blank" rel="noreferrer" className="rounded-xl border border-verdigris-300/20 px-3.5 py-2 text-xs text-verdigris-100 hover:border-verdigris-300/45">
              PDF
            </a>
          </div>
        </div>
      </Card>
      {error ? <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p> : null}

      <Card className="overflow-hidden">
        {r.rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-verdigris-200/60" id="report-empty">
            No rows for these filters. Try a longer period or another warehouse.
          </p>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-sm" id="report-table">
              <thead className="sticky top-0 z-10 bg-ink-850">
                <tr className="border-b border-verdigris-300/10 text-left text-[0.7rem] uppercase tracking-[0.08em] text-verdigris-300">
                  {r.meta.columns.map((c) => (
                    <th key={c.key} className={`whitespace-nowrap px-3 py-2.5 font-medium ${NUM.has(c.type) ? "text-right" : ""}`}>
                      <button
                        type="button"
                        onClick={() => setSort((s) => (s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: NUM.has(c.type) ? -1 : 1 }))}
                        className="uppercase hover:text-patina"
                      >
                        {c.label}
                        {sort?.key === c.key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b border-verdigris-300/5 hover:bg-patina/5">
                    {r.meta.columns.map((c) => {
                      const v = row[c.key] ?? null;
                      return (
                        <td key={c.key} className={`whitespace-nowrap px-3 py-2 ${NUM.has(c.type) ? "text-right font-mono" : ""} ${c.type === "datetime" || c.type === "date" ? "font-mono text-xs text-verdigris-200/80" : "text-verdigris-100"}`}>
                          {c.key === "photo" && typeof v === "string" && v.startsWith("http") ? (
                            <a href={v} target="_blank" rel="noreferrer" className="text-verdigris-300 underline">
                              Photo
                            </a>
                          ) : (
                            show(v, c)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {hasTotals ? (
                <tfoot className="sticky bottom-0 bg-ink-850">
                  <tr className="border-t border-verdigris-300/20 font-semibold" id="report-totals">
                    {r.meta.columns.map((c, i) => (
                      <td key={c.key} className={`whitespace-nowrap px-3 py-2.5 ${NUM.has(c.type) ? "text-right font-mono" : ""} text-verdigris-50`}>
                        {c.key in r.totals ? show(r.totals[c.key]!, c) : i === 0 ? "Total" : ""}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        )}
      </Card>
      <p className="text-right text-[0.7rem] text-verdigris-200/40">Made {fmtDateTime(r.generatedAt)}</p>
    </div>
  );
}
