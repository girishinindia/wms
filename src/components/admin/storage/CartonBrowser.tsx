"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Card } from "@/components/admin/ui";
import { api } from "@/lib/api/client";
import { fmtDateTime } from "@/lib/format/datetime";
import type { CartonList, StoredCarton } from "@/lib/storage/cartons";

import { downloadCsv, remember, type CsvColumn } from "../csv";

/**
 * Stored cartons of a gala, a floor or a whole warehouse — the same screen
 * for all three, so it reads the same wherever you are.
 *
 * Each carton is two lines: the number big, and under it what it is —
 * item code and description, importer, pieces per carton with the unit,
 * kg — and the inward it came in. Search, filters and sort run on the
 * screen as you type; Download saves exactly the rows you see.
 *
 * Getting around: the breadcrumb's floor and gala lists, previous / next
 * (also the ← → keys), and links to the whole floor or warehouse.
 */

const n = (v: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v);
const PAGE = 100;
const SORT_KEY = "wms.cartonSort";
const GROUP_KEY = "wms.cartonGroup";

type Sort = "NEWEST" | "OLDEST" | "CARTON" | "ITEM" | "IMPORTER" | "GALA";
const SORTS: { id: Sort; label: string }[] = [
  { id: "NEWEST", label: "Newest stored first" },
  { id: "OLDEST", label: "Oldest stored first" },
  { id: "CARTON", label: "Carton number" },
  { id: "ITEM", label: "Item" },
  { id: "IMPORTER", label: "Importer" },
  { id: "GALA", label: "Gala" },
];

const item = (c: StoredCarton) => [c.itemCode, c.description].filter(Boolean).join(" · ");
const days = (at: string | null) => {
  if (!at) return null;
  const t = Date.parse(at.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
};

const select = "rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-2.5 py-2 text-sm text-verdigris-50";
const btn = "rounded-lg border border-verdigris-300/20 px-3 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45 disabled:opacity-40";

export default function CartonBrowser({ initial }: { initial: CartonList }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const p = data.place;
  const [q, setQ] = useState("");
  const [importer, setImporter] = useState("");
  const [itemKey, setItemKey] = useState("");
  const [inward, setInward] = useState("");
  const [gala, setGala] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<Sort>("NEWEST");
  const [group, setGroup] = useState(false);
  const [page, setPage] = useState(1);
  const [allItems, setAllItems] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => setData(initial), [initial]);
  useEffect(() => {
    const s = remember.get(SORT_KEY) as Sort | null;
    if (s && SORTS.some((x) => x.id === s)) setSort(s);
    setGroup(remember.get(GROUP_KEY) === "1");
  }, []);

  // A whole warehouse can hold more than one list: searching then asks the server.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!initial.truncated) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const url =
        p.kind === "FLOOR" ? `/storage/floors/${p.floor!.id}/cartons` : p.kind === "WAREHOUSE" ? `/storage/warehouses/${p.warehouse.id}/cartons` : null;
      if (!url) return;
      setBusy(true);
      const r = await api<CartonList>(`${url}${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`, { method: "GET" });
      setBusy(false);
      if (r.ok) setData(r.data);
    }, 350);
  }, [q, initial.truncated, p.kind, p.floor, p.warehouse.id]);

  const go = useCallback((href: string) => router.push(href), [router]);
  const galaHref = (id: number) => `/admin/locations/galas/${id}`;
  const floorHref = (id: number) => `/admin/locations/floors/${id}`;
  const whHref = `/admin/locations/cartons?warehouse=${p.warehouse.id}`;
  const prevHref = p.prev ? (p.kind === "GALA" ? galaHref(p.prev.id) : floorHref(p.prev.id)) : null;
  const nextHref = p.next ? (p.kind === "GALA" ? galaHref(p.next.id) : floorHref(p.next.id)) : null;

  // ← → walk the galas (or floors), unless you are typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest("input, select, textarea, [contenteditable=true]")) return;
      if (e.key === "ArrowLeft" && prevHref) go(prevHref);
      if (e.key === "ArrowRight" && nextHref) go(nextHref);
      if (e.key === "/") {
        e.preventDefault();
        box.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, prevHref, nextHref]);

  const cartons = data.cartons;
  const importers = useMemo(() => [...new Set(cartons.map((c) => c.importer))].sort(), [cartons]);
  const items = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cartons) m.set(`${c.itemCode ?? ""}|${c.description}`, item(c));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [cartons]);
  const inwards = useMemo(() => [...new Set(cartons.map((c) => c.inwardCode))].sort(), [cartons]);
  const galas = useMemo(() => [...new Set(cartons.map((c) => c.galaCode))].sort(), [cartons]);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const fromT = from ? Date.parse(`${from}T00:00:00+05:30`) : null;
    const toT = to ? Date.parse(`${to}T23:59:59+05:30`) : null;
    const rows = cartons.filter((c) => {
      if (importer && c.importer !== importer) return false;
      if (itemKey && `${c.itemCode ?? ""}|${c.description}` !== itemKey) return false;
      if (inward && c.inwardCode !== inward) return false;
      if (gala && c.galaCode !== gala) return false;
      if (fromT || toT) {
        const t = c.storedAt ? Date.parse(c.storedAt.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")) : NaN;
        if (Number.isNaN(t) || (fromT && t < fromT) || (toT && t > toT)) return false;
      }
      if (words.length) {
        const hay = [c.cartonNo, c.itemCode ?? "", c.description, c.importer, c.inwardCode, c.galaCode, c.by ?? ""].join(" ").toLowerCase();
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    const by: Record<Sort, (a: StoredCarton, b: StoredCarton) => number> = {
      NEWEST: (a, b) => (b.storedAt ?? "").localeCompare(a.storedAt ?? "") || a.cartonNo.localeCompare(b.cartonNo),
      OLDEST: (a, b) => (a.storedAt ?? "").localeCompare(b.storedAt ?? "") || a.cartonNo.localeCompare(b.cartonNo),
      CARTON: (a, b) => a.cartonNo.localeCompare(b.cartonNo),
      ITEM: (a, b) => item(a).localeCompare(item(b)) || a.cartonNo.localeCompare(b.cartonNo),
      IMPORTER: (a, b) => a.importer.localeCompare(b.importer) || item(a).localeCompare(item(b)) || a.cartonNo.localeCompare(b.cartonNo),
      GALA: (a, b) => a.galaCode.localeCompare(b.galaCode, undefined, { numeric: true }) || a.cartonNo.localeCompare(b.cartonNo),
    };
    return rows.sort(by[group ? "ITEM" : sort]);
  }, [cartons, q, importer, itemKey, inward, gala, from, to, sort, group]);

  useEffect(() => setPage(1), [q, importer, itemKey, inward, gala, from, to, sort, group]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const slice = shown.slice((page - 1) * PAGE, page * PAGE);
  const filtered = Boolean(q || importer || itemKey || inward || gala || from || to);
  const pieces = shown.reduce((s, c) => s + c.piecesPerCarton, 0);
  const kg = shown.reduce((s, c) => s + c.kgPerCarton, 0);
  const sameUnit = new Set(shown.map((c) => c.unitCode ?? "PCS")).size <= 1;

  const title = p.kind === "GALA" ? `${p.gala!.code} · ${p.gala!.name}` : p.kind === "FLOOR" ? `${p.floor!.name} — all cartons` : `${p.warehouse.name} — all stored cartons`;
  const csvCols: CsvColumn<StoredCarton>[] = [
    { label: "Carton", value: (c) => c.cartonNo },
    { label: "Item code", value: (c) => c.itemCode },
    { label: "Description", value: (c) => c.description },
    { label: "Importer", value: (c) => c.importer },
    { label: "Pieces per carton", value: (c) => c.piecesPerCarton },
    { label: "Unit", value: (c) => c.unitCode ?? "PCS" },
    { label: "Kg per carton", value: (c) => c.kgPerCarton },
    { label: "Inward", value: (c) => c.inwardCode },
    { label: "Warehouse", value: () => p.warehouse.name },
    { label: "Floor", value: (c) => c.floorName },
    { label: "Gala", value: (c) => c.galaCode },
    { label: "Stored at", value: (c) => (c.storedAt ? fmtDateTime(c.storedAt) : "") },
    { label: "Stored by", value: (c) => c.by },
    { label: "Days stored", value: (c) => days(c.storedAt) },
  ];
  const floorNow = p.floor ? p.floors.find((f) => f.id === p.floor!.id) : null;
  const clear = () => {
    setQ("");
    setImporter("");
    setItemKey("");
    setInward("");
    setGala("");
    setFrom("");
    setTo("");
  };

  const row = (c: StoredCarton) => {
    const d = days(c.storedAt);
    return (
      <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 py-2.5">
        <div className="min-w-0">
          <p className="font-mono text-[15px] font-semibold text-verdigris-50">{c.cartonNo}</p>
          <p className="text-[13px] text-verdigris-100">
            {c.itemCode ? <span className="font-mono text-verdigris-200/80">{c.itemCode} · </span> : null}
            {c.description}
            <span className="text-verdigris-200/55"> · </span>
            <span className="text-patina">{c.importer}</span>
            <span className="text-verdigris-200/55"> · </span>
            <b className="font-mono font-medium">
              {n(c.piecesPerCarton)} {c.unitCode ?? "PCS"}
            </b>{" "}
            / carton{c.kgPerCarton ? ` · ${n(c.kgPerCarton)} kg` : ""}
          </p>
          <p className="text-xs text-verdigris-200/55">
            Inward{" "}
            <Link href={`/admin/inward/${c.inwardId}`} className="font-mono text-verdigris-300 hover:text-patina">
              {c.inwardCode}
            </Link>
            {p.kind !== "GALA" ? (
              <>
                {" · "}
                <Link href={galaHref(c.galaId)} className="font-mono text-verdigris-300 hover:text-patina">
                  {c.galaCode}
                </Link>
                {p.kind === "WAREHOUSE" ? ` · ${c.floorName}` : ""}
              </>
            ) : null}
          </p>
        </div>
        <div className="text-right text-xs text-verdigris-200/60">
          <p>{c.storedAt ? fmtDateTime(c.storedAt) : ""}</p>
          <p>{c.by ?? ""}</p>
          {d !== null ? <p>stored {d === 0 ? "today" : `${d} day${d === 1 ? "" : "s"}`}</p> : null}
        </div>
      </li>
    );
  };

  const groups = useMemo(() => {
    if (!group) return [];
    const m = new Map<string, StoredCarton[]>();
    for (const c of slice) {
      const k = `${item(c)} — ${c.importer}`;
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.entries()];
  }, [group, slice]);

  return (
    <div className="space-y-5">
      {/* Where you are, and the way around */}
      <div className="flex flex-wrap items-center gap-2" id="carton-nav">
        <Link href={`/admin/locations?warehouse=${p.warehouse.id}`} className="text-sm text-verdigris-200/70 hover:text-patina">
          {p.warehouse.name}
        </Link>
        <span className="text-verdigris-200/40">›</span>
        <select
          id="carton-floor"
          aria-label="Floor"
          className={select}
          value={p.floor?.id ?? ""}
          onChange={(e) => go(e.target.value ? floorHref(Number(e.target.value)) : whHref)}
        >
          <option value="">All floors</option>
          {p.floors.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} · {n(f.cartons)} cartons
            </option>
          ))}
        </select>
        {p.floor ? (
          <>
            <span className="text-verdigris-200/40">›</span>
            <select
              id="carton-gala"
              aria-label="Gala"
              className={select}
              value={p.gala?.id ?? ""}
              onChange={(e) => go(e.target.value ? galaHref(Number(e.target.value)) : floorHref(p.floor!.id))}
            >
              <option value="">All galas on this floor</option>
              {(floorNow?.galas ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code} · {g.name} · {n(g.cartons)}
                  {g.isActive ? "" : " (off)"}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <span className="ml-auto flex gap-2">
          <button type="button" id="carton-prev" className={btn} disabled={!prevHref} onClick={() => prevHref && go(prevHref)} title="Previous (← key)">
            ← {p.prev?.code ?? ""}
          </button>
          <button type="button" id="carton-next" className={btn} disabled={!nextHref} onClick={() => nextHref && go(nextHref)} title="Next (→ key)">
            {p.next?.code ?? ""} →
          </button>
        </span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-verdigris-50" id="carton-title">
            {title}
          </h1>
          <p className="mt-1 text-sm text-verdigris-200/60">
            {p.kind === "GALA" ? `${p.warehouse.name} · ${p.floor!.name} · ` : ""}
            {n(data.total)} carton{data.total === 1 ? "" : "s"} · {n(data.items.length)} item{data.items.length === 1 ? "" : "s"}
            {p.gala && !p.gala.isActive ? " · switched off" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.kind === "GALA" ? (
            <Link href={floorHref(p.floor!.id)} className={btn} id="carton-whole-floor">
              Whole {p.floor!.name}
            </Link>
          ) : null}
          {p.kind !== "WAREHOUSE" ? (
            <Link href={whHref} className={btn} id="carton-whole-warehouse">
              All cartons in {p.warehouse.name}
            </Link>
          ) : null}
        </div>
      </div>

      {/* By item */}
      <Card className="p-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">By item</p>
        {data.items.length === 0 ? (
          <p className="text-sm text-verdigris-200/60">Nothing stored here yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" id="carton-items">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-verdigris-200/60">
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3">Importer</th>
                  <th className="py-2 pr-3 text-right">Cartons</th>
                  <th className="py-2 pr-3 text-right">Pieces</th>
                  <th className="py-2 text-right">Kg</th>
                </tr>
              </thead>
              <tbody>
                {(allItems ? data.items : data.items.slice(0, 8)).map((it, i) => (
                  <tr
                    key={i}
                    className="cursor-pointer border-t border-verdigris-300/10 hover:bg-ink-900/40"
                    onClick={() => {
                      setItemKey(`${it.itemCode ?? ""}|${it.description}`);
                      setImporter(it.importer);
                    }}
                    title="Show only these cartons"
                  >
                    <td className="py-2 pr-3 text-verdigris-50">
                      {it.itemCode ? <span className="font-mono text-verdigris-200/60">{it.itemCode} · </span> : null}
                      {it.description}
                    </td>
                    <td className="py-2 pr-3 text-verdigris-200/70">{it.importer}</td>
                    <td className="py-2 pr-3 text-right font-mono text-verdigris-50">{n(it.cartons)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-verdigris-50">
                      {n(it.pieces)} {it.unitCode ?? ""}
                    </td>
                    <td className="py-2 text-right font-mono text-verdigris-100">{it.kg ? n(it.kg) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.items.length > 8 ? (
              <button type="button" className="mt-2 text-xs text-verdigris-300 hover:text-patina" onClick={() => setAllItems((v) => !v)}>
                {allItems ? "Show fewer" : `Show all ${data.items.length} items`}
              </button>
            ) : null}
          </div>
        )}
      </Card>

      {/* Cartons */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={box}
            id="carton-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search carton, item, importer, inward…  ( / )"
            className="min-w-[16rem] flex-1 rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-3.5 py-2.5 text-sm text-verdigris-50 placeholder:text-verdigris-200/35"
          />
          <select id="carton-sort" aria-label="Sort" className={select} value={sort} disabled={group} onChange={(e) => {
            const v = e.target.value as Sort;
            setSort(v);
            remember.set(SORT_KEY, v);
          }}>
            {SORTS.filter((s) => s.id !== "GALA" || p.kind !== "GALA").map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-verdigris-100">
            <input
              type="checkbox"
              id="carton-group"
              checked={group}
              onChange={(e) => {
                setGroup(e.target.checked);
                remember.set(GROUP_KEY, e.target.checked ? "1" : "0");
              }}
            />
            Group by item
          </label>
          <button
            type="button"
            id="carton-download"
            className={btn}
            disabled={shown.length === 0}
            onClick={() => downloadCsv(`Cartons ${title.replace(/ — .*/, "")}`, csvCols, shown)}
          >
            Download Excel (CSV)
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select id="carton-importer" aria-label="Importer" className={select} value={importer} onChange={(e) => setImporter(e.target.value)}>
            <option value="">All importers</option>
            {importers.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
          <select id="carton-item" aria-label="Item" className={`${select} max-w-[18rem]`} value={itemKey} onChange={(e) => setItemKey(e.target.value)}>
            <option value="">All items</option>
            {items.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <select id="carton-inward" aria-label="Inward" className={select} value={inward} onChange={(e) => setInward(e.target.value)}>
            <option value="">All inwards</option>
            {inwards.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
          {p.kind !== "GALA" ? (
            <select id="carton-gala-filter" aria-label="Gala" className={select} value={gala} onChange={(e) => setGala(e.target.value)}>
              <option value="">All galas</option>
              {galas.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          ) : null}
          <label className="flex items-center gap-1 text-xs text-verdigris-200/70">
            Stored from
            <input type="date" id="carton-from" value={from} onChange={(e) => setFrom(e.target.value)} className={select} />
          </label>
          <label className="flex items-center gap-1 text-xs text-verdigris-200/70">
            to
            <input type="date" id="carton-to" value={to} onChange={(e) => setTo(e.target.value)} className={select} />
          </label>
          {filtered ? (
            <button type="button" id="carton-clear" className="text-xs text-verdigris-300 hover:text-patina" onClick={clear}>
              Clear
            </button>
          ) : null}
        </div>
        <p className="mt-3 text-sm text-verdigris-200/70" id="carton-count">
          {busy ? "Searching… " : ""}
          {n(shown.length)} carton{shown.length === 1 ? "" : "s"}
          {filtered ? ` of ${n(cartons.length)}` : ""}
          {sameUnit && shown.length ? ` · ${n(pieces)} ${shown[0]!.unitCode ?? "PCS"}` : ""}
          {kg ? ` · ${n(kg)} kg` : ""}
          {data.truncated ? ` · showing the newest ${n(cartons.length)} of ${n(data.total)} — search to narrow` : ""}
        </p>

        {shown.length === 0 ? (
          <p className="py-6 text-sm text-verdigris-200/60">{filtered ? "No carton matches." : "Nothing stored here yet."}</p>
        ) : group ? (
          <div id="carton-list">
            {groups.map(([k, list]) => (
              <div key={k} className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-verdigris-300">
                  {k} · {list.length}
                </p>
                <ul className="divide-y divide-verdigris-300/10">{list.map(row)}</ul>
              </div>
            ))}
          </div>
        ) : (
          <ul className="mt-1 divide-y divide-verdigris-300/10" id="carton-list">
            {slice.map(row)}
          </ul>
        )}

        {pages > 1 ? (
          <div className="mt-3 flex items-center justify-end gap-2 text-sm" id="carton-pages">
            <button type="button" className={btn} disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>
              ← Previous
            </button>
            <span className="text-verdigris-200/70">
              Page {page} of {pages}
            </span>
            <button type="button" className={btn} disabled={page >= pages} onClick={() => setPage((x) => x + 1)}>
              Next →
            </button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
