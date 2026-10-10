"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api/client";
import type { FloorRow, GalaRow, Layout, StoreWarehouse } from "@/lib/storage/locations";
import { useToast } from "@/components/Toast";
import { Card, ConfirmDialog } from "@/components/admin/ui";

import { GALA_LABEL_SIZES, printGalaLabels, type GalaLabelSize } from "./carton-print";
import { fmt } from "./InwardTable";

/**
 * Floors and galas of a warehouse: add the next floor, add N galas to a
 * floor (numbers are given out automatically), print the QR labels —
 * super admin, warehouse admin, storage manager. Rename, switch off and
 * delete (only if never used) — super admin and warehouse admin.
 */

const primary =
  "rounded-xl bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina disabled:opacity-50";
const secondary =
  "rounded-xl border border-verdigris-300/20 px-3 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45 disabled:opacity-50";
const SIZE_KEY = "wms.galaLabelSize";
const WH_KEY = "wms.storageWarehouse";

export default function LocationsScreen({
  warehouses,
  initial,
}: {
  warehouses: StoreWarehouse[];
  initial: Layout | null;
}) {
  const toast = useToast();
  const [l, setL] = useState<Layout | null>(initial);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState<GalaLabelSize>("a4");
  const [adding, setAdding] = useState<Record<number, string>>({});
  const [renaming, setRenaming] = useState<{ kind: "floor" | "gala"; id: number; code: string; value: string } | null>(null);
  const [deleting, setDeleting] = useState<{ kind: "floor" | "gala"; id: number; code: string; galas: number } | null>(null);

  useEffect(() => {
    try {
      const s = window.localStorage.getItem(SIZE_KEY);
      if (s === "a4" || s === "t100x75") setSize(s);
    } catch {
      /* not remembered */
    }
  }, []);

  const open = useCallback(async (warehouseId: number) => {
    const r = await api<Layout>(`/storage/warehouses/${warehouseId}`, { method: "GET" });
    if (r.ok) {
      setL(r.data);
      try {
        window.localStorage.setItem(WH_KEY, String(warehouseId));
      } catch {
        /* not remembered */
      }
      const url = new URL(window.location.href);
      url.searchParams.set("warehouse", String(warehouseId));
      window.history.replaceState(null, "", url);
    } else toast.error(r.error.message);
  }, [toast]);

  // No warehouse in the address: the one used last on this computer.
  useEffect(() => {
    if (initial) return;
    let last: number | null = null;
    try {
      last = Number(window.localStorage.getItem(WH_KEY)) || null;
    } catch {
      last = null;
    }
    if (last && warehouses.some((w) => w.id === last)) void open(last);
  }, [initial, warehouses, open]);

  const run = async (path: string, body: unknown, method: "POST" | "PATCH" | "DELETE" = "POST", done?: string) => {
    setBusy(true);
    const r = await api<Layout>(path, { method, body });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error.message);
      return false;
    }
    setL(r.data);
    if (done) toast.success(done);
    return true;
  };

  const path = (kind: "floor" | "gala", id: number) => `/storage/${kind === "floor" ? "floors" : "galas"}/${id}`;

  const saveName = async () => {
    if (!renaming) return;
    const name = renaming.value.trim();
    if (!name) {
      toast.error("Give it a name");
      return;
    }
    if (await run(path(renaming.kind, renaming.id), { name }, "PATCH", `${renaming.code} renamed`)) setRenaming(null);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    if (await run(path(deleting.kind, deleting.id), undefined, "DELETE", `${deleting.code} deleted`)) setDeleting(null);
  };

  const print = async (galas: GalaRow[], floor: FloorRow | null) => {
    if (!l || galas.length === 0) return;
    try {
      window.localStorage.setItem(SIZE_KEY, size);
    } catch {
      /* not remembered */
    }
    const floorOf = (g: GalaRow) => l.floors.find((f) => f.id === g.floorId);
    await printGalaLabels(
      galas.map((g) => ({
        code: g.code,
        fullId: g.fullId,
        qr: g.qr,
        warehouseName: l.warehouse.name,
        floorName: floorOf(g)?.name ?? "",
        galaName: g.name,
      })),
      size,
      `${l.warehouse.name} · ${floor ? floor.name : "all galas"}`,
    );
  };

  if (warehouses.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-sm text-verdigris-100">You are not linked to a warehouse yet.</p>
      </Card>
    );
  }

  const allGalas = l ? l.floors.flatMap((f) => f.galas.filter((g) => g.isActive)) : [];

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          {warehouses.length > 1 ? (
            <select
              id="loc-warehouse"
              value={l?.warehouse.id ?? ""}
              onChange={(e) => void open(Number(e.target.value))}
              className="rounded-xl border border-verdigris-300/20 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50"
            >
              {!l ? <option value="">Choose the warehouse…</option> : null}
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code})
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm font-medium text-verdigris-50">{warehouses[0]!.name}</p>
          )}
          {l ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <select
                id="loc-size"
                value={size}
                onChange={(e) => setSize(e.target.value as GalaLabelSize)}
                className="rounded-xl border border-verdigris-300/20 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50"
                title="Label size"
              >
                {GALA_LABEL_SIZES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button type="button" id="loc-print-all" className={secondary} disabled={allGalas.length === 0} onClick={() => void print(allGalas, null)}>
                Print all labels ({allGalas.length})
              </button>
              {l.can.add ? (
                <button
                  type="button"
                  id="loc-add-floor"
                  className={primary}
                  disabled={busy}
                  onClick={() => void run(`/storage/warehouses/${l.warehouse.id}/floors`, {}, "POST", "Floor added")}
                >
                  + Add floor
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {l ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Floors", l.totals.floors],
              ["Galas", l.totals.galas],
              ["Cartons stored", l.totals.stored],
              ["Empty galas", l.totals.emptyGalas],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl border border-verdigris-300/10 bg-ink-900/40 px-3 py-2">
                <p className="text-[11px] text-verdigris-200/60">{label}</p>
                <p className="font-mono text-xl font-semibold text-verdigris-50">{fmt(value as number)}</p>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      {l && l.floors.length === 0 ? (
        <Card className="p-6 text-sm text-verdigris-200/70">
          No floors yet. {l.can.add ? "Click “+ Add floor” to make Floor 1, then add its galas." : "Ask the warehouse manager to set them up."}
        </Card>
      ) : null}

      {l?.floors.map((f) => (
        <Card key={f.id} className={`p-5 ${f.isActive ? "" : "opacity-70"}`}>
          <div className="flex flex-wrap items-center gap-3" id={`floor-${f.code}`}>
            <p className="text-base font-semibold text-verdigris-50">{f.name}</p>
            <code className="text-xs text-verdigris-200/60">{l.warehouse.code}-{f.code}</code>
            <span className="text-sm text-verdigris-200/60">
              {f.galas.length} gala{f.galas.length === 1 ? "" : "s"} · {fmt(f.cartons)} carton{f.cartons === 1 ? "" : "s"}
            </span>
            {!f.isActive ? <span className="text-xs text-rose-300">switched off</span> : null}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button type="button" className={secondary} disabled={f.galas.length === 0} onClick={() => void print(f.galas.filter((g) => g.isActive), f)}>
                Print labels
              </button>
              {l.can.add && f.isActive ? (
                <>
                  <input
                    id={`floor-${f.code}-count`}
                    type="number"
                    min={1}
                    max={50}
                    value={adding[f.id] ?? "1"}
                    onChange={(e) => setAdding((a) => ({ ...a, [f.id]: e.target.value }))}
                    className="w-16 rounded-xl border border-verdigris-300/20 bg-ink-900/60 px-2 py-2 text-sm text-verdigris-50"
                    aria-label="Galas to add"
                  />
                  <button
                    type="button"
                    id={`floor-${f.code}-add`}
                    className={primary}
                    disabled={busy}
                    onClick={() => {
                      const n = Math.max(1, Math.min(50, Number(adding[f.id] ?? 1) || 1));
                      void run(`/storage/floors/${f.id}/galas`, { count: n }, "POST", `${n} gala${n === 1 ? "" : "s"} added`);
                    }}
                  >
                    + Add galas
                  </button>
                </>
              ) : null}
              {l.can.edit ? (
                <>
                  <button
                    type="button"
                    id={`floor-${f.code}-rename`}
                    className="rounded-xl px-2 py-2 text-xs text-verdigris-200/60 hover:text-patina"
                    disabled={busy}
                    onClick={() => setRenaming({ kind: "floor", id: f.id, code: f.code, value: f.name })}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    id={`floor-${f.code}-switch`}
                    className="rounded-xl px-2 py-2 text-xs text-verdigris-200/60 hover:text-patina"
                    disabled={busy}
                    onClick={() => void run(`/storage/floors/${f.id}`, { active: !f.isActive }, "PATCH")}
                  >
                    {f.isActive ? "Switch off" : "Switch on"}
                  </button>
                </>
              ) : null}
              {l.can.delete && !f.used ? (
                <button
                  type="button"
                  id={`floor-${f.code}-delete`}
                  className="rounded-xl px-2 py-2 text-xs text-rose-300/80 hover:text-rose-300"
                  disabled={busy}
                  onClick={() => setDeleting({ kind: "floor", id: f.id, code: f.code, galas: f.galas.length })}
                >
                  Delete
                </button>
              ) : null}
            </div>
          </div>
          {f.galas.length === 0 ? (
            <p className="mt-3 text-sm text-verdigris-200/55">No galas on this floor yet.</p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {f.galas.map((g) => (
                <div
                  key={g.id}
                  id={`gala-${g.code}`}
                  className={`rounded-xl border px-3 py-2 ${g.isActive ? "border-verdigris-300/15" : "border-dashed border-verdigris-300/20 opacity-60"}`}
                >
                  <Link href={`/admin/locations/galas/${g.id}`} className="block hover:text-patina">
                    <p className="text-sm font-medium text-verdigris-50">{g.name}</p>
                    <p className="font-mono text-xs text-verdigris-200/60">{g.code}</p>
                    <p className={`mt-1 text-xs ${g.cartons > 0 ? "text-emerald-300" : "text-verdigris-200/50"}`}>
                      {!g.isActive ? "Switched off" : g.cartons > 0 ? `${fmt(g.cartons)} carton${g.cartons === 1 ? "" : "s"}` : "Empty"}
                    </p>
                  </Link>
                  <div className="mt-1 flex flex-wrap gap-x-2 text-[11px]">
                    {g.isActive ? (
                      <button type="button" className="text-verdigris-300 hover:text-patina" onClick={() => void print([g], f)}>
                        Label
                      </button>
                    ) : null}
                    {l.can.edit ? (
                      <>
                        <button
                          type="button"
                          id={`gala-${g.code}-rename`}
                          className="text-verdigris-200/60 hover:text-patina"
                          disabled={busy}
                          onClick={() => setRenaming({ kind: "gala", id: g.id, code: g.code, value: g.name })}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          id={`gala-${g.code}-switch`}
                          className="text-verdigris-200/60 hover:text-patina"
                          disabled={busy}
                          onClick={() => void run(`/storage/galas/${g.id}`, { active: !g.isActive }, "PATCH")}
                        >
                          {g.isActive ? "Switch off" : "Switch on"}
                        </button>
                      </>
                    ) : null}
                    {l.can.delete && !g.used ? (
                      <button
                        type="button"
                        id={`gala-${g.code}-delete`}
                        className="text-rose-300/80 hover:text-rose-300"
                        disabled={busy}
                        onClick={() => setDeleting({ kind: "gala", id: g.id, code: g.code, galas: 0 })}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      ))}

      {renaming ? (
        <ConfirmDialog
          title={`Rename ${renaming.code}`}
          tone="warn"
          message="The code and the QR label stay the same — only the name shown changes."
          confirmLabel="Save"
          busy={busy}
          onConfirm={() => void saveName()}
          onCancel={() => setRenaming(null)}
        >
          <input
            id="loc-rename-input"
            autoFocus
            maxLength={60}
            value={renaming.value}
            onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveName();
            }}
            className="mt-3 w-full rounded-xl border border-verdigris-300/20 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50"
          />
        </ConfirmDialog>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Delete ${deleting.code}?`}
          message={
            deleting.kind === "floor"
              ? `The floor and its ${deleting.galas} gala${deleting.galas === 1 ? "" : "s"} are removed for good. Their printed labels will no longer work.`
              : "The gala is removed for good. Its printed label will no longer work."
          }
          confirmLabel="Delete"
          busy={busy}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}
