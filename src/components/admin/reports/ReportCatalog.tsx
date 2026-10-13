"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { faStar as faStarRegular } from "@fortawesome/free-regular-svg-icons";
import {
  faArrowDownWideShort,
  faArrowRight,
  faCalendarDays,
  faClock,
  faFileCsv,
  faFileExcel,
  faFilePdf,
  faLayerGroup,
  faMagnifyingGlass,
  faStar,
  faTableColumns,
} from "@fortawesome/free-solid-svg-icons";

import { Card, Empty } from "@/components/admin/ui";
import { REPORT_GROUPS, type ReportMeta } from "@/lib/insights/report-types";
import { Fa } from "@/lib/ui/fa";

import { GROUP_LOOK, reportLook } from "./report-look";

type Sort = "no" | "name" | "starred";

const FAV_KEY = "wms.reports.favourites";

function readFavs(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** The catalogue: search, a group filter, a sort, starred reports first — as cards, four to a row on a wide screen. */
export default function ReportCatalog({ reports }: { reports: ReportMeta[] }) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string>("All");
  const [favs, setFavs] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>("no");
  useEffect(() => setFavs(readFavs()), []);

  const toggle = (key: string) => {
    const next = favs.includes(key) ? favs.filter((k) => k !== key) : [...favs, key];
    setFavs(next);
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(next));
    } catch {
      /* a private window: favourites last for this visit only */
    }
  };

  const groups = REPORT_GROUPS.filter((g) => reports.some((r) => r.group === g));
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const num = (r: ReportMeta) => Number(r.no.replace(/\D/g, "")) || 0;
    const list = reports.filter(
      (r) =>
        (group === "All" || (group === "Starred" ? favs.includes(r.key) : r.group === group)) &&
        (!t || `${r.no} ${r.title} ${r.description} ${r.group}`.toLowerCase().includes(t)),
    );
    return [...list].sort((a, b) => {
      if (sort === "name") return a.title.localeCompare(b.title, "en-IN");
      if (sort === "starred") {
        const s = Number(favs.includes(b.key)) - Number(favs.includes(a.key));
        if (s) return s;
      }
      return num(a) - num(b);
    });
  }, [reports, q, group, favs, sort]);

  if (!reports.length) return <Card><Empty title="No reports for your role." hint="Ask the super admin if you need one." /></Card>;

  const starred = shown.filter((r) => favs.includes(r.key));
  const count = (g: string) => (g === "All" ? reports.length : g === "Starred" ? favs.length : reports.filter((r) => r.group === g).length);
  // A–Z reads as one list; the other orders keep the groups.
  const sections: (readonly [string, ReportMeta[]])[] =
    group === "Starred"
      ? [["Starred", starred]]
      : sort === "name" && group === "All"
        ? [["All reports, A to Z", shown]]
        : [
            ...(starred.length && group === "All" && !q && sort === "no" ? [["Starred", starred] as const] : []),
            ...groups.map((g) => [g, shown.filter((r) => r.group === g)] as const),
          ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Fa icon={faMagnifyingGlass} className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-verdigris-200/45" />
          <input
            id="reports-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search reports — stock, LR, carton, expense…"
            className="w-full rounded-xl border border-verdigris-300/15 bg-ink-900/60 py-2.5 pl-9 pr-3.5 text-sm text-verdigris-50 placeholder:text-verdigris-200/35"
          />
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs text-verdigris-200/65">
          <Fa icon={faArrowDownWideShort} className="h-3.5 w-3.5" />
          Sort
          <select
            id="reports-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-xs text-verdigris-100"
          >
            <option value="no">Report number</option>
            <option value="name">Name, A to Z</option>
            <option value="starred">Starred first</option>
          </select>
        </label>
        <div className="flex w-full flex-wrap gap-1.5" id="reports-groups">
          {["All", ...(favs.length ? ["Starred"] : []), ...groups].map((g) => {
            const look = GROUP_LOOK[g];
            const on = group === g;
            return (
              <button
                key={g}
                type="button"
                onClick={() => setGroup(g)}
                aria-pressed={on}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${on ? "border-patina bg-patina/15 text-verdigris-50" : "border-verdigris-300/15 text-verdigris-200/75 hover:border-verdigris-300/35"}`}
              >
                {g === "Starred" ? (
                  <Fa icon={faStar} className="h-3 w-3 text-amber-400" />
                ) : look ? (
                  <Fa icon={look.icon} className="h-3 w-3" />
                ) : (
                  <Fa icon={faLayerGroup} className="h-3 w-3" />
                )}
                {g}
                <span className="rounded-full bg-verdigris-300/10 px-1.5 text-[0.65rem] text-verdigris-200/70">{count(g)}</span>
              </button>
            );
          })}
        </div>
      </div>
      {shown.length === 0 ? <Card><Empty title="No report matches." hint="Try another word." /></Card> : null}
      {sections.map(([g, list]) => {
        if (!list.length) return null;
        const look = GROUP_LOOK[g];
        return (
          <section key={g} className="space-y-3">
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">
              <span
                className="grid h-6 w-6 place-items-center rounded-lg"
                style={{ background: `${look?.color ?? "#e0a030"}22`, color: look?.color ?? "#e0a030" }}
              >
                <Fa icon={g === "Starred" ? faStar : (look?.icon ?? faLayerGroup)} className="h-3 w-3" />
              </span>
              {g}
              <span className="font-normal normal-case tracking-normal text-verdigris-200/50">
                · {list.length} report{list.length === 1 ? "" : "s"}
              </span>
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map((r) => (
                <ReportCard key={`${g}-${r.key}`} r={r} starred={favs.includes(r.key)} onStar={() => toggle(r.key)} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** One report: its icon in the group's colour, what it shows, and how. */
function ReportCard({ r, starred, onStar }: { r: ReportMeta; starred: boolean; onStar: () => void }) {
  const { color, icon } = reportLook(r.key, r.group);
  return (
    <div className="group card-shadow hover:card-shadow-lg relative flex flex-col overflow-hidden rounded-2xl border border-verdigris-300/12 bg-ink-850 transition-[translate,border-color,box-shadow] hover:-translate-y-0.5 hover:border-verdigris-300/30">
      <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />
      <Link href={`/admin/reports/${r.key}`} className="flex flex-1 flex-col p-4 pt-5" id={`report-${r.key}`}>
        <span className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background: `${color}22`, color }}>
            <Fa icon={icon} className="h-5 w-5" />
          </span>
          <span className="min-w-0 pr-6">
            <span className="font-mono text-[0.68rem] text-verdigris-200/55">{r.no} · {r.group}</span>
            <span className="mt-0.5 block text-[0.95rem] font-semibold leading-snug text-verdigris-50">{r.title}</span>
          </span>
        </span>
        <span className="mt-3 line-clamp-3 flex-1 text-xs leading-relaxed text-verdigris-200/70">{r.description}</span>
        <span className="mt-4 flex items-center gap-2 border-t border-verdigris-300/10 pt-3 text-[0.7rem] text-verdigris-200/60">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
            style={{ background: `${color}1a`, color }}
          >
            <Fa icon={r.period ? faCalendarDays : faClock} className="h-2.5 w-2.5" />
            {r.period ? "For a period" : "As of now"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Fa icon={faTableColumns} className="h-2.5 w-2.5" />
            {r.columns.length}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-verdigris-200/45" title="Excel, CSV and PDF">
            <Fa icon={faFileExcel} className="h-3 w-3" />
            <Fa icon={faFileCsv} className="h-3 w-3" />
            <Fa icon={faFilePdf} className="h-3 w-3" />
          </span>
          <Fa icon={faArrowRight} className="h-3 w-3 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
        </span>
      </Link>
      <button
        type="button"
        onClick={onStar}
        aria-label={starred ? `Unstar ${r.title}` : `Star ${r.title}`}
        aria-pressed={starred}
        data-star={r.key}
        className={`absolute right-3 top-4 text-base leading-none transition-colors ${starred ? "text-amber-400" : "text-verdigris-200/30 hover:text-amber-400/80"}`}
      >
        <Fa icon={starred ? faStar : faStarRegular} className="h-4 w-4" />
      </button>
    </div>
  );
}
