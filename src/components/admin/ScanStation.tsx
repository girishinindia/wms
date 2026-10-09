"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api/client";
import type { CartonOverview, ScanResult } from "@/lib/inward/cartons";
import { useToast } from "@/components/Toast";
import { Card, ConfirmDialog } from "@/components/admin/ui";

import { fmtTime } from "@/lib/format/datetime";

import { fmt } from "./InwardTable";

/**
 * The scan station. One box, always focused. A handheld or USB scanner
 * "types" the QR and presses Enter; this page sends it, beeps, and shows
 * a big green (received) or red (stop) card.
 *
 * Fast on purpose: no button to press per carton, no dialog unless
 * something is wrong. Scans queue locally and go up in order, so a
 * dropped connection loses nothing — they are sent when it comes back.
 */

const HOLD_REASONS = ["Damaged", "Short quantity", "Wrong item", "Wet", "Weight mismatch", "Other"];

type Pending = { clientScanId: string; code: string; via: "SCAN" | "MANUAL" };
type Seen = ScanResult & { at: number };

function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const tone = (freq: number, start: number, len: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      o.type = ok ? "sine" : "square";
      g.gain.value = 0.15;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + start);
      o.stop(ctx.currentTime + start + len);
    };
    if (ok) tone(1046, 0, 0.12);
    else {
      tone(220, 0, 0.16);
      tone(220, 0.22, 0.16);
    }
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* no audio: the colour still says it */
  }
}

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export default function ScanStation({ initial }: { initial: CartonOverview }) {
  const toast = useToast();
  const id = initial.request.id;
  const [o, setO] = useState(initial);
  const [value, setValue] = useState("");
  const [last, setLast] = useState<Seen | null>(null);
  const [seen, setSeen] = useState<Seen[]>([]);
  const queue = useRef<Pending[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [offline, setOffline] = useState(false);
  const [hold, setHold] = useState<{ cartonId: number; cartonNo: string } | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [finishAsk, setFinishAsk] = useState<string | null>(null);

  const box = useRef<HTMLInputElement>(null);
  const buffer = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstKeyAt = useRef<number | null>(null);
  const keys = useRef(0);
  const sending = useRef(false);

  // Keep the cursor in the box — a scanner types wherever focus is.
  useEffect(() => {
    const refocus = () => {
      if (!hold && !finishAsk) setTimeout(() => box.current?.focus(), 0);
    };
    refocus();
    window.addEventListener("click", refocus);
    return () => window.removeEventListener("click", refocus);
  }, [hold, finishAsk]);

  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      while (queue.current.length) {
        const batch = queue.current.slice(0, 50);
        const r = await api<{ results: ScanResult[]; overview: CartonOverview }>(`/inward-requests/${id}/scans`, {
          body: { scans: batch.map((b) => ({ ...b, device: "Web scan station" })) },
        });
        if (!r.ok) {
          if (r.error.code === "NETWORK") {
            setOffline(true);
            setTimeout(() => void flush(), 3000);
          } else {
            toast.error(r.error.message);
            queue.current.splice(0, batch.length);
            setWaiting(queue.current.length);
          }
          break;
        }
        queue.current.splice(0, batch.length);
        setWaiting(queue.current.length);
        setOffline(false);
        setO(r.data.overview);
        const now = Date.now();
        const got = r.data.results.map((x) => ({ ...x, at: now }));
        const lastGot = got[got.length - 1]!;
        beep(lastGot.result === "RECEIVED");
        setLast(lastGot);
        setSeen((s) => [...got.reverse(), ...s].slice(0, 200));
      }
    } finally {
      sending.current = false;
    }
  }, [id, toast]);

  // A QR holds several lines; a scanner sends each line followed by Enter.
  // Collect lines that arrive close together and send them as one scan.
  const submitBuffer = () => {
    const code = buffer.current.trim();
    buffer.current = "";
    const started = firstKeyAt.current;
    const n = keys.current;
    firstKeyAt.current = null;
    keys.current = 0;
    if (!code) return;
    // A scanner types ~5 ms a key; a person 100+. Typed = no sticker read.
    const perKey = started && n ? (Date.now() - started) / n : 999;
    const via: "SCAN" | "MANUAL" = perKey < 40 && n >= 8 ? "SCAN" : "MANUAL";
    queue.current.push({ clientScanId: uid(), code, via });
    setWaiting(queue.current.length);
    void flush();
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

  const doHold = async () => {
    if (!hold || !reason) return;
    setBusy(true);
    const r = await api<CartonOverview>(`/inward-requests/${id}/cartons/${hold.cartonId}/hold`, {
      body: { reason, note: note.trim() || null },
    });
    setBusy(false);
    if (!r.ok) return toast.error(r.error.message);
    setO(r.data);
    toast.success(`${hold.cartonNo} on hold — the warehouse admin is told.`);
    setHold(null);
    setReason("");
    setNote("");
  };

  const finish = async (confirm: boolean) => {
    setBusy(true);
    const r = await api<unknown>(`/inward-requests/${id}/finish`, { body: { confirm } });
    setBusy(false);
    if (!r.ok) {
      if (!confirm && r.error.fields?.missing) return setFinishAsk(r.error.message);
      return toast.error(r.error.message);
    }
    setFinishAsk(null);
    toast.success(`${o.request.code} completed.`);
    window.location.href = `/admin/inward/${id}`;
  };

  const t = o.totals;
  const done = t.received + t.hold;
  const pct = t.generated ? Math.round((done / t.generated) * 100) : 0;
  const tone =
    last?.result === "RECEIVED"
      ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200"
      : last
        ? "border-rose-400/60 bg-rose-500/10 text-rose-200"
        : "border-verdigris-300/15 bg-ink-900/40 text-verdigris-200/60";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        {!o.can.work ? (
          <Card className="border-amber-400/30 p-4 text-sm text-verdigris-100">
            Scanning is open while the request is acknowledged or in process. It is {o.request.statusLabel.toLowerCase()} now.
          </Card>
        ) : null}
        <Card className="p-5">
          <label htmlFor="scan-box" className="mb-2 block text-xs font-semibold uppercase tracking-[0.1em] text-verdigris-300">
            Scan a carton — or type its number and press Enter
          </label>
          <input
            ref={box}
            id="scan-box"
            value={value}
            disabled={!o.can.work}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKey}
            autoComplete="off"
            spellCheck={false}
            placeholder={`${o.request.code}-0001`}
            className="w-full rounded-xl border-2 border-patina/60 bg-ink-900/60 px-4 py-3 font-mono text-lg text-verdigris-50 placeholder:text-verdigris-200/25 focus:outline-none focus:ring-4 focus:ring-patina/20"
          />
          <div className={`mt-4 rounded-2xl border-2 p-5 ${tone}`} aria-live="assertive" id="scan-result">
            {last ? (
              <>
                <p className="text-2xl font-semibold">
                  {last.result === "RECEIVED"
                    ? last.labelConfirmed
                      ? "✓ Label confirmed"
                      : "✓ Received"
                    : last.result === "DUPLICATE"
                      ? "✕ Already scanned"
                      : last.result === "OTHER_REQUEST"
                        ? "✕ Wrong inward"
                        : "✕ Not a known carton"}
                </p>
                <p className="mt-1 font-mono text-lg">{last.cartonNo ?? last.code.slice(0, 40)}</p>
                <p className="mt-1 text-sm opacity-90">
                  {last.carton ? `${[last.carton.itemCode, last.carton.description].filter(Boolean).join(" · ")} · ${last.carton.piecesPerCarton} ${last.carton.unitCode ?? "PCS"} · ` : ""}
                  {last.message}
                  {last.previous?.at ? ` · ${fmtTime(last.previous.at)}` : ""}
                </p>
                {last.carton && o.can.work ? (
                  <button
                    type="button"
                    onClick={() => setHold({ cartonId: last.carton!.id, cartonNo: last.cartonNo! })}
                    className="mt-3 rounded-lg border border-current px-3 py-1 text-xs"
                  >
                    Put this carton on hold
                  </button>
                ) : null}
              </>
            ) : (
              <p className="text-lg">Ready. Point the scanner at a carton sticker.</p>
            )}
          </div>
          {waiting || offline ? (
            <p className="mt-2 text-xs text-amber-300">
              {offline ? "Offline — " : "Sending — "}
              {waiting} scan{waiting === 1 ? "" : "s"} waiting; nothing is lost.
            </p>
          ) : null}
        </Card>

        <Card className="p-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-verdigris-300">This session</p>
          {seen.length === 0 ? (
            <p className="text-sm text-verdigris-200/50">Scans appear here.</p>
          ) : (
            <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
              {seen.map((s, i) => (
                <li key={`${s.clientScanId}-${i}`} className="flex items-center gap-3">
                  <span className={`w-28 shrink-0 text-xs font-medium ${s.result === "RECEIVED" ? "text-emerald-300" : "text-rose-300"}`}>
                    {s.result === "RECEIVED" ? (s.labelConfirmed ? "label ok" : "received") : s.result.replace("_", " ").toLowerCase()}
                  </span>
                  <span className="font-mono text-verdigris-100">{s.cartonNo ?? s.code.slice(0, 30)}</span>
                  <span className="truncate text-xs text-verdigris-200/50">{s.carton?.description ?? s.message}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Received</p>
          <p className="mt-1 font-mono text-3xl font-semibold text-verdigris-50" id="scan-count">
            {fmt(t.received)} <span className="text-base text-verdigris-200/50">/ {fmt(t.generated)}</span>
          </p>
          <div className="mt-2 h-2 rounded-full bg-ink-900/60">
            <div className="h-2 rounded-full bg-emerald-400" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-verdigris-200/55">
            {fmt(t.hold)} on hold · {fmt(t.missing)} not scanned{t.labelPending ? ` · ${fmt(t.labelPending)} need a sticker` : ""}
          </p>
          <ul className="mt-4 space-y-1.5 text-xs">
            {o.lines.map((l) => (
              <li key={l.lineId} className="flex justify-between gap-2">
                <span className="truncate text-verdigris-200/70">{l.itemCode ?? l.description}</span>
                <span className={`font-mono ${l.generated && l.received + l.hold >= l.generated ? "text-emerald-300" : "text-verdigris-100"}`}>
                  {l.received}/{l.generated}
                </span>
              </li>
            ))}
          </ul>
          {o.can.finish ? (
            <button type="button" disabled={busy} onClick={() => finish(false)} className="mt-5 w-full rounded-xl border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45">
              Finish inward
            </button>
          ) : null}
        </Card>
        <p className="px-1 text-[11px] leading-relaxed text-verdigris-200/45">
          Typed numbers (no sticker read) are received as “label pending”. Print those stickers later from the request page and scan them to clear the flag.
        </p>
      </aside>

      {hold ? (
        <ConfirmDialog
          title={`Hold ${hold.cartonNo}?`}
          busy={busy}
          message="Choose what is wrong. The warehouse admin and super admin are told."
          confirmLabel="Hold carton"
          tone="warn"
          onCancel={() => setHold(null)}
          onConfirm={doHold}
        >
          <div className="mt-4 flex flex-wrap gap-1.5">
            {HOLD_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={`rounded-full border px-3 py-1 text-xs ${reason === r ? "border-rose-400 bg-rose-400/15 text-rose-200" : "border-verdigris-300/20 text-verdigris-200/70"}`}
              >
                {r}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="mt-3 w-full rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50"
          />
          {!reason ? <p className="mt-1 text-xs text-rose-300">Choose a reason</p> : null}
        </ConfirmDialog>
      ) : null}

      {finishAsk ? (
        <ConfirmDialog
          title="Finish this inward?"
          busy={busy}
          message={`${finishAsk} They stay listed as not scanned.`}
          confirmLabel="Finish anyway"
          tone="warn"
          onCancel={() => setFinishAsk(null)}
          onConfirm={() => finish(true)}
        />
      ) : null}
    </div>
  );
}
