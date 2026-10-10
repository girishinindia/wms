"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api/client";
import { fmtTime } from "@/lib/format/datetime";
import { galaFromScan } from "@/lib/storage/location-format";
import type { GalaRow, Layout, StoreWarehouse } from "@/lib/storage/locations";
import type { StoreResult, WaitingRow } from "@/lib/storage/store";
import { useToast } from "@/components/Toast";
import { Card } from "@/components/admin/ui";

import { fmt } from "./InwardTable";
import { beep, uid } from "./scan-kit";

/**
 * Storing cartons: scan the gala's QR once, then carton after carton —
 * each lands in that gala until another gala is scanned. A carton already
 * in another gala asks before it moves. Works with a USB / Bluetooth
 * scanner (it types into the box) or by typing.
 */

type Pending = { clientScanId: string; code: string; via: "SCAN" | "MANUAL"; galaId: number; move?: boolean };
type Seen = StoreResult & { at: number; gala: string };
type Recent = { cartonNo: string; itemCode: string | null; description: string; gala: string; fromGala: string | null; action: string; at: string; by: string | null };

const WH_KEY = "wms.storageWarehouse";
const GOOD = new Set(["STORED", "MOVED", "ALREADY_HERE"]);

export default function StoreStation({
  warehouses,
  initial,
  initialWaiting,
  initialRecent,
}: {
  warehouses: StoreWarehouse[];
  initial: Layout | null;
  initialWaiting: WaitingRow[];
  initialRecent: Recent[];
}) {
  const toast = useToast();
  const [l, setL] = useState<Layout | null>(initial);
  const [gala, setGala] = useState<GalaRow | null>(null);
  const [value, setValue] = useState("");
  const [last, setLast] = useState<Seen | { result: "GALA" | "ERROR"; message: string; at: number } | null>(null);
  const [seen, setSeen] = useState<Seen[]>([]);
  const [waiting, setWaiting] = useState(initialWaiting);
  const [recent] = useState(initialRecent);
  const [pending, setPending] = useState(0);
  const [offline, setOffline] = useState(false);
  const [session, setSession] = useState(0);
  const queue = useRef<Pending[]>([]);
  const sending = useRef(false);
  const box = useRef<HTMLInputElement>(null);
  const buffer = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstKeyAt = useRef<number | null>(null);
  const keys = useRef(0);

  // A scanner types wherever focus is: keep it in the box.
  useEffect(() => {
    const refocus = () => setTimeout(() => box.current?.focus(), 0);
    refocus();
    window.addEventListener("click", refocus);
    return () => window.removeEventListener("click", refocus);
  }, []);

  const loadWaiting = useCallback(async (warehouseId: number) => {
    const r = await api<{ waiting: WaitingRow[] }>(`/storage/warehouses/${warehouseId}/waiting`, { method: "GET" });
    if (r.ok) setWaiting(r.data.waiting);
  }, []);

  const open = useCallback(
    async (warehouseId: number) => {
      const r = await api<Layout>(`/storage/warehouses/${warehouseId}`, { method: "GET" });
      if (!r.ok) return toast.error(r.error.message);
      setL(r.data);
      setGala(null);
      try {
        window.localStorage.setItem(WH_KEY, String(warehouseId));
      } catch {
        /* not remembered */
      }
      void loadWaiting(warehouseId);
    },
    [toast, loadWaiting],
  );

  useEffect(() => {
    if (initial) return;
    let lastWh: number | null = null;
    try {
      lastWh = Number(window.localStorage.getItem(WH_KEY)) || null;
    } catch {
      lastWh = null;
    }
    if (lastWh && warehouses.some((w) => w.id === lastWh)) void open(lastWh);
  }, [initial, warehouses, open]);

  const galas = useMemo(() => (l ? l.floors.flatMap((f) => f.galas) : []), [l]);

  const flush = useCallback(async () => {
    if (sending.current || !l) return;
    sending.current = true;
    try {
      while (queue.current.length) {
        const galaId = queue.current[0]!.galaId;
        const batch: Pending[] = [];
        for (const p of queue.current) {
          if (p.galaId !== galaId || batch.length >= 50) break;
          batch.push(p);
        }
        const r = await api<{ results: StoreResult[]; storedHere: number }>(`/storage/warehouses/${l.warehouse.id}/store`, {
          body: {
            galaId,
            scans: batch.map((b) => ({ code: b.code, clientScanId: b.clientScanId, via: b.via, move: b.move, device: "Web store station" })),
          },
        });
        if (!r.ok) {
          if (r.error.code === "NETWORK") {
            setOffline(true);
            setTimeout(() => void flush(), 3000);
          } else {
            toast.error(r.error.message);
            beep(false);
            setLast({ result: "ERROR", message: r.error.message, at: Date.now() });
            queue.current.splice(0, batch.length);
            setPending(queue.current.length);
          }
          break;
        }
        queue.current.splice(0, batch.length);
        setPending(queue.current.length);
        setOffline(false);
        const code = galas.find((g) => g.id === galaId)?.code ?? "";
        const now = Date.now();
        const got = r.data.results.map((x) => ({ ...x, at: now, gala: code }));
        const lastGot = got[got.length - 1]!;
        beep(GOOD.has(lastGot.result));
        setLast(lastGot);
        setSeen((s) => [...got.reverse(), ...s].slice(0, 200));
        setSession((n) => n + got.filter((x) => x.result === "STORED" || x.result === "MOVED").length);
        setL((cur) =>
          cur
            ? {
                ...cur,
                floors: cur.floors.map((f) => ({
                  ...f,
                  galas: f.galas.map((g) => (g.id === galaId ? { ...g, cartons: r.data.storedHere } : g)),
                })),
              }
            : cur,
        );
      }
    } finally {
      sending.current = false;
    }
    if (l) void loadWaiting(l.warehouse.id);
  }, [l, galas, toast, loadWaiting]);

  const pickGala = (g: GalaRow) => {
    if (!g.isActive) {
      beep(false);
      setLast({ result: "ERROR", message: `${g.code} is switched off. Choose an active gala.`, at: Date.now() });
      return;
    }
    setGala(g);
    beep(true);
    setLast({ result: "GALA", message: `Storing into ${g.code} · ${g.name}`, at: Date.now() });
  };

  const handle = (code: string, via: "SCAN" | "MANUAL") => {
    if (!l) return;
    const asGala = galaFromScan(code);
    if (asGala) {
      if (asGala.warehouseCode && asGala.warehouseCode !== l.warehouse.code.toUpperCase()) {
        beep(false);
        setLast({ result: "ERROR", message: `That gala label is from ${asGala.warehouseCode}, not ${l.warehouse.code}.`, at: Date.now() });
        return;
      }
      const g = galas.find((x) => x.code === asGala.code);
      if (!g) {
        beep(false);
        setLast({ result: "ERROR", message: `${asGala.code} is not a gala of ${l.warehouse.name}.`, at: Date.now() });
        return;
      }
      pickGala(g);
      return;
    }
    if (!gala) {
      beep(false);
      setLast({ result: "ERROR", message: "Scan the gala's QR first — then the cartons.", at: Date.now() });
      return;
    }
    queue.current.push({ clientScanId: uid(), code, via, galaId: gala.id });
    setPending(queue.current.length);
    void flush();
  };

  const submitBuffer = () => {
    const code = buffer.current.trim();
    buffer.current = "";
    const started = firstKeyAt.current;
    const n = keys.current;
    firstKeyAt.current = null;
    keys.current = 0;
    if (!code) return;
    const perKey = started && n ? (Date.now() - started) / n : 999;
    handle(code, perKey < 40 && n >= 8 ? "SCAN" : "MANUAL");
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (firstKeyAt.current === null) firstKeyAt.current = Date.now();
    keys.current += 1;
    if (e.key === "Enter") {
      e.preventDefault();
      buffer.current += `${value}\n`;
      setValue("");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(submitBuffer, 160);
    }
  };

  const moveHere = (s: Seen) => {
    if (!gala) return;
    queue.current.push({ clientScanId: uid(), code: s.cartonNo ?? s.code, via: "MANUAL", galaId: gala.id, move: true });
    setPending(queue.current.length);
    void flush();
  };

  if (warehouses.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-sm text-verdigris-100">You are not linked to a warehouse yet.</p>
      </Card>
    );
  }

  const ok = last && (last.result === "GALA" || GOOD.has(last.result));
  const tone = !last
    ? "border-verdigris-300/15 bg-ink-900/40 text-verdigris-200/60"
    : ok
      ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200"
      : last.result === "MOVE_CONFIRM"
        ? "border-amber-400/60 bg-amber-500/10 text-amber-200"
        : "border-rose-400/60 bg-rose-500/10 text-rose-200";
  const title = !last
    ? ""
    : last.result === "GALA"
      ? "✓ Gala chosen"
      : last.result === "STORED"
        ? `✓ Stored in ${(last as Seen).gala}`
        : last.result === "MOVED"
          ? `✓ Moved to ${(last as Seen).gala}`
          : last.result === "ALREADY_HERE"
            ? "Already here"
            : last.result === "MOVE_CONFIRM"
              ? "In another gala"
              : "✕ Not stored";
  const lastSeen = last && "code" in last ? (last as Seen) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            {warehouses.length > 1 ? (
              <select
                id="store-warehouse"
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
            {l && galas.length === 0 ? (
              <Link href={`/admin/locations?warehouse=${l.warehouse.id}`} className="text-sm text-amber-300 hover:text-patina">
                No galas yet — set up floors and galas first →
              </Link>
            ) : null}
          </div>

          <div
            id="store-gala"
            className={`mt-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${
              gala ? "border-emerald-400/40 bg-emerald-400/10" : "border-dashed border-verdigris-300/25"
            }`}
          >
            <div>
              <p className="text-xs text-verdigris-200/60">Storing into</p>
              <p className={`text-lg font-semibold ${gala ? "text-emerald-200" : "text-verdigris-200/60"}`}>
                {gala ? `${gala.code} · ${gala.name}` : "Scan a gala QR to start"}
              </p>
            </div>
            {l && galas.length ? (
              <select
                id="store-pick-gala"
                value={gala?.id ?? ""}
                onChange={(e) => {
                  const g = galas.find((x) => x.id === Number(e.target.value));
                  if (g) pickGala(g);
                }}
                className="ml-auto rounded-xl border border-verdigris-300/20 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50"
              >
                <option value="">{gala ? "Change gala…" : "Or pick a gala…"}</option>
                {l.floors.map((f) => (
                  <optgroup key={f.id} label={f.name}>
                    {f.galas
                      .filter((g) => g.isActive)
                      .map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.code} · {g.name} ({g.cartons})
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            ) : null}
          </div>

          <label htmlFor="store-box" className="mb-2 mt-4 block text-xs font-semibold uppercase tracking-[0.1em] text-verdigris-300">
            Scan a gala or a carton — or type the number and press Enter
          </label>
          <input
            ref={box}
            id="store-box"
            value={value}
            disabled={!l}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKey}
            autoComplete="off"
            spellCheck={false}
            placeholder={gala ? "INR-000006-0001" : "F1-G01"}
            className="w-full rounded-xl border-2 border-patina/60 bg-ink-900/60 px-4 py-3 font-mono text-lg text-verdigris-50 placeholder:text-verdigris-200/25 focus:outline-none focus:ring-4 focus:ring-patina/20"
          />

          <div className={`mt-4 rounded-2xl border-2 p-5 ${tone}`} aria-live="assertive" id="store-result">
            {last ? (
              <>
                <p className="text-2xl font-semibold">{title}</p>
                {lastSeen ? <p className="mt-1 font-mono text-lg">{lastSeen.cartonNo ?? lastSeen.code.slice(0, 40)}</p> : null}
                <p className="mt-1 text-sm opacity-90">
                  {lastSeen?.carton
                    ? `${[lastSeen.carton.itemCode, lastSeen.carton.description].filter(Boolean).join(" · ")} · ${lastSeen.carton.piecesPerCarton} ${lastSeen.carton.unitCode ?? "PCS"} · ${lastSeen.carton.importer} · `
                    : ""}
                  {last.message}
                  {lastSeen?.from?.at && lastSeen.result !== "MOVED" ? ` · since ${fmtTime(lastSeen.from.at)}${lastSeen.from.by ? ` by ${lastSeen.from.by}` : ""}` : ""}
                </p>
                {lastSeen?.result === "MOVE_CONFIRM" && gala ? (
                  <div className="mt-3 flex gap-2">
                    <button type="button" id="store-move" onClick={() => moveHere(lastSeen)} className="rounded-lg border border-current px-3 py-1 text-sm">
                      Move to {gala.code}
                    </button>
                    <button type="button" onClick={() => setLast(null)} className="rounded-lg px-3 py-1 text-sm opacity-80">
                      Leave it
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-lg">Ready. Scan the gala first, then its cartons.</p>
            )}
          </div>
          {pending || offline ? (
            <p className="mt-2 text-sm text-amber-300">
              {pending} scan{pending === 1 ? "" : "s"} waiting{offline ? " — no connection, nothing is lost" : "…"}
            </p>
          ) : null}
        </Card>

        <Card className="p-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">
            {seen.length ? "This session" : "Last stored"}
          </p>
          <ul className="space-y-1 text-sm" id="store-list">
            {seen.length
              ? seen.slice(0, 50).map((s, i) => (
                  <li key={`${s.clientScanId}-${i}`} className={GOOD.has(s.result) ? "text-verdigris-100" : s.result === "MOVE_CONFIRM" ? "text-amber-300" : "text-rose-300"}>
                    <span className="font-mono">{s.cartonNo ?? s.code.slice(0, 30)}</span> · {s.message}
                  </li>
                ))
              : recent.slice(0, 20).map((r, i) => (
                  <li key={i} className="text-verdigris-200/70">
                    <span className="font-mono text-verdigris-100">{r.cartonNo}</span> → {r.gala}
                    {r.fromGala ? ` (from ${r.fromGala})` : ""} · {[r.itemCode, r.description].filter(Boolean).join(" · ")} · {fmtTime(r.at)}
                    {r.by ? ` · ${r.by}` : ""}
                  </li>
                ))}
            {!seen.length && !recent.length ? <li className="text-verdigris-200/55">Nothing stored yet.</li> : null}
          </ul>
        </Card>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">This session</p>
          <p className="mt-1 font-mono text-3xl font-semibold text-verdigris-50" id="store-count">
            {fmt(session)}
          </p>
          <p className="text-xs text-verdigris-200/55">cartons stored or moved</p>
          {gala ? (
            <p className="mt-3 text-sm text-verdigris-100">
              {gala.code} now holds <b>{fmt(galas.find((g) => g.id === gala.id)?.cartons ?? 0)}</b> cartons
            </p>
          ) : null}
        </Card>
        <Card className="p-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Waiting to be stored</p>
          {waiting.length === 0 ? (
            <p className="text-sm text-verdigris-200/55">Every received carton is in a gala.</p>
          ) : (
            <ul className="space-y-2 text-sm" id="store-waiting">
              {waiting.map((w) => (
                <li key={w.id}>
                  <Link href={`/admin/inward/${w.id}`} className="flex justify-between gap-2 hover:text-patina">
                    <span className="font-mono text-verdigris-50">{w.code}</span>
                    <span className="text-amber-300">{fmt(w.waiting)} to store</span>
                  </Link>
                  <p className="text-xs text-verdigris-200/55">
                    {w.importer} · {fmt(w.stored)} of {fmt(w.received)} stored
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </aside>
    </div>
  );
}
