"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api/client";
import type { CartonQueueRow } from "@/lib/inward/cartons";
import { fmtDay } from "@/lib/format/datetime";
import { Card, StatusBadge } from "@/components/admin/ui";

import CartonsPanel, { type CartonsInitial } from "./CartonsPanel";
import { fmt } from "./InwardTable";

/**
 * The "QR codes" menu: one box to find the inward (by number, container,
 * importer or warehouse), one tap to pick it, and its cartons panel —
 * generate, print, scan, finish — right underneath. The last inward
 * picked is remembered on this computer.
 */

const LAST = "wms.qrInward";

function progress(r: CartonQueueRow): { text: string; tone: string } {
  if (!r.ready && r.generated === 0) return { text: "needs vehicle & driver", tone: "text-rose-300" };
  if (r.generated === 0) return { text: "not numbered", tone: "text-amber-300" };
  if (r.printed < r.generated) return { text: `${fmt(r.printed)}/${fmt(r.generated)} printed`, tone: "text-amber-300" };
  return {
    text: `${fmt(r.received)}/${fmt(r.generated)} received${r.hold ? ` · ${fmt(r.hold)} on hold` : ""}`,
    tone: r.received + r.hold >= r.generated ? "text-emerald-300" : "text-verdigris-100",
  };
}

export default function QrCodesScreen({
  initial,
  initialId,
  initialCompleted,
  initialCartons,
}: {
  initial: CartonQueueRow[];
  initialId: number | null;
  initialCompleted: boolean;
  /** The named inward's cartons, read with the page. */
  initialCartons?: CartonsInitial | null;
}) {
  const [rows, setRows] = useState(initial);
  const [completed, setCompleted] = useState(initialCompleted);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<number | null>(initialId);
  const [open, setOpen] = useState(initialId === null);
  const box = useRef<HTMLInputElement>(null);

  // No inward in the address: come back to the one picked last time.
  useEffect(() => {
    if (initialId !== null) return;
    let last: number | null = null;
    try {
      last = Number(window.localStorage.getItem(LAST)) || null;
    } catch {
      last = null;
    }
    if (last && initial.some((r) => r.id === last)) {
      setPicked(last);
      setOpen(false);
    } else {
      box.current?.focus();
    }
  }, [initial, initialId]);

  const reload = useCallback(
    async (withCompleted = completed) => {
      const r = await api<{ requests: CartonQueueRow[] }>(`/qr-codes${withCompleted ? "?completed=1" : ""}`, { method: "GET" });
      if (r.ok) setRows(r.data.requests);
    },
    [completed],
  );

  const pick = (id: number) => {
    setPicked(id);
    setOpen(false);
    setQ("");
    try {
      window.localStorage.setItem(LAST, String(id));
    } catch {
      /* private window: just not remembered */
    }
    const url = new URL(window.location.href);
    url.searchParams.set("id", String(id));
    window.history.replaceState(null, "", url);
  };

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) =>
      [r.code, r.containerNumber ?? "", r.importer, r.warehouse].some((v) => v.toLowerCase().includes(t)),
    );
  }, [rows, q]);

  const current = rows.find((r) => r.id === picked) ?? null;

  return (
    <div className="space-y-5">
      <Card className="p-5">
        {current && !open ? (
          <div className="flex flex-wrap items-center gap-3" id="qr-picked">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Inward</p>
              <p className="mt-1 flex flex-wrap items-center gap-2">
                <span className="font-mono text-lg font-semibold text-verdigris-50">{current.code}</span>
                <StatusBadge value={current.status} />
              </p>
              <p className="mt-0.5 truncate text-sm text-verdigris-200/65">
                {[current.importer, current.containerNumber, current.warehouse].filter(Boolean).join(" · ")}
              </p>
            </div>
            <Link
              href={`/admin/inward/${current.id}`}
              className="rounded-xl border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45"
            >
              Open request
            </Link>
            <button
              type="button"
              id="qr-change"
              onClick={() => {
                setOpen(true);
                setTimeout(() => box.current?.focus(), 0);
              }}
              className="rounded-xl bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-patina"
            >
              Change inward
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={box}
                id="qr-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && shown.length === 1) pick(shown[0]!.id);
                  if (e.key === "Escape" && current) setOpen(false);
                }}
                placeholder="Search inward no., container, importer or warehouse…"
                className="min-w-0 flex-1 rounded-xl border border-verdigris-300/20 bg-ink-900/60 px-4 py-2.5 text-sm text-verdigris-50 placeholder:text-verdigris-200/35 focus:border-patina focus:outline-none"
              />
              <label className="flex items-center gap-2 text-sm text-verdigris-200/70">
                <input
                  type="checkbox"
                  id="qr-completed"
                  checked={completed}
                  onChange={(e) => {
                    setCompleted(e.target.checked);
                    void reload(e.target.checked);
                  }}
                />
                Include completed (30 days)
              </label>
              {current ? (
                <button type="button" onClick={() => setOpen(false)} className="text-sm text-verdigris-200/60 hover:text-patina">
                  Cancel
                </button>
              ) : null}
            </div>
            {shown.length === 0 ? (
              <p className="mt-4 text-sm text-verdigris-200/55">
                {rows.length === 0
                  ? "No inward is ready for QR codes. An inward appears here once the warehouse has acknowledged it."
                  : "Nothing matches that search."}
              </p>
            ) : (
              <ul className="mt-4 max-h-[26rem] divide-y divide-verdigris-300/10 overflow-y-auto rounded-xl border border-verdigris-300/10" id="qr-list">
                {shown.map((r) => {
                  const p = progress(r);
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        id={`qr-row-${r.id}`}
                        onClick={() => pick(r.id)}
                        className={`flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-patina/10 ${
                          r.id === picked ? "bg-patina/10" : ""
                        }`}
                      >
                        <span className="font-mono text-sm font-semibold text-verdigris-50">{r.code}</span>
                        <StatusBadge value={r.status} />
                        <span className="min-w-0 flex-1 truncate text-sm text-verdigris-100">
                          {[r.importer, r.containerNumber].filter(Boolean).join(" · ")}
                        </span>
                        <span className="text-xs text-verdigris-200/55">
                          {r.warehouse}
                          {r.expectedArrival ? ` · ${fmtDay(r.expectedArrival)}` : ""}
                        </span>
                        <span className="text-xs text-verdigris-200/55">{fmt(r.declared)} ctn</span>
                        <span className={`text-xs font-medium ${p.tone}`}>{p.text}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Card>

      {current ? (
        <CartonsPanel
          key={current.id}
          requestId={current.id}
          initial={current.id === initialId ? initialCartons : null}
          onChanged={() => void reload()}
        />
      ) : null}
    </div>
  );
}
