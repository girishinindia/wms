"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Card, Empty } from "@/components/admin/ui";
import { REPORT_GROUPS, type ReportMeta } from "@/lib/insights/report-types";

const FAV_KEY = "wms.reports.favourites";

function readFavs(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** The catalogue: search, a group filter, and starred reports first. */
export default function ReportCatalog({ reports }: { reports: ReportMeta[] }) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string>("All");
  const [favs, setFavs] = useState<string[]>([]);
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
    return reports.filter(
      (r) =>
        (group === "All" || (group === "Starred" ? favs.includes(r.key) : r.group === group)) &&
        (!t || `${r.no} ${r.title} ${r.description} ${r.group}`.toLowerCase().includes(t)),
    );
  }, [reports, q, group, favs]);

  if (!reports.length) return <Card><Empty title="No reports for your role." hint="Ask the super admin if you need one." /></Card>;

  const starred = shown.filter((r) => favs.includes(r.key));
  const sections = group === "Starred" ? [["Starred", starred] as const] : [
    ...(starred.length && group === "All" && !q ? [["Starred", starred] as const] : []),
    ...groups.map((g) => [g, shown.filter((r) => r.group === g)] as const),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="reports-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search reports — stock, LR, carton, expense…"
          className="w-full max-w-sm rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-3.5 py-2.5 text-sm text-verdigris-50 placeholder:text-verdigris-200/35"
        />
        <div className="flex flex-wrap gap-1.5" id="reports-groups">
          {["All", ...(favs.length ? ["Starred"] : []), ...groups].map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGroup(g)}
              aria-pressed={group === g}
              className={`rounded-full border px-3 py-1.5 text-xs ${group === g ? "border-patina bg-patina/15 text-verdigris-50" : "border-verdigris-300/15 text-verdigris-200/70 hover:border-verdigris-300/35"}`}
            >
              {g === "Starred" ? "★ Starred" : g}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? <Card><Empty title="No report matches." hint="Try another word." /></Card> : null}
      {sections.map(([g, list]) =>
        list.length ? (
          <section key={g} className="space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">{g}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((r) => (
                <Card key={`${g}-${r.key}`} className="relative p-4 transition-colors hover:border-verdigris-300/30">
                  <Link href={`/admin/reports/${r.key}`} className="block pr-8" id={`report-${r.key}`}>
                    <span className="font-mono text-[0.7rem] text-verdigris-300">{r.no}</span>
                    <span className="mt-0.5 block text-sm font-semibold text-verdigris-50">{r.title}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-verdigris-200/65">{r.description}</span>
                    <span className="mt-2 block text-[0.7rem] text-verdigris-200/45">{r.period ? "For a period" : "As of now"} · {r.columns.length} columns · Excel, CSV, PDF</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => toggle(r.key)}
                    aria-label={favs.includes(r.key) ? `Unstar ${r.title}` : `Star ${r.title}`}
                    aria-pressed={favs.includes(r.key)}
                    data-star={r.key}
                    className={`absolute right-3 top-3 text-lg leading-none ${favs.includes(r.key) ? "text-amber-300" : "text-verdigris-200/30 hover:text-verdigris-200/70"}`}
                  >
                    {favs.includes(r.key) ? "★" : "☆"}
                  </button>
                </Card>
              ))}
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
}
