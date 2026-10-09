"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api/client";
import type { CartonLabel, CartonOverview } from "@/lib/inward/cartons";
import { useToast } from "@/components/Toast";
import { Card, ConfirmDialog } from "@/components/admin/ui";

import { printMarkerList, printStickers, qrSvg, STICKER_SIZES, type StickerSize } from "./carton-print";
import { fmtTime } from "@/lib/format/datetime";

import { fmt } from "./InwardTable";

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

export default function CartonsPanel({ requestId, onChanged }: { requestId: number; onChanged?: () => void }) {
  const toast = useToast();
  const [o, setO] = useState<CartonOverview | null>(null);
  const [holds, setHolds] = useState<Hold[]>([]);
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

  useEffect(() => {
    void load();
  }, [load]);

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
          {o.can.work && t.generated > 0 ? (
            <>
              <button type="button" id="cartons-print" disabled={busy} onClick={() => setPrinting({})} className={t.printPending && t.generated >= t.declared ? primary : secondary}>
                {t.printPending ? `Print stickers (${fmt(t.printPending)} pending)` : "Print / reprint"}
              </button>
              <Link href={`/admin/inward/${requestId}/scan`} id="cartons-scan" className={`${secondary} text-center`}>
                Open scan station
              </Link>
            </>
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

      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {tiles.map(([k, v, c]) => (
          <div key={k} className="rounded-xl border border-verdigris-300/10 bg-ink-900/40 px-3 py-2">
            <p className="text-[11px] text-verdigris-200/55">{k}</p>
            <p className={`font-mono text-lg font-semibold ${c}`}>{fmt(v)}</p>
          </div>
        ))}
      </div>
      {t.labelPending ? (
        <p className="mb-3 text-xs text-amber-300">
          {fmt(t.labelPending)} received by typed number still need a sticker — print “Label pending”, paste and scan.
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
                    {o.can.work && l.generated ? (
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

      {holds.length ? (
        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-rose-300">On hold</p>
          <ul className="divide-y divide-verdigris-300/10 rounded-xl border border-rose-400/20">
            {holds.map((h) => (
              <li key={h.id} className="flex items-center gap-3 p-3 text-sm">
                {h.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a href={h.photoUrl} target="_blank" rel="noreferrer"><img src={h.photoUrl} alt="" className="h-10 w-10 rounded-md object-cover" /></a>
                ) : null}
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

  const chosen = useMemo(() => {
    if (!labels) return [];
    switch (what) {
      case "pending":
        return labels.filter((l) => l.printCount === 0);
      case "label_pending":
        return labels.filter((l) => l.labelPending);
      case "line":
        return labels.filter((l) => l.lineId === lineId);
      case "range": {
        const a = Number(from) || 1;
        const b = Number(to) || a;
        return labels.filter((l) => l.seq >= Math.min(a, b) && l.seq <= Math.max(a, b));
      }
      case "one": {
        const q = one.trim().toUpperCase();
        if (!q) return [];
        return labels.filter((l) => l.cartonNo === q || l.cartonNo.endsWith(`-${q.padStart(4, "0")}`));
      }
      default:
        return labels;
    }
  }, [labels, what, lineId, from, to, one]);

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
          <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
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
                  <select value={lineId ?? ""} onChange={(e) => setLineId(Number(e.target.value))} className="mt-2 w-full rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50">
                    {lines.filter((l) => l.generated).map((l) => (
                      <option key={l.lineId} value={l.lineId}>
                        {[l.itemCode, l.description].filter(Boolean).join(" · ")} — {l.generated} cartons
                      </option>
                    ))}
                  </select>
                ) : null}
                {what === "range" ? (
                  <div className="mt-2 flex items-center gap-2 text-sm text-verdigris-200/70">
                    Carton
                    <input value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="w-20 rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-2 py-1.5 text-verdigris-50" />
                    to
                    <input value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="w-20 rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-2 py-1.5 text-verdigris-50" />
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
              </p>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-verdigris-300">Preview</p>
              {first ? (
                <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] items-center gap-3 rounded-md border-2 border-black bg-white p-3 text-black">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      {first.importerLogoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={first.importerLogoUrl} alt="" className="h-9 w-9 object-contain" />
                      ) : null}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold uppercase">{first.importerName}</p>
                        {first.importerMobile ? <p className="text-[11px]">+91 {first.importerMobile}</p> : null}
                      </div>
                    </div>
                    <p className="font-mono text-base font-bold">{first.cartonNo}</p>
                    <p className="line-clamp-2 text-[11px]">{[first.itemCode, first.description].filter(Boolean).join(" · ")}</p>
                    <p className="text-[11px]">
                      <b>{first.piecesPerCarton} {first.unitCode ?? "PCS"}</b> / carton · <b>{first.kgPerCarton} kg</b>
                    </p>
                    <p className="text-[10px] text-neutral-600">Carton {first.seq} of {first.total}</p>
                  </div>
                  <div className="h-[7.5rem] w-[7.5rem] [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: preview }} />
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-verdigris-300/20 p-6 text-center text-sm text-verdigris-200/50">Nothing matches.</p>
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
            disabled={!labels || busy || !chosen.length}
            onClick={() => labels && printMarkerList(chosen, requestCode)}
            className="text-xs text-verdigris-200/60 hover:text-patina"
            title="Printer not working? Print the numbers on A4 to write on the cartons."
          >
            Printer down? Print a marker list
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
