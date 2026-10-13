"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Card } from "@/components/admin/ui";
import { api } from "@/lib/api/client";
import { fmtDateTime } from "@/lib/format/datetime";
import { PERIOD_LABELS, type DashboardData, type DashboardMeta, type List, type Tile } from "@/lib/insights/types";

import ChartView from "./ChartView";
import { fmt } from "./chart-kit";

const TONE: Record<string, string> = {
  default: "text-verdigris-50",
  good: "text-emerald-300",
  warn: "text-amber-200",
  danger: "text-rose-300",
};

type Query = { period: string; from: string; to: string; warehouseId: number | null; importerId: number | null };

const qs = (id: string, q: Query) => {
  const p = new URLSearchParams({ d: id, period: q.period });
  if (q.period === "custom") {
    p.set("from", q.from);
    p.set("to", q.to);
  }
  if (q.warehouseId) p.set("warehouseId", String(q.warehouseId));
  if (q.importerId) p.set("importerId", String(q.importerId));
  return p;
};

/** The dashboards a person may open, as tabs, with one filter bar for all of them. */
export default function Dashboard({ tabs, initial }: { tabs: DashboardMeta[]; initial: DashboardData }) {
  const router = useRouter();
  const path = usePathname();
  const [data, setData] = useState(initial);
  const [id, setId] = useState(initial.meta.id);
  const [q, setQ] = useState<Query>(initial.filters);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (nextId: string, nextQ: Query) => {
      const mine = ++seq.current;
      setLoading(true);
      const params = qs(nextId, nextQ);
      router.replace(`${path}?${params.toString()}`, { scroll: false });
      params.delete("d");
      const r = await api<{ dashboard: DashboardData }>(`/insights/dashboards/${nextId}?${params.toString()}`, { method: "GET" });
      if (mine !== seq.current) return;
      setLoading(false);
      if (!r.ok) return setError(r.error.message);
      setError(null);
      setData(r.data.dashboard);
    },
    [path, router],
  );

  // Numbers move during the day: refresh every two minutes while the page is open.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load(id, q);
    }, 120_000);
    return () => clearInterval(t);
  }, [id, q, load]);

  const pick = (next: string) => {
    setId(next as typeof id);
    void load(next, q);
  };
  const change = (patch: Partial<Query>) => {
    const next = { ...q, ...patch };
    setQ(next);
    void load(id, next);
  };

  const wide = data.charts.filter((c) => c.wide);
  const rest = data.charts.filter((c) => !c.wide);
  return (
    <div className="space-y-4" id="insights">
      {tabs.length > 1 ? (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" id="dash-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`dash-tab-${t.id}`}
              aria-selected={t.id === id}
              onClick={() => pick(t.id)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs ${
                t.id === id ? "border-patina bg-patina/15 text-verdigris-50" : "border-verdigris-300/15 text-verdigris-200/70 hover:border-verdigris-300/35"
              }`}
            >
              {t.title}
            </button>
          ))}
        </div>
      ) : null}

      <FilterBar data={data} q={q} onChange={change} loading={loading} />
      {error ? <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p> : null}

      <div className={`grid grid-cols-2 gap-3 lg:grid-cols-3 ${data.tiles.length > 6 ? "xl:grid-cols-4" : data.tiles.length > 4 ? "xl:grid-cols-6" : "xl:grid-cols-4"}`} id="dash-tiles">
        {data.tiles.map((t) => (
          <TileCard key={t.key} tile={t} />
        ))}
      </div>

      {wide.map((c) => (
        <ChartCard key={c.key} chart={c} />
      ))}
      <div className="grid gap-4 lg:grid-cols-2">
        {rest.map((c) => (
          <ChartCard key={c.key} chart={c} />
        ))}
      </div>
      {data.lists.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.lists.map((l) => (
            <ListCard key={l.key} list={l} />
          ))}
        </div>
      ) : null}
      <p className="text-right text-[0.7rem] text-verdigris-200/40">
        Counted {fmtDateTime(data.generatedAt)} · {data.filters.from} to {data.filters.to}
      </p>
    </div>
  );
}

function FilterBar({ data, q, onChange, loading }: { data: DashboardData; q: Query; onChange: (p: Partial<Query>) => void; loading: boolean }) {
  const sel = "rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-xs text-verdigris-100";
  return (
    <div className="flex flex-wrap items-center gap-2" id="dash-filters">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Period">
        {Object.entries(PERIOD_LABELS).map(([k, label]) => (
          <button
            key={k}
            type="button"
            id={`dash-period-${k}`}
            aria-pressed={q.period === k}
            onClick={() => onChange({ period: k })}
            className={`rounded-lg border px-2.5 py-1.5 text-xs ${q.period === k ? "border-patina bg-patina/15 text-verdigris-50" : "border-verdigris-300/15 text-verdigris-200/70 hover:border-verdigris-300/35"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {q.period === "custom" ? (
        <span className="flex items-center gap-1 text-xs text-verdigris-200/60">
          <input type="date" id="dash-from" value={q.from} max={q.to} onChange={(e) => e.target.value && onChange({ from: e.target.value })} className={sel} />
          to
          <input type="date" id="dash-to" value={q.to} min={q.from} onChange={(e) => e.target.value && onChange({ to: e.target.value })} className={sel} />
        </span>
      ) : null}
      {data.options.warehouses.length > 1 ? (
        <select id="dash-warehouse" value={q.warehouseId ?? ""} onChange={(e) => onChange({ warehouseId: e.target.value ? Number(e.target.value) : null })} className={sel}>
          <option value="">All warehouses</option>
          {data.options.warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label}
            </option>
          ))}
        </select>
      ) : null}
      {data.options.importers.length > 1 ? (
        <select id="dash-importer" value={q.importerId ?? ""} onChange={(e) => onChange({ importerId: e.target.value ? Number(e.target.value) : null })} className={`${sel} max-w-[14rem]`}>
          <option value="">All importers</option>
          {data.options.importers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label}
            </option>
          ))}
        </select>
      ) : null}
      {loading ? <span className="text-xs text-verdigris-200/50">Updating…</span> : null}
      <Link href="/admin/reports" className="ml-auto text-xs text-verdigris-300 hover:text-patina" id="dash-reports">
        All reports →
      </Link>
    </div>
  );
}

function TileCard({ tile }: { tile: Tile }) {
  const body = (
    <Card className="h-full p-4 transition-colors hover:border-verdigris-300/30">
      <p className="text-[0.72rem] uppercase tracking-[0.08em] text-verdigris-300">{tile.label}</p>
      <p className={`mt-1.5 font-mono text-xl font-semibold sm:text-2xl ${TONE[tile.tone ?? "default"]}`} data-tile-value={tile.key}>
        {fmt(tile.value, tile.format)}
      </p>
      {tile.note ? <p className="mt-1 text-xs text-verdigris-200/60">{tile.note}</p> : null}
    </Card>
  );
  return tile.href ? (
    <Link href={tile.href} id={`tile-${tile.key}`} className="block">
      {body}
    </Link>
  ) : (
    <div id={`tile-${tile.key}`}>{body}</div>
  );
}

function ChartCard({ chart }: { chart: DashboardData["charts"][number] }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-verdigris-50">{chart.title}</h3>
        {chart.href ? (
          <Link href={chart.href} className="shrink-0 text-xs text-verdigris-300 hover:text-patina">
            Details →
          </Link>
        ) : null}
      </div>
      <ChartView chart={chart} />
      {chart.note ? <p className="mt-2 text-xs text-verdigris-200/55">{chart.note}</p> : null}
    </Card>
  );
}

function ListCard({ list }: { list: List }) {
  const dot: Record<string, string> = { warn: "bg-amber-400", danger: "bg-rose-400", good: "bg-emerald-400", default: "bg-verdigris-400/60" };
  return (
    <Card className="overflow-hidden" >
      <div className="flex items-center justify-between border-b border-verdigris-300/10 px-5 py-3.5" id={`list-${list.key}`}>
        <h3 className="text-sm font-semibold text-verdigris-50">{list.title}</h3>
        {list.href ? (
          <Link href={list.href} className="text-xs text-verdigris-300 hover:text-patina">
            All →
          </Link>
        ) : null}
      </div>
      {list.rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-verdigris-200/55">{list.empty}</p>
      ) : (
        <ul className="divide-y divide-verdigris-300/[0.06]">
          {list.rows.map((r, i) => {
            const inner = (
              <span className="flex items-start gap-3 px-5 py-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot[r.tone ?? "default"]}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-verdigris-50">{r.title}</span>
                  {r.subtitle ? <span className="block truncate text-xs text-verdigris-200/60">{r.subtitle}</span> : null}
                </span>
                {r.badge ? <span className="shrink-0 rounded-full border border-verdigris-300/15 px-2 py-0.5 text-[0.7rem] text-verdigris-200/80">{r.badge}</span> : null}
              </span>
            );
            return <li key={i}>{r.href ? <Link href={r.href} className="block hover:bg-verdigris-100/[0.03]">{inner}</Link> : inner}</li>;
          })}
        </ul>
      )}
    </Card>
  );
}
