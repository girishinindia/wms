"use client";

import { useMemo, useState } from "react";

import type { StockRow } from "@/lib/delivery/ops";

const n = (v: number) => v.toLocaleString("en-IN");
export const lineKey = (warehouseId: number, key: string) => `${warehouseId}|${key}`;

export type Chosen = Record<string, { cartons: number; orderPieces: number }>;

/** Cartons needed for the pieces ordered: whole cartons, rounded up. */
export const cartonsFor = (pieces: number, perCarton: number) => (perCarton > 0 ? Math.ceil(pieces / perCarton) : pieces);

/**
 * The importer's stock, by warehouse: what is free, and how many pieces
 * this note takes. The agent types the pieces the customer ordered; the
 * cartons are worked out (rounded up) and can be changed. Nothing more
 * than is free can be asked for. `chosen` is what the note has now;
 * `extra` is cartons this note already holds that the free count leaves
 * out (an edited note's own cartons).
 */
export default function StockPicker({
  stock,
  chosen,
  extra = {},
  onSet,
  disabled,
}: {
  stock: StockRow[];
  chosen: Chosen;
  extra?: Record<string, number>;
  onSet: (row: StockRow, cartons: number, orderPieces: number | null) => Promise<{ ok: boolean; message?: string }>;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const shown = stock.filter((r) => {
      const hay = `${r.itemCode ?? ""} ${r.description} ${r.warehouseName}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const by = new Map<number, { name: string; rows: StockRow[] }>();
    for (const r of shown) {
      if (!by.has(r.warehouseId)) by.set(r.warehouseId, { name: r.warehouseName, rows: [] });
      by.get(r.warehouseId)!.rows.push(r);
    }
    return [...by.entries()];
  }, [stock, q]);

  return (
    <div className="space-y-4">
      <input
        id="dn-stock-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search items by code or name"
        className="w-full rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-3.5 py-2.5 text-sm text-verdigris-50 placeholder:text-verdigris-200/35"
      />
      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-verdigris-300/20 p-5 text-center text-sm text-verdigris-200/55">
          {stock.length === 0 ? "No goods received in any warehouse yet." : "No item matches."}
        </p>
      ) : null}
      {groups.map(([wid, g]) => (
        <div key={wid} className="overflow-hidden rounded-xl border border-verdigris-300/10">
          <p className="bg-ink-900/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-verdigris-300">{g.name}</p>
          <ul className="divide-y divide-verdigris-300/5">
            {g.rows.map((r) => {
              const k = lineKey(r.warehouseId, r.key);
              return <StockLine key={k} row={r} have={chosen[k]} can={r.available + (extra[k] ?? 0)} onSet={onSet} disabled={disabled} />;
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function StockLine({
  row: r,
  have,
  can,
  onSet,
  disabled,
}: {
  row: StockRow;
  have?: { cartons: number; orderPieces: number };
  can: number;
  onSet: (row: StockRow, cartons: number, orderPieces: number | null) => Promise<{ ok: boolean; message?: string }>;
  disabled?: boolean;
}) {
  const ppc = r.piecesPerCarton;
  const [pcs, setPcs] = useState("");
  const [ctn, setCtn] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const pieces = pcs === "" ? null : Number(pcs);
  const suggested = pieces ? cartonsFor(pieces, ppc) : null;
  const cartons = ctn === "" ? suggested : Number(ctn);
  const maxPieces = can * ppc;
  let problem = "";
  if (pieces !== null && pieces < 1) problem = "Enter the pieces ordered";
  else if (pieces !== null && pieces > maxPieces) problem = `Only ${n(can)} carton${can === 1 ? "" : "s"} (${n(maxPieces)} pcs) free`;
  else if (cartons !== null && cartons > can) problem = `Only ${n(can)} carton${can === 1 ? "" : "s"} free`;
  else if (cartons !== null && cartons < 1) problem = "At least 1 carton";
  const sent = cartons !== null ? cartons * ppc : null;
  const diff = sent !== null && pieces !== null ? sent - pieces : 0;

  const apply = async (c: number, p: number | null) => {
    setBusy(true);
    const res = await onSet(r, c, p);
    setBusy(false);
    setMsg(res.ok ? "" : (res.message ?? "Could not hold these cartons"));
    if (res.ok) {
      setPcs("");
      setCtn("");
    }
  };
  const ready = pieces !== null && cartons !== null && !problem;

  return (
    <li className={`px-4 py-3 ${have ? "bg-patina/5" : ""}`} data-stock={r.description}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[12rem] flex-1">
          <p className="line-clamp-2 break-words text-sm font-medium text-verdigris-50">
            {r.itemCode ? <span className="font-mono text-verdigris-200/70">{r.itemCode} · </span> : null}
            {r.description}
          </p>
          <p className="text-xs text-verdigris-200/55">
            {n(ppc)} {r.unitCode ?? "pcs"} / carton ·{" "}
            <span className={can > 0 ? "text-emerald-300" : "text-rose-300"} data-free>
              {n(can)} carton{can === 1 ? "" : "s"} ({n(maxPieces)} pcs) free
            </span>
          </p>
          {have ? (
            <p className="mt-0.5 text-xs font-medium text-patina" data-have>
              In this note: {n(have.orderPieces)} pcs ordered → {n(have.cartons)} ctn = {n(have.cartons * ppc)} pcs
            </p>
          ) : null}
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-verdigris-200/60">
            Pieces ordered
            <input
              aria-label={`Pieces of ${r.description}`}
              inputMode="numeric"
              value={pcs}
              placeholder={have ? String(have.orderPieces) : "0"}
              disabled={disabled || (can === 0 && !have)}
              onChange={(e) => {
                setPcs(e.target.value.replace(/\D/g, "").slice(0, 8));
                setCtn("");
                setMsg("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && ready) void apply(cartons!, pieces);
              }}
              className={`mt-0.5 block w-24 rounded-lg border bg-ink-900/60 px-2 py-1.5 text-right font-mono text-sm text-verdigris-50 ${
                problem && pieces !== null ? "border-rose-500" : "border-verdigris-300/15"
              }`}
            />
          </label>
          <label className="text-[11px] text-verdigris-200/60">
            Cartons
            <input
              aria-label={`Cartons of ${r.description}`}
              inputMode="numeric"
              value={ctn === "" ? (suggested ?? "") : ctn}
              placeholder={have ? String(have.cartons) : "0"}
              disabled={disabled || pieces === null}
              onChange={(e) => {
                setCtn(e.target.value.replace(/\D/g, "").slice(0, 6));
                setMsg("");
              }}
              className={`mt-0.5 block w-20 rounded-lg border bg-ink-900/60 px-2 py-1.5 text-right font-mono text-sm text-verdigris-50 ${
                cartons !== null && cartons > can ? "border-rose-500" : "border-verdigris-300/15"
              }`}
            />
          </label>
          <button
            type="button"
            disabled={disabled || busy || !ready}
            onClick={() => void apply(cartons!, pieces)}
            className="rounded-lg bg-verdigris-400 px-3 py-2 text-xs font-semibold text-ink-900 hover:bg-patina disabled:opacity-40"
          >
            {busy ? "…" : have ? "Update" : "Add"}
          </button>
          {have ? (
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => void apply(0, null)}
              className="rounded-lg border border-verdigris-300/20 px-2.5 py-2 text-xs text-verdigris-200/75 hover:text-rose-300"
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
      {pieces !== null && !problem && cartons !== null ? (
        <p className="mt-1 text-right text-xs text-verdigris-200/70" data-calc>
          {n(cartons)} ctn × {n(ppc)} = {n(sent!)} pcs
          {diff > 0 ? <span className="text-amber-200"> · {n(diff)} more than ordered</span> : null}
          {diff < 0 ? <span className="text-amber-200"> · {n(-diff)} short of the order</span> : null}
        </p>
      ) : null}
      {msg || problem ? (
        <p className="mt-1 text-right text-xs font-medium text-rose-300" role="alert">
          {msg || problem}
        </p>
      ) : null}
    </li>
  );
}
