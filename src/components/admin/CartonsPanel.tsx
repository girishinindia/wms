"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api/client";
import type { CartonLabel, CartonOverview } from "@/lib/inward/cartons";
import { useToast } from "@/components/Toast";
import { Card, ConfirmDialog } from "@/components/admin/ui";

import { fitNumbers, printMarkerList, printStickers, qrSvg, STICKER_MM, STICKER_SIZES, stickerPreviewDoc, type StickerSize } from "./carton-print";
import { fmtTime } from "@/lib/format/datetime";

import { fmt } from "./InwardTable";
import { sendHoldPhoto } from "./scan-kit";

/**
 * The warehouse side's carton work on one inward request: generate the
 * numbers, print the stickers, open the scan station, sort out holds,
 * finish. Super admin, warehouse admin and inward manager only.
 */

const primary =
  "rounded-xl bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina disabled:opacity-50";
const secondary =
  "rounded-xl border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45 disabled:opacity-50";
const chip = (on: boolean) =>
  `rounded-full border px-3 py-1 text-xs ${
    on ? "border-patina bg-patina/15 text-patina" : "border-verdigris-300/20 text-verdigris-200/70 hover:border-patina/50"
  }`;

type Hold = { id: number; cartonNo: string; itemCode: string | null; description: string; reason: string | null; note: string | null; photoUrl: string | null; at: string | null; by: string | null };

/** The panel's first state, read on the server with the page. */
export type CartonsInitial = { overview: CartonOverview; holds: Hold[] };

export default function CartonsPanel({
  requestId,
  onChanged,
  initial,
}: {
  requestId: number;
  onChanged?: () => void;
  initial?: CartonsInitial | null;
}) {
  const toast = useToast();
  const [o, setO] = useState<CartonOverview | null>(initial?.overview ?? null);
  const [holds, setHolds] = useState<Hold[]>(initial?.holds ?? []);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState<null | { lineId?: number }>(null);
  const [finishAsk, setFinishAsk] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<CartonOverview>(`/inward-requests/${requestId}/cartons`, { method: "GET" });
    if (r.ok) {
      setO(r.data);
      if (r.data.totals.hold > 0) {
        const h = await api<{ holds: Hold[] }>(`/inward-requests/${requestId}/cartons/holds`, { method: "GET" });
        if (h.ok) setHolds(h.data.holds);
      } else setHolds([]);
    }
  }, [requestId]);

  // Already read with the page: no second request on arrival.
  const [fresh] = useState(Boolean(initial));
  useEffect(() => {
    if (!fresh) void load();
  }, [load, fresh]);

  if (!o) {
    return (
      <Card className="p-5">
        <p className="text-sm text-verdigris-200/55">Loading cartons…</p>
      </Card>
    );
  }

  const t = o.totals;
  const generate = async () => {
    setBusy(true);
    const r = await api<{ made: number; overview: CartonOverview }>(`/inward-requests/${requestId}/cartons/generate`, {});
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    setO(r.data.overview);
    toast.success(r.data.made ? `${fmt(r.data.made)} carton numbers made.` : "Every carton already has a number.");
  };

  const addPhoto = async (h: Hold, file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    const problem = await sendHoldPhoto(requestId, h.id, file);
    setBusy(false);
    if (problem) return toast.error(problem);
    toast.success(`Photo saved for ${h.cartonNo}.`);
    await load();
  };

  const release = async (h: Hold) => {
    setBusy(true);
    const r = await api<CartonOverview>(`/inward-requests/${requestId}/cartons/${h.id}/release`, {});
    setBusy(false);
    if (!r.ok) return toast.error(r.error.message);
    toast.success(`${h.cartonNo} taken in.`);
    await load();
  };

  const finish = async (confirm: boolean) => {
    setBusy(true);
    const r = await api<unknown>(`/inward-requests/${requestId}/finish`, { body: { confirm } });
    setBusy(false);
    if (!r.ok) {
      if (!confirm && r.error.fields?.missing) {
        setFinishAsk(r.error.message);
        return;
      }
      toast.error(r.error.message);
      return;
    }
    setFinishAsk(null);
    toast.success("Inward completed.");
    onChanged?.();
    await load();
  };

  const tiles: [string, number, string][] = [
    ["Cartons", t.declared, "text-verdigris-50"],
    ["Numbered", t.generated, "text-verdigris-50"],
    ["Printed", t.printed, "text-amber-300"],
    ["Received", t.received, "text-emerald-300"],
    ["Stored", o.storage?.stored ?? 0, "text-emerald-300"],
    ["On hold", t.hold, "text-rose-300"],
    ["Not scanned", t.missing, "text-verdigris-200/70"],
  ];
  const notReady = !o.ready.vehicle || !o.ready.driver;

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-verdigris-50">Cartons and QR stickers</h2>
          <p className="text-xs text-verdigris-200/55">Number every carton, print its sticker, scan it in at the dock.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {o.can.generate && t.generated < t.declared ? (
            <button type="button" id="cartons-generate" disabled={busy || notReady} onClick={generate} className={primary}>
              {t.generated ? `Number the other ${fmt(t.declared - t.generated)}` : "Generate carton numbers"}
            </button>
          ) : null}
          {/* Printing stays open after the inward is completed (a sticker
              for a typed-in carton, or a torn one); scanning does not. */}
          {o.can.print && t.generated > 0 ? (
            <button type="button" id="cartons-print" disabled={busy} onClick={() => setPrinting({})} className={t.printPending && t.generated >= t.declared ? primary : secondary}>
              {t.printPending ? `Print stickers (${fmt(t.printPending)} pending)` : "Print / reprint"}
            </button>
          ) : null}
          {o.can.work && t.generated > 0 ? (
            <Link href={`/admin/inward/${requestId}/scan`} id="cartons-scan" className={`${secondary} text-center`}>
              Open scan station
            </Link>
          ) : null}
          {o.can.finish ? (
            <button type="button" id="cartons-finish" disabled={busy} onClick={() => finish(false)} className={secondary}>
              Finish inward
            </button>
          ) : null}
        </div>
      </div>

      {notReady && o.can.generate ? (
        <p className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-verdigris-100">
          The vehicle and driver are printed in every QR — add {!o.ready.vehicle && !o.ready.driver ? "them" : !o.ready.vehicle ? "the vehicle" : "the driver"} to the request first.
        </p>
      ) : null}

      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map(([k, v, c]) => (
          <div key={k} className="rounded-xl border border-verdigris-300/10 bg-ink-900/40 px-3 py-2">
            <p className="text-[11px] text-verdigris-200/55">{k}</p>
            <p className={`font-mono text-lg font-semibold ${c}`}>{fmt(v)}</p>
          </div>
        ))}
      </div>
      {t.labelPending ? (
        <p className="mb-3 text-xs text-amber-300">
          {fmt(t.labelPending)} received by typed number still need a sticker — print “Label pending”, paste
          {o.can.work ? " and scan." : " it on the carton; it is scanned when the carton is stored."}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-[0.08em] text-verdigris-300">
            <tr>
              <th className="pb-2 pr-3">Item</th>
              <th className="pb-2 pr-3 text-right">Ctns</th>
              <th className="pb-2 pr-3">Carton numbers</th>
              <th className="pb-2 pr-3">Progress</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-verdigris-300/10">
            {o.lines.map((l) => {
              const done = l.generated > 0 && l.received + l.hold >= l.generated;
              return (
                <tr key={l.lineId}>
                  <td className="py-2 pr-3 text-verdigris-50">
                    {l.itemCode ? <span className="font-mono text-verdigris-200/60">{l.itemCode} · </span> : null}
                    {l.description}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-verdigris-100">{fmt(l.cartonQty)}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-verdigris-100">
                    {l.from ? `${l.from} → ${l.to!.slice(-4)}` : <span className="text-verdigris-200/40">not numbered</span>}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        done
                          ? "bg-emerald-400/15 text-emerald-300"
                          : l.received
                            ? "bg-verdigris-300/20 text-verdigris-100"
                            : l.printed
                              ? "bg-amber-400/15 text-amber-300"
                              : "bg-verdigris-300/10 text-verdigris-200/60"
                      }`}
                    >
                      {done
                        ? `${l.received}/${l.generated} in${l.hold ? ` · ${l.hold} hold` : ""}`
                        : l.received
                          ? `${l.received}/${l.generated} in`
                          : l.printed
                            ? `${l.printed}/${l.generated} printed`
                            : l.generated
                              ? "Print pending"
                              : "—"}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    {o.can.print && l.generated ? (
                      <button type="button" onClick={() => setPrinting({ lineId: l.lineId })} className="text-xs text-patina hover:underline">
                        Print
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {o.storage && (o.storage.stored > 0 || t.received > 0) ? (
        <div className="mt-5" id="cartons-where">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-verdigris-300">Where the cartons are</p>
          <ul className="space-y-1 text-sm">
            {o.storage.places.map((p) => (
              <li key={p.galaCode} className="flex flex-wrap gap-x-3">
                <span className="font-mono text-verdigris-50">{p.galaCode}</span>
                <span className="text-verdigris-200/60">{p.floor}</span>
                <span className="text-verdigris-100">{fmt(p.cartons)} cartons</span>
                <span className="font-mono text-xs text-verdigris-200/55">
                  {p.from === p.to ? p.from : `${p.from} → ${p.to.slice(-4)}`}
                </span>
              </li>
            ))}
            {t.received - o.storage.stored > 0 ? (
              <li className="text-amber-300">
                {fmt(t.received - o.storage.stored)} received, not in a gala yet ·{" "}
                <Link href="/admin/storage" className="underline hover:text-patina">
                  Store cartons
                </Link>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {holds.length ? (
        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-rose-300">On hold</p>
          <ul className="divide-y divide-verdigris-300/10 rounded-xl border border-rose-400/20">
            {holds.map((h) => (
              <li key={h.id} className="flex items-center gap-3 p-3 text-sm">
                {h.photoUrl ? (
                  <a href={h.photoUrl} target="_blank" rel="noreferrer" title="Open the photo" className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={h.photoUrl} alt={`Photo of ${h.cartonNo}`} className="h-14 w-14 rounded-md object-cover" loading="lazy" decoding="async" />
                  </a>
                ) : o.can.work ? (
                  <label
                    className="flex h-14 w-14 shrink-0 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-verdigris-300/30 text-[0.65rem] leading-tight text-verdigris-200/70 hover:border-patina hover:text-patina"
                    title="Add a photo of the damage"
                  >
                    <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={busy} onChange={(e) => void addPhoto(h, e.target.files?.[0])} data-hold-photo={h.cartonNo} />
                    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
                    Add photo
                  </label>
                ) : (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-verdigris-300/10 text-[0.65rem] text-verdigris-200/40">No photo</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-verdigris-50">{h.cartonNo}</p>
                  <p className="text-xs text-verdigris-200/60">
                    {h.reason}
                    {h.note ? ` — ${h.note}` : ""} · {[h.itemCode, h.description].filter(Boolean).join(" · ")}
                    {h.by ? ` · ${h.by}` : ""}
                  </p>
                </div>
                {o.can.work ? (
                  <button type="button" disabled={busy} onClick={() => release(h)} className="text-xs text-patina hover:underline">
                    Take in
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {o.recent.length ? (
        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-verdigris-300">Last scans</p>
          <ul className="space-y-1 text-xs">
            {o.recent.slice(0, 8).map((s) => (
              <li key={s.id} className="flex flex-wrap gap-x-2 text-verdigris-200/70">
                <span className={s.result === "RECEIVED" || s.result === "RELEASED" ? "text-emerald-300" : s.result === "HOLD" ? "text-amber-300" : "text-rose-300"}>
                  {s.result.replace("_", " ").toLowerCase()}
                </span>
                <span className="font-mono text-verdigris-100">{s.cartonNo ?? s.code}</span>
                {s.note ? <span>{s.note}</span> : null}
                <span>· {s.by ?? "—"} · {fmtTime(s.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {printing ? (
        <PrintDialog
          requestId={requestId}
          requestCode={o.request.code}
          lines={o.lines}
          initialLine={printing.lineId}
          onClose={() => setPrinting(null)}
          onPrinted={(next) => setO(next)}
        />
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
    </Card>
  );
}

// ── Print dialog ──────────────────────────────────────────────────

/** "INR-000014-0161" → "0161" (the item's numbers, short). */
const tail = (no: string | null) => (no ? no.slice(no.lastIndexOf("-") + 1) : "—");

type What = "pending" | "all" | "line" | "range" | "label_pending" | "one";

function PrintDialog({
  requestId,
  requestCode,
  lines,
  initialLine,
  onClose,
  onPrinted,
}: {
  requestId: number;
  requestCode: string;
  lines: CartonOverview["lines"];
  initialLine?: number;
  onClose: () => void;
  onPrinted: (o: CartonOverview) => void;
}) {
  const toast = useToast();
  const [labels, setLabels] = useState<CartonLabel[] | null>(null);
  const [what, setWhat] = useState<What>(initialLine ? "line" : "pending");
  const [lineId, setLineId] = useState<number | null>(initialLine ?? lines.find((l) => l.generated)?.lineId ?? null);
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState("");
  const [one, setOne] = useState("");
  // One item: its own carton numbers, all of them or a part (e.g. reprint 0163 to 0165).
  const [lineFrom, setLineFrom] = useState("");
  const [lineTo, setLineTo] = useState("");
  const [size, setSize] = useState<StickerSize>(() => {
    try {
      return (localStorage.getItem("wms.stickerSize") as StickerSize) || "t100x50";
    } catch {
      return "t100x50";
    }
  });
  const [preview, setPreview] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await api<{ total: number; labels: CartonLabel[] }>(`/inward-requests/${requestId}/cartons/labels?filter=all`, { method: "GET" });
      if (!r.ok) {
        toast.error(r.error.message);
        onClose();
        return;
      }
      setLabels(r.data.labels);
      setTo(String(r.data.labels.length));
      if (!initialLine && !r.data.labels.some((l) => l.printCount === 0)) setWhat("all");
    })();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** First carton small, last carton bigger, both inside this inward. */
  const rangeProblem = useMemo(() => {
    if (what !== "range" || !labels) return null;
    const total = labels.length;
    const a = Number(from);
    const b = Number(to);
    if (!from) return { field: "from", text: "Enter the first carton number." };
    if (!to) return { field: "to", text: "Enter the last carton number." };
    if (a < 1) return { field: "from", text: "Cartons start at 1." };
    if (a > total) return { field: "from", text: `This inward has ${fmt(total)} cartons — the first can be at most ${fmt(total)}.` };
    if (b > total) return { field: "to", text: `This inward has ${fmt(total)} cartons — the last can be at most ${fmt(total)}.` };
    if (a > b) return { field: "to", text: `The last carton (${fmt(b)}) must be bigger than the first (${fmt(a)}).` };
    return null;
  }, [what, labels, from, to]);

  /** The chosen item's own cartons, by number. */
  const lineLabels = useMemo(() => (labels ?? []).filter((l) => l.lineId === lineId).sort((a, b) => a.seq - b.seq), [labels, lineId]);
  useEffect(() => {
    setLineFrom(lineLabels[0] ? String(lineLabels[0].seq) : "");
    setLineTo(lineLabels.length ? String(lineLabels[lineLabels.length - 1]!.seq) : "");
  }, [lineLabels]);

  /** Inside one item, the part must stay within its own numbers and run small to big. */
  const lineProblem = useMemo(() => {
    if (what !== "line" || !lineLabels.length) return null;
    const lo = lineLabels[0]!.seq;
    const hi = lineLabels[lineLabels.length - 1]!.seq;
    const a = Number(lineFrom);
    const b = Number(lineTo);
    if (!lineFrom) return { field: "from", text: "Enter the first carton number." };
    if (!lineTo) return { field: "to", text: "Enter the last carton number." };
    if (a < lo || a > hi) return { field: "from", text: `This item's cartons are ${lo} to ${hi}.` };
    if (b < lo || b > hi) return { field: "to", text: `This item's cartons are ${lo} to ${hi}.` };
    if (a > b) return { field: "to", text: `The last carton (${b}) must be bigger than the first (${a}).` };
    return null;
  }, [what, lineLabels, lineFrom, lineTo]);

  const chosen = useMemo(() => {
    if (!labels) return [];
    switch (what) {
      case "pending":
        return labels.filter((l) => l.printCount === 0);
      case "label_pending":
        return labels.filter((l) => l.labelPending);
      case "line": {
        if (lineProblem) return [];
        const a = Number(lineFrom);
        const b = Number(lineTo);
        return lineLabels.filter((l) => l.seq >= a && l.seq <= b);
      }
      case "range": {
        if (rangeProblem) return [];
        const a = Number(from);
        const b = Number(to);
        return labels.filter((l) => l.seq >= a && l.seq <= b);
      }
      case "one": {
        const q = one.trim().toUpperCase();
        if (!q) return [];
        return labels.filter((l) => l.cartonNo === q || l.cartonNo.endsWith(`-${q.padStart(4, "0")}`));
      }
      default:
        return labels;
    }
  }, [labels, what, from, to, one, rangeProblem, lineLabels, lineFrom, lineTo, lineProblem]);

  useEffect(() => {
    const first = chosen[0];
    if (!first) return setPreview("");
    void qrSvg(first.qr).then(setPreview);
  }, [chosen]);

  const pickSize = (s: StickerSize) => {
    setSize(s);
    try {
      localStorage.setItem("wms.stickerSize", s);
    } catch {
      /* private window: just not remembered */
    }
  };

  const print = async (test: boolean) => {
    if (!chosen.length) return;
    const batch = test ? chosen.slice(0, 1) : chosen;
    setBusy(true);
    try {
      await printStickers(batch, size, `${requestCode} stickers`);
      if (!test) {
        const r = await api<CartonOverview>(`/inward-requests/${requestId}/cartons/printed`, { body: { ids: batch.map((l) => l.id) } });
        if (r.ok) {
          onPrinted(r.data);
          toast.success(`${fmt(batch.length)} sticker${batch.length === 1 ? "" : "s"} sent to the printer.`);
          onClose();
        } else toast.error(r.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const first = chosen[0];
  const pending = labels?.filter((l) => l.printCount === 0).length ?? 0;
  const labelPending = labels?.filter((l) => l.labelPending).length ?? 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 text-left">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink-900/70" />
      <div role="dialog" aria-modal="true" aria-label="Print stickers" className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-verdigris-300/10 bg-ink-850 p-6 card-shadow">
        <h2 className="text-lg font-semibold text-verdigris-50">Print carton stickers</h2>
        {!labels ? (
          <p className="mt-4 text-sm text-verdigris-200/60">Getting the cartons…</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-verdigris-300">What to print</p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className={chip(what === "pending")} onClick={() => setWhat("pending")}>Not printed yet ({pending})</button>
                  <button type="button" className={chip(what === "all")} onClick={() => setWhat("all")}>All {labels.length}</button>
                  <button type="button" className={chip(what === "line")} onClick={() => setWhat("line")}>One item</button>
                  <button type="button" className={chip(what === "range")} onClick={() => setWhat("range")}>Range</button>
                  <button type="button" className={chip(what === "one")} onClick={() => setWhat("one")}>Reprint one</button>
                  {labelPending ? (
                    <button type="button" className={chip(what === "label_pending")} onClick={() => setWhat("label_pending")}>Label pending ({labelPending})</button>
                  ) : null}
                </div>
                {what === "line" ? (
                  <div className="mt-2">
                    <select
                      id="print-line"
                      value={lineId ?? ""}
                      onChange={(e) => setLineId(Number(e.target.value))}
                      className="w-full rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50"
                    >
                      {lines.filter((l) => l.generated).map((l) => (
                        <option key={l.lineId} value={l.lineId}>
                          {tail(l.from)} → {tail(l.to)} · {[l.itemCode, l.description].filter(Boolean).join(" · ")} ({l.generated})
                        </option>
                      ))}
                    </select>
                    <div className="mt-2 flex items-center gap-2 text-sm text-verdigris-200/70">
                      Carton
                      <input
                        id="print-line-from"
                        aria-label="First carton of this item"
                        aria-invalid={lineProblem?.field === "from"}
                        value={lineFrom}
                        onChange={(e) => setLineFrom(e.target.value.replace(/\D/g, ""))}
                        inputMode="numeric"
                        className={`w-20 rounded-lg border bg-ink-900/60 px-2 py-1.5 text-verdigris-50 ${lineProblem?.field === "from" ? "border-rose-400/70" : "border-verdigris-300/15"}`}
                      />
                      to
                      <input
                        id="print-line-to"
                        aria-label="Last carton of this item"
                        aria-invalid={lineProblem?.field === "to"}
                        value={lineTo}
                        onChange={(e) => setLineTo(e.target.value.replace(/\D/g, ""))}
                        inputMode="numeric"
                        className={`w-20 rounded-lg border bg-ink-900/60 px-2 py-1.5 text-verdigris-50 ${lineProblem?.field === "to" ? "border-rose-400/70" : "border-verdigris-300/15"}`}
                      />
                    </div>
                    {lineProblem ? (
                      <p role="alert" id="print-line-error" className="mt-1 text-xs text-rose-300">{lineProblem.text}</p>
                    ) : chosen.length ? (
                      <p className="mt-1 text-xs text-verdigris-100" id="print-line-count">
                        Prints {fmt(chosen.length)} sticker{chosen.length === 1 ? "" : "s"}: <span className="font-mono">{chosen[0]!.cartonNo}</span>
                        {chosen.length > 1 ? <> to <span className="font-mono">{chosen[chosen.length - 1]!.cartonNo}</span></> : null}
                        {chosen.length === lineLabels.length ? " — all of this item" : ` — ${fmt(chosen.length)} of this item's ${fmt(lineLabels.length)}`}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {what === "range" ? (
                  <div className="mt-2">
                    <div className="flex items-center gap-2 text-sm text-verdigris-200/70">
                      Carton
                      <input
                        id="print-from"
                        aria-label="First carton"
                        aria-invalid={rangeProblem?.field === "from"}
                        value={from}
                        onChange={(e) => setFrom(e.target.value.replace(/\D/g, ""))}
                        inputMode="numeric"
                        placeholder="1"
                        className={`w-20 rounded-lg border bg-ink-900/60 px-2 py-1.5 text-verdigris-50 ${rangeProblem?.field === "from" ? "border-rose-400/70" : "border-verdigris-300/15"}`}
                      />
                      to
                      <input
                        id="print-to"
                        aria-label="Last carton"
                        aria-invalid={rangeProblem?.field === "to"}
                        value={to}
                        onChange={(e) => setTo(e.target.value.replace(/\D/g, ""))}
                        inputMode="numeric"
                        placeholder={labels ? String(labels.length) : ""}
                        className={`w-20 rounded-lg border bg-ink-900/60 px-2 py-1.5 text-verdigris-50 ${rangeProblem?.field === "to" ? "border-rose-400/70" : "border-verdigris-300/15"}`}
                      />
                    </div>
                    {rangeProblem ? (
                      <p role="alert" id="print-range-error" className="mt-1 text-xs text-rose-300">{rangeProblem.text}</p>
                    ) : (
                      <p className="mt-1 text-[11px] text-verdigris-200/50" id="print-range-count">
                        {fmt(chosen.length)} sticker{chosen.length === 1 ? "" : "s"} · carton {from} to {to}
                      </p>
                    )}
                  </div>
                ) : null}
                {what === "one" ? (
                  <input
                    autoFocus
                    value={one}
                    onChange={(e) => setOne(e.target.value)}
                    placeholder={`${requestCode}-0042 or just 42`}
                    className="mt-2 w-full rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 font-mono text-sm text-verdigris-50"
                  />
                ) : null}
                {what === "one" ? <p className="mt-1 text-[11px] text-verdigris-200/50">Same number again — a damaged sticker is never given a new number.</p> : null}
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-verdigris-300">Sticker size</p>
                <div className="space-y-1.5">
                  {STICKER_SIZES.map((s) => (
                    <label key={s.id} className="flex cursor-pointer items-center gap-2 text-sm text-verdigris-100">
                      <input type="radio" name="size" checked={size === s.id} onChange={() => pickSize(s.id)} />
                      {s.label} <span className="text-xs text-verdigris-200/45">{s.hint}</span>
                    </label>
                  ))}
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-verdigris-200/50">
                Opens your computer&apos;s print window, so any installed printer works — or choose “Save as PDF” and print elsewhere.
                In that window pick the sticker paper size, set margins to None, and switch off “Headers and footers”.
              </p>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-verdigris-300">Preview</p>
              {first ? (
                <StickerPreview label={first} qr={preview} size={size} />
              ) : (
                <p className="rounded-lg border border-dashed border-verdigris-300/20 p-6 text-center text-sm text-verdigris-200/50">{rangeProblem || lineProblem ? "Fix the carton range first." : "Nothing matches."}</p>
              )}
              {first ? (
                <details className="mt-2 text-[11px] text-verdigris-200/55">
                  <summary className="cursor-pointer">What the QR says</summary>
                  <pre className="mt-1 whitespace-pre-wrap font-mono">{first.qr}</pre>
                </details>
              ) : null}
            </div>
          </div>
        )}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            id="print-marker"
            disabled={!labels || busy || !chosen.length}
            onClick={() => labels && printMarkerList(chosen, requestCode)}
            className={`${secondary} inline-flex items-center gap-2`}
            title="Printer not working? Print the carton numbers on A4 paper to write on the cartons with a marker."
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
            </svg>
            Printer down? Print number list
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={secondary}>Cancel</button>
            <button type="button" disabled={busy || !chosen.length} onClick={() => print(true)} className={secondary}>Test print 1</button>
            <button type="button" id="print-go" disabled={busy || !chosen.length} onClick={() => print(false)} className={primary}>
              {busy ? "Preparing…" : `Print ${fmt(chosen.length)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The first chosen sticker, drawn by the print template itself at the
 * picked size — a wide 100 × 50 strip, a taller 100 × 75 label, or the
 * small 99 × 38 A4 sticker — scaled down only if the column is narrower.
 */
function StickerPreview({ label, qr, size }: { label: CartonLabel; qr: string; size: StickerSize }) {
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(([e]) => setRoom(e.contentRect.width));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const mm = STICKER_MM[size];
  const PX = 96 / 25.4; // CSS pixels per millimetre
  const w = mm.w * PX;
  const h = mm.h * PX;
  const scale = room ? Math.min(1, room / w) : 1;
  const doc = useMemo(() => (qr ? stickerPreviewDoc(label, qr, size) : ""), [label, qr, size]);
  return (
    <div ref={box} id="sticker-preview" data-size={size} className="w-full min-w-0">
      <div
        className="overflow-hidden rounded-sm bg-white shadow-lg ring-1 ring-black/40 transition-[height] duration-150"
        style={{ width: w * scale, height: h * scale }}
      >
        {doc ? (
          <iframe
            title={`Sticker preview, ${mm.note}`}
            srcDoc={doc}
            sandbox="allow-same-origin"
            tabIndex={-1}
            onLoad={(e) => {
              const d = e.currentTarget.contentDocument;
              if (d) void fitNumbers(d);
            }}
            style={{ width: w, height: h, border: 0, transform: `scale(${scale})`, transformOrigin: "0 0", pointerEvents: "none", background: "#fff" }}
          />
        ) : null}
      </div>
      <p className="mt-1.5 text-[11px] text-verdigris-200/60" id="sticker-preview-size">
        {mm.note}
        {scale < 0.98 ? ` · shown at ${Math.round(scale * 100)}%` : ""}
      </p>
    </div>
  );
}
