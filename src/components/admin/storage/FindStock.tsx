"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { SortTh, useSort } from "@/components/admin/SortTh";

import { api } from "@/lib/api/client";
import type { FindAnswer } from "@/lib/storage/cartons";

const n = (v: number) => new Intl.NumberFormat("en-IN").format(v);

/**
 * "Where is it?" for a warehouse: type (or scan) a gala code, a carton
 * number, an item or an importer. A gala or a stored carton opens straight
 * away on Enter; an item lists every gala holding it, with how many.
 */
export default function FindStock({ warehouseId }: { warehouseId: number }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [a, setA] = useState<FindAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const { rows: places, sort, toggle } = useSort(a?.places ?? [], {
    item: (p) => `${p.itemCode ?? ""} ${p.description}`.trim(),
    gala: (p) => p.galaCode,
    cartons: (p) => p.cartons,
  });
  const seq = useRef(0);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setA(null);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      const r = await api<FindAnswer>(`/storage/warehouses/${warehouseId}/find?q=${encodeURIComponent(text)}`, { method: "GET" });
      if (mine !== seq.current) return;
      setBusy(false);
      if (r.ok) setA(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [q, warehouseId]);

  const jump = () => {
    if (!a) return;
    if (a.galas.length === 1) router.push(`/admin/locations/galas/${a.galas[0]!.id}`);
    else if (a.carton?.galaId) router.push(`/admin/locations/galas/${a.carton.galaId}`);
    else if (a.carton?.dnId) router.push(`/admin/dispatch/${a.carton.dnId}`);
  };

  return (
    <div>
      <input
        id="loc-find"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            jump();
          }
        }}
        placeholder="Find: gala (F1-G03), carton number, item or importer…"
        className="w-full rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-3.5 py-2.5 text-sm text-verdigris-50 placeholder:text-verdigris-200/35"
      />
      {q.trim().length >= 2 ? (
        <div className="mt-2 rounded-xl border border-verdigris-300/10 bg-ink-900/40 p-3 text-sm" id="loc-find-result">
          {busy && !a ? <p className="text-verdigris-200/60">Looking…</p> : null}
          {a && a.galas.length === 0 && !a.carton && a.places.length === 0 ? <p className="text-verdigris-200/60">Nothing found in this warehouse.</p> : null}
          {a?.galas.length ? (
            <ul className="flex flex-wrap gap-2">
              {a.galas.map((g) => (
                <li key={g.id}>
                  <Link href={`/admin/locations/galas/${g.id}`} className="inline-block rounded-lg border border-verdigris-300/20 px-2.5 py-1 hover:border-patina">
                    <b className="font-mono text-verdigris-50">{g.code}</b> <span className="text-verdigris-200/70">{g.name} · {g.floor} · {n(g.cartons)} cartons</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {a?.carton ? (
            <p>
              <b className="font-mono text-verdigris-50">{a.carton.cartonNo}</b> — <span className="text-verdigris-100">{a.carton.where}</span>{" "}
              {a.carton.galaId ? (
                <Link href={`/admin/locations/galas/${a.carton.galaId}`} className="text-patina hover:underline">
                  Open {a.carton.galaCode}
                </Link>
              ) : a.carton.dnId ? (
                <Link href={`/admin/dispatch/${a.carton.dnId}`} className="text-patina hover:underline">
                  Open {a.carton.dnNo}
                </Link>
              ) : null}
            </p>
          ) : null}
          {a?.places.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-[0.08em] text-verdigris-300">
                <tr>
                  <SortTh label="Item" k="item" sort={sort} onSort={toggle} className="pb-1.5 pr-3" />
                  <SortTh label="Gala" k="gala" sort={sort} onSort={toggle} className="pb-1.5 pr-3" />
                  <SortTh label="Cartons" k="cartons" sort={sort} onSort={toggle} numeric right className="pb-1.5" />
                </tr>
              </thead>
              <tbody>
                {places.map((p, i) => (
                  <tr key={i} className="border-t border-verdigris-300/10 first:border-t-0">
                    <td className="py-1.5 pr-3 text-verdigris-50">
                      {p.itemCode ? <span className="font-mono text-verdigris-200/70">{p.itemCode} · </span> : null}
                      {p.description} <span className="text-verdigris-200/55">· {p.importer}</span>
                    </td>
                    <td className="py-1.5 pr-3">
                      <Link href={`/admin/locations/galas/${p.galaId}`} className="font-mono text-patina hover:underline">
                        {p.galaCode}
                      </Link>{" "}
                      <span className="text-xs text-verdigris-200/55">{p.floor}</span>
                    </td>
                    <td className="py-1.5 text-right font-mono text-verdigris-100">
                      {n(p.cartons)} ctn · {n(p.pieces)} {p.unitCode ?? "PCS"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
