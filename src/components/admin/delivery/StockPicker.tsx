"use client";

import { useMemo, useState } from "react";

import type { StockRow } from "@/lib/delivery/ops";

const n = (v: number) => v.toLocaleString("en-IN");
export const lineKey = (warehouseId: number, key: string) => `${warehouseId}|${key}`;

/**
 * The importer's stock, by warehouse: what is free, and a box to say how
 * many cartons this note takes. `chosen` is what the note has now;
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
  chosen: Record<string, number>;
  extra?: Record<string, number>;
  onSet: (row: StockRow, cartons: number) => Promise<{ ok: boolean; message?: string }>;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

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

  const apply = async (r: StockRow, value: number) => {
    const k = lineKey(r.warehouseId, r.key);
    setBusy(k);
    const res = await onSet(r, value);
    setBusy(null);
    setMsg((m) => ({ ...m, [k]: res.ok ? "" : (res.message ?? "Could not hold these cartons") }));
    if (res.ok) setTyped((t) => ({ ...t, [k]: "" }));
  };

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
          <p className="bg-ink-900/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-verdigris-300">
            {g.name}
          </p>
          <ul className="divide-y divide-verdigris-300/5">
            {g.rows.map((r) => {
              const k = lineKey(r.warehouseId, r.key);
              const have = chosen[k] ?? 0;
              const can = r.available + (extra[k] ?? 0);
              const value = typed[k] ?? "";
              const want = value === "" ? null : Number(value);
              const tooMany = want !== null && want > can;
              return (
                <li key={k} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${have ? "bg-patina/5" : ""}`} data-stock={r.description}>
                  <div className="min-w-[12rem] flex-1">
                    <p className="line-clamp-2 break-words text-sm font-medium text-verdigris-50">
                      {r.itemCode ? <span className="font-mono text-verdigris-200/70">{r.itemCode} · </span> : null}
                      {r.description}
                    </p>
                    <p className="text-xs text-verdigris-200/55">
                      {n(r.piecesPerCarton)} {r.unitCode ?? "pcs"} / carton ·{" "}
                      <span className={can > 0 ? "text-emerald-300" : "text-rose-300"} data-free>
                        {n(can)} carton{can === 1 ? "" : "s"} free
                      </span>
                      {have ? <span className="ml-1.5 font-medium text-patina">· {n(have)} in this note</span> : null}
                    </p>
                    {msg[k] ? <p className="mt-0.5 text-xs font-medium text-rose-300" role="alert">{msg[k]}</p> : null}
                    {tooMany && !msg[k] ? <p className="mt-0.5 text-xs font-medium text-rose-300">Only {n(can)} free</p> : null}
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <input
                      aria-label={`Cartons of ${r.description}`}
                      inputMode="numeric"
                      value={value}
                      placeholder={have ? String(have) : "0"}
                      disabled={disabled || (can === 0 && !have)}
                      onChange={(e) => setTyped((t) => ({ ...t, [k]: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && want !== null && !tooMany) void apply(r, want);
                      }}
                      className={`w-20 rounded-lg border bg-ink-900/60 px-2 py-1.5 text-right font-mono text-sm text-verdigris-50 ${
                        tooMany ? "border-rose-500" : "border-verdigris-300/15"
                      }`}
                    />
                    <button
                      type="button"
                      disabled={disabled || busy === k || want === null || tooMany}
                      onClick={() => want !== null && void apply(r, want)}
                      className="rounded-lg bg-verdigris-400 px-3 py-1.5 text-xs font-semibold text-ink-900 hover:bg-patina disabled:opacity-40"
                    >
                      {busy === k ? "…" : have ? "Update" : "Add"}
                    </button>
                    {have ? (
                      <button
                        type="button"
                        disabled={disabled || busy === k}
                        onClick={() => void apply(r, 0)}
                        className="rounded-lg border border-verdigris-300/20 px-2.5 py-1.5 text-xs text-verdigris-200/75 hover:text-rose-300"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
