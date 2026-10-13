"use client";

import { Chart as ChartJS, registerables, type ChartConfiguration } from "chart.js";
import { interpolateRgb, scaleLinear, scaleSequential } from "d3";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

import type { Chart, HeatCell } from "@/lib/insights/types";

import { fmt, ORDER, PALETTE, useChartTheme, type Theme } from "./chart-kit";

ChartJS.register(...registerables);

const colorOf = (i: number, c?: string) => PALETTE[(c as keyof typeof PALETTE) ?? ORDER[i % ORDER.length]!] ?? PALETTE[ORDER[i % ORDER.length]!];
const empty = (c: Chart) => (c.kind === "heatmap" ? !(c.cells ?? []).length : !c.series.some((s) => s.data.some((v) => v)));

/** One chart from the server's description: Chart.js for the usual kinds, D3 for the funnel and the heat map. */
export default function ChartView({ chart, height = 220 }: { chart: Chart; height?: number }) {
  const theme = useChartTheme();
  if (empty(chart)) {
    return (
      <div className="flex items-center justify-center text-xs text-verdigris-200/50" style={{ height }} data-chart-empty={chart.key}>
        Nothing in this period.
      </div>
    );
  }
  if (chart.kind === "funnel") return <Funnel chart={chart} theme={theme} />;
  if (chart.kind === "heatmap") return <Heat cells={chart.cells ?? []} theme={theme} />;
  return <CanvasChart chart={chart} theme={theme} height={height} />;
}

function CanvasChart({ chart, theme, height }: { chart: Chart; theme: Theme; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const router = useRouter();
  const config = useMemo(() => build(chart, theme), [chart, theme]);
  useEffect(() => {
    if (!ref.current) return;
    const c = new ChartJS(ref.current, {
      ...config,
      options: {
        ...config.options,
        onClick: chart.href ? () => router.push(chart.href!) : undefined,
        onHover: chart.href ? (e, els) => ((e.native?.target as HTMLElement).style.cursor = els.length ? "pointer" : "default") : undefined,
      },
    });
    return () => c.destroy();
  }, [config, chart.href, router]);
  const tall = chart.kind === "hbar" ? Math.max(height, chart.labels.length * 26 + 40) : height;
  return (
    <div style={{ position: "relative", height: tall }} data-chart={chart.key}>
      <canvas ref={ref} role="img" aria-label={`${chart.title}: ${chart.labels.slice(0, 12).map((l, i) => `${l} ${chart.series.map((s) => fmt(s.data[i] ?? 0, chart.format)).join(" / ")}`).join(", ")}`} />
    </div>
  );
}

function build(c: Chart, t: Theme): ChartConfiguration {
  const tick = { color: t.muted, font: { size: 11 } };
  const many = c.series.length > 1;
  const tooltip = {
    callbacks: {
      label: (ctx: { dataset: { label?: string }; parsed: { x?: number; y?: number } | number; raw: unknown }) =>
        `${ctx.dataset.label ? `${ctx.dataset.label}: ` : ""}${fmt(Number(ctx.raw), c.format)}`,
    },
  };
  const legend = { display: many || c.kind === "donut", position: "bottom" as const, labels: { color: t.text, boxWidth: 10, boxHeight: 10, font: { size: 11 } } };
  const axisY = { grid: { color: t.grid }, ticks: { ...tick, callback: (v: string | number) => fmt(Number(v), c.format, true) }, beginAtZero: true, border: { display: false } };
  const axisX = { grid: { display: false }, ticks: { ...tick, maxRotation: 0, autoSkip: true, autoSkipPadding: 12 }, border: { color: t.grid } };

  if (c.kind === "donut") {
    return {
      type: "doughnut",
      data: { labels: c.labels, datasets: [{ data: c.series[0]?.data ?? [], backgroundColor: c.labels.map((_, i) => colorOf(i)), borderColor: t.surface, borderWidth: 2 }] },
      options: { maintainAspectRatio: false, cutout: "62%", plugins: { legend: { ...legend, position: "right" }, tooltip } },
    } as ChartConfiguration;
  }
  if (c.kind === "line") {
    return {
      type: "line",
      data: {
        labels: c.labels,
        datasets: c.series.map((s, i) => ({
          label: s.name,
          data: s.data,
          borderColor: colorOf(i, s.color),
          backgroundColor: `${colorOf(i, s.color)}22`,
          fill: c.series.length === 1,
          tension: 0.3,
          pointRadius: c.labels.length > 40 ? 0 : 2.5,
          borderWidth: 2,
          borderDash: i === 1 ? [6, 4] : undefined,
        })),
      },
      options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend, tooltip }, scales: { x: axisX, y: axisY } },
    } as ChartConfiguration;
  }
  if (c.kind === "combo") {
    return {
      type: "bar",
      data: {
        labels: c.labels,
        datasets: c.series.map((s, i) => ({
          type: s.kind === "line" ? "line" : "bar",
          label: s.name,
          data: s.data,
          yAxisID: s.right ? "y1" : "y",
          borderColor: colorOf(i, s.color),
          backgroundColor: s.kind === "line" ? colorOf(i, s.color) : `${colorOf(i, s.color)}cc`,
          borderRadius: 4,
          tension: 0.3,
          pointRadius: 2,
          borderWidth: s.kind === "line" ? 2 : 0,
          order: s.kind === "line" ? 0 : 1,
        })),
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend, tooltip },
        scales: { x: axisX, y: { ...axisY, position: "left" }, y1: { ...axisY, position: "right", grid: { display: false } } },
      },
    } as ChartConfiguration;
  }
  const horizontal = c.kind === "hbar";
  const stacked = c.kind === "stacked";
  return {
    type: "bar",
    data: {
      labels: c.labels.map((l) => (horizontal && l.length > 24 ? `${l.slice(0, 23)}…` : l)),
      datasets: c.series.map((s, i) => ({ label: s.name, data: s.data, backgroundColor: `${colorOf(i, s.color)}d9`, hoverBackgroundColor: colorOf(i, s.color), borderRadius: 4, maxBarThickness: 38 })),
    },
    options: {
      indexAxis: horizontal ? "y" : "x",
      maintainAspectRatio: false,
      layout: { padding: { left: 6, right: 6 } },
      plugins: { legend: { ...legend, display: many }, tooltip },
      scales: horizontal
        ? { x: { ...axisY, stacked }, y: { ...axisX, stacked, ticks: { ...tick, autoSkip: false } } }
        : { x: { ...axisX, stacked }, y: { ...axisY, stacked } },
    },
  } as ChartConfiguration;
}

/** Each step a centred bar, width = its share of the biggest step (d3 scale). */
function Funnel({ chart, theme }: { chart: Chart; theme: Theme }) {
  const router = useRouter();
  const data = chart.series[0]?.data ?? [];
  const max = Math.max(1, ...data);
  const x = scaleLinear().domain([0, max]).range([6, 100]);
  const color = scaleSequential(interpolateRgb(theme.light ? "#b9b0f7" : "#5b4fc4", theme.light ? "#4b3fbf" : "#b3aaff")).domain([0, Math.max(1, data.length - 1)]);
  return (
    <div className="space-y-1.5 py-1" data-chart={chart.key} role="img" aria-label={chart.labels.map((l, i) => `${l} ${data[i]}`).join(", ")}>
      {chart.labels.map((label, i) => (
        <button
          key={label}
          type="button"
          onClick={chart.href ? () => router.push(chart.href!) : undefined}
          className="grid w-full grid-cols-[7.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-left text-xs"
        >
          <span className="truncate text-verdigris-200/75">{label}</span>
          <span className="flex justify-center">
            <span className="block h-6 rounded-md transition-all" style={{ width: `${x(data[i] ?? 0)}%`, background: color(i) }} />
          </span>
          <span className="text-right font-mono text-verdigris-50">{fmt(data[i] ?? 0, chart.format)}</span>
        </button>
      ))}
    </div>
  );
}

/** Galas grouped by warehouse and floor; colour = how full (d3 sequential scale). */
function Heat({ cells, theme }: { cells: HeatCell[]; theme: Theme }) {
  const router = useRouter();
  const groups = useMemo(() => {
    const m = new Map<string, HeatCell[]>();
    for (const c of cells) m.set(c.group, [...(m.get(c.group) ?? []), c]);
    return [...m.entries()];
  }, [cells]);
  const color = scaleSequential(interpolateRgb(theme.light ? "#e3f3ee" : "#12302b", theme.light ? "#0f6e5c" : "#6fd9c0")).domain([0, 1]);
  return (
    <div className="space-y-3" data-chart="heat">
      {groups.map(([g, list]) => (
        <div key={g}>
          <p className="mb-1.5 text-[0.72rem] text-verdigris-200/60">{g}</p>
          <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(2.6rem, 1fr))" }}>
            {list.map((c) => {
              const share = c.max ? c.value / c.max : 0;
              return (
                <button
                  key={c.label}
                  type="button"
                  title={`${c.label} · ${c.value} carton${c.value === 1 ? "" : "s"}${c.note ? ` · ${c.note}` : ""}`}
                  onClick={c.href ? () => router.push(c.href!) : undefined}
                  className={`h-9 rounded-md text-[0.62rem] font-mono leading-tight ${c.note ? "outline outline-1 outline-dashed outline-amber-400/70" : ""}`}
                  style={{ background: c.value ? color(0.15 + share * 0.85) : "transparent", border: c.value ? "none" : `1px solid ${theme.grid}`, color: share > 0.55 ? (theme.light ? "#ffffff" : "#081615") : theme.muted }}
                  data-gala={c.label}
                >
                  {c.label.replace(/^F\d+-/, "")}
                  <span className="block opacity-80">{c.value || ""}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
