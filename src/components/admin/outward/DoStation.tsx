"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/components/Toast";
import { Card, ConfirmDialog } from "@/components/admin/ui";
import { api } from "@/lib/api/client";
import { fmtDateTime, fmtTime } from "@/lib/format/datetime";
import type { DoDetail, DoLr, LoadAnswer } from "@/lib/outward/ops";

import { beep, keepScanFocus, shrinkPhoto, uid } from "../scan-kit";
import { printDispatchOrder } from "./do-print";
import { DoPill } from "./OutwardBoard";
import TransportFields, { type TransportValue } from "./TransportFields";

type Seen = { code: string; result: string; message: string; at: number };
type Dialog = null | "depart" | "hold" | "cancel" | "reopen" | { reject: DoLr };

const n = (v: number) => v.toLocaleString("en-IN");
const btn = "rounded-xl border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45 disabled:opacity-40";
const primary = "rounded-xl bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 hover:bg-patina disabled:opacity-50";
const label = "text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300";
const EVENT: Record<string, string> = {
  CREATED: "Made",
  TRANSPORT: "Transport details",
  ON_HOLD: "On hold",
  RESUMED: "Resumed",
  LOADING: "Loading",
  LOADED: "Loading complete",
  DISPATCHED: "Left the warehouse",
  CANCELLED: "Cancelled",
  PACKAGE_REMOVED: "Package taken off",
  LR_COLLECTED: "LR collected",
  LR_SUBMITTED: "LR handed to the manager",
  LR_UPLOADED: "LR attached",
  LR_VERIFIED: "LR verified",
  LR_REJECTED: "LR rejected",
};
const LR_TONE: Record<string, string> = {
  UPLOADED: "border-sky-400/40 text-sky-100",
  VERIFIED: "border-emerald-400/40 text-emerald-100",
  REJECTED: "border-rose-400/50 text-rose-100",
  REPLACED: "border-verdigris-300/20 text-verdigris-200/50",
};
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * One Dispatch Order: what goes, on which vehicle, checked against the note;
 * the loading scan; departure; the Lorry Receipt. The buttons shown are the
 * ones this person may use at this step — nothing else.
 */
export default function DoStation({ initial }: { initial: DoDetail }) {
  const toast = useToast();
  const [o, setO] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(initial.status === "PENDING_VERIFICATION" && initial.can.edit);
  const [t, setT] = useState<TransportValue>(() => toValue(initial));
  const [tErr, setTErr] = useState<Record<string, string>>({});
  // Loading scan
  const [value, setValue] = useState("");
  const [last, setLast] = useState<Seen | null>(null);
  const [log, setLog] = useState<Seen[]>([]);
  const queue = useRef<{ code: string; clientScanId: string; via: "SCAN" | "MANUAL" }[]>([]);
  const sending = useRef(false);
  const box = useRef<HTMLInputElement>(null);
  const buffer = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstKeyAt = useRef<number | null>(null);
  const keys = useRef(0);
  // LR form
  const [lrNo, setLrNo] = useState("");
  const [lrDate, setLrDate] = useState(today());
  const [lrFile, setLrFile] = useState<File | null>(null);
  const [replaces, setReplaces] = useState<DoLr | null>(null);
  const [lrErr, setLrErr] = useState<Record<string, string>>({});

  const scanning = o.can.load;
  useEffect(() => (scanning ? keepScanFocus(box, () => dialog !== null || editing) : undefined), [scanning, dialog, editing]);

  const reload = useCallback(async () => {
    const r = await api<{ order: DoDetail }>(`/outward/${initial.id}`, { method: "GET" });
    if (r.ok) setO(r.data.order);
  }, [initial.id]);

  useEffect(() => {
    const timerId = setInterval(() => {
      if (!sending.current && dialog === null && !editing) void reload();
    }, 20_000);
    return () => clearInterval(timerId);
  }, [reload, dialog, editing]);

  const act = async (action: string, extra: Record<string, unknown> = {}, done?: string) => {
    setBusy(true);
    const r = await api<{ order: DoDetail }>(`/outward/${o.id}/action`, { body: { action, ...extra } });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error.message);
      return false;
    }
    setO(r.data.order);
    if (done) toast.success(done);
    return true;
  };

  // ── Loading scan ────────────────────────────────────────────────
  const show = useCallback((s: Seen) => {
    setLast(s);
    setLog((l) => [s, ...l].slice(0, 60));
    beep(s.result === "OK");
  }, []);

  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      while (queue.current.length) {
        const p = queue.current[0]!;
        const r = await api<{ scan: LoadAnswer }>(`/outward/${initial.id}/scan`, { body: { ...p, device: "Web loading" } });
        if (!r.ok && r.error.code === "NETWORK") {
          setLast({ code: p.code, result: "ERROR", message: "No connection — retrying…", at: Date.now() });
          await new Promise((res) => setTimeout(res, 3000));
          continue;
        }
        queue.current.shift();
        if (!r.ok) show({ code: p.code, result: "ERROR", message: r.error.message, at: Date.now() });
        else show({ code: p.code, result: r.data.scan.result, message: r.data.scan.message, at: Date.now() });
      }
    } finally {
      sending.current = false;
    }
    await reload();
  }, [initial.id, reload, show]);

  const handle = (raw: string, via: "SCAN" | "MANUAL") => {
    const code = raw.trim();
    if (!code) return;
    queue.current.push({ code, clientScanId: uid(), via });
    void flush();
  };
  const submitBuffer = () => {
    const code = buffer.current.trim();
    buffer.current = "";
    const started = firstKeyAt.current;
    const k = keys.current;
    firstKeyAt.current = null;
    keys.current = 0;
    if (!code) return;
    handle(code, started && k && (Date.now() - started) / k < 40 && k >= 8 ? "SCAN" : "MANUAL");
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (firstKeyAt.current === null) firstKeyAt.current = Date.now();
    keys.current += 1;
    if (e.key !== "Enter") {
      if (buffer.current && timer.current) {
        clearTimeout(timer.current);
        timer.current = setTimeout(submitBuffer, 160);
      }
      return;
    }
    e.preventDefault();
    buffer.current += `${value}\n`;
    setValue("");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(submitBuffer, 160);
  };

  // ── Transport ───────────────────────────────────────────────────
  const saveTransport = async () => {
    setBusy(true);
    const r = await api<{ order: DoDetail }>(`/outward/${o.id}`, {
      method: "PATCH",
      body: {
        transporterId: t.transporterId,
        transportName: t.transportName || null,
        transporterMobile: t.transporterMobile || null,
        transporterGstin: t.transporterGstin || null,
        vehicleId: t.vehicleId,
        vehicleNo: t.vehicleNo || null,
        vehicleType: t.vehicleType || null,
        driverId: t.driverId,
        driverName: t.driverName || null,
        driverMobile: t.driverMobile || null,
        transportMode: t.transportMode,
        remarks: t.remarks || null,
      },
    });
    setBusy(false);
    if (!r.ok) {
      if (r.error.fields) setTErr(r.error.fields);
      return toast.error(r.error.message);
    }
    setO(r.data.order);
    setT(toValue(r.data.order));
    setTErr({});
    setEditing(false);
    toast.success(r.data.order.status === "READY_FOR_OUTWARD" ? "Saved — ready to load." : "Saved.");
  };

  // ── LR ──────────────────────────────────────────────────────────
  const uploadLr = async () => {
    const f: Record<string, string> = {};
    if (!lrNo.trim()) f.lrNo = "Enter the LR number";
    if (!lrDate) f.lrDate = "Enter the LR date";
    if (!lrFile) f.file = "Choose the LR photo or PDF";
    if (Object.keys(f).length) return setLrErr(f);
    setBusy(true);
    const body = lrFile!.type === "application/pdf" ? lrFile! : await shrinkPhoto(lrFile!, 2400);
    const qs = new URLSearchParams({ lrNo: lrNo.trim(), lrDate, fileName: lrFile!.name });
    if (replaces) qs.set("replacesId", String(replaces.id));
    let r: Response | null = null;
    try {
      r = await fetch(`/api/v1/outward/${o.id}/lr?${qs.toString()}`, { method: "POST", body, headers: { "content-type": body.type || "application/octet-stream" }, credentials: "same-origin" });
    } catch {
      r = null;
    }
    setBusy(false);
    const j = r ? ((await r.json().catch(() => ({}))) as { order?: DoDetail; error?: { message?: string; fields?: Record<string, string> } }) : {};
    if (!r || !r.ok || !j.order) {
      if (j.error?.fields) setLrErr(j.error.fields);
      return toast.error(j.error?.message ?? "Could not reach the server. Check your connection.");
    }
    setO(j.order);
    setLrNo("");
    setLrFile(null);
    setReplaces(null);
    setLrErr({});
    toast.success("LR attached — the managers, the agent and the importer are told.");
  };

  const checkLr = async (lr: DoLr, ok: boolean, why?: string) => {
    setBusy(true);
    const r = await api<{ order: DoDetail }>(`/outward/${o.id}/lr/check`, { body: { lrId: lr.id, ok, reason: why ?? null } });
    setBusy(false);
    if (!r.ok) return toast.error(r.error.message);
    setO(r.data.order);
    setDialog(null);
    setReason("");
    toast.success(ok ? `LR ${lr.lrNo} verified.` : `LR ${lr.lrNo} rejected — the uploader is told.`);
  };

  const pct = o.packages ? Math.round((o.loaded / o.packages) * 100) : 0;
  const allLoaded = o.packages > 0 && o.loaded === o.packages;
  const checksOk = o.checks.every((c) => c.ok);

  return (
    <div className="space-y-5">
      {/* Header: number, status, the buttons for this step */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4" id="do-head">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-2xl font-semibold text-verdigris-50" id="do-no">{o.doNo}</h1>
              <span id="do-status"><DoPill status={o.status} label={o.statusLabel} /></span>
              {o.status === "DISPATCHED" ? <span className="rounded-full border border-verdigris-300/20 px-2.5 py-0.5 text-[0.75rem] text-verdigris-100" id="do-lr-status">{o.lrLabel}</span> : null}
            </div>
            <p className="mt-1 text-sm text-verdigris-100">
              {o.buyerName}{o.destination ? ` · ${o.destination}` : ""}
            </p>
            <p className="text-xs text-verdigris-200/60">
              <Link href={`/admin/delivery-notes/${o.noteId}`} className="font-mono hover:text-patina">{o.dnNo}</Link> · order {o.orderNo} · {o.importerName} · {o.warehouseName}
              {o.agentName ? ` · agent ${o.agentName}` : ""}
            </p>
            {o.status === "ON_HOLD" && o.holdReason ? <p className="mt-2 rounded-lg border border-rose-400/40 bg-rose-500/10 p-2 text-sm text-rose-100" id="do-hold-reason">On hold: {o.holdReason}</p> : null}
            {o.status === "CANCELLED" ? <p className="mt-2 text-sm text-verdigris-200/70">Cancelled{o.cancelReason ? `: ${o.cancelReason}` : ""}. Its number is kept, never reused.</p> : null}
            {o.dispatchedAt ? <p className="mt-1 text-sm text-emerald-200" id="do-left">Left {fmtDateTime(o.dispatchedAt)}{o.dispatchedBy ? ` · confirmed by ${o.dispatchedBy}` : ""}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {o.status === "LOADING_IN_PROGRESS" && o.can.load ? (
              <button type="button" id="do-loaded" disabled={busy || !allLoaded} onClick={() => void act("LOADED", {}, "Loading complete — confirm when the vehicle leaves.")} className={primary} title={allLoaded ? "" : "Scan every package first"}>
                Loading complete
              </button>
            ) : null}
            {o.can.depart ? (
              <button type="button" id="do-depart" disabled={busy || !checksOk} onClick={() => setDialog("depart")} className={primary}>
                Confirm departure
              </button>
            ) : null}
            {o.status === "LOADED" && o.can.edit !== undefined && o.can.cancel ? (
              <button type="button" id="do-reopen" disabled={busy} onClick={() => setDialog("reopen")} className={btn}>Back to loading</button>
            ) : null}
            {o.can.print ? (
              <button type="button" id="do-print" onClick={() => void printDispatchOrder(o)} className={btn}>Print DO</button>
            ) : null}
            {o.can.hold ? (
              o.status === "ON_HOLD" ? (
                <button type="button" id="do-resume" disabled={busy} onClick={() => void act("RESUME", {}, "Resumed.")} className={btn}>Resume</button>
              ) : (
                <button type="button" id="do-hold" disabled={busy} onClick={() => setDialog("hold")} className={btn}>Hold</button>
              )
            ) : null}
            {o.can.cancel ? (
              <button type="button" id="do-cancel" disabled={busy} onClick={() => setDialog("cancel")} className="rounded-xl border border-rose-400/30 px-4 py-2 text-sm text-rose-200 hover:border-rose-400/60">Cancel DO</button>
            ) : null}
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-5">
          {/* Loading */}
          {["READY_FOR_OUTWARD", "LOADING_IN_PROGRESS", "LOADED", "DISPATCHED", "ON_HOLD", "PENDING_VERIFICATION"].includes(o.status) ? (
            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={label}>{o.status === "DISPATCHED" ? "What left" : "Loading — scan every package onto the vehicle"}</p>
                <p className="font-mono text-sm text-verdigris-50" id="do-progress">
                  {n(o.loaded)} / {n(o.packages)} packages · {n(o.cartons)} cartons
                </p>
              </div>
              <div className="mt-2 h-2 rounded-full bg-ink-900/60">
                <div className={`h-2 rounded-full ${allLoaded ? "bg-emerald-400" : "bg-patina"}`} style={{ width: `${o.status === "DISPATCHED" ? 100 : pct}%` }} />
              </div>
              {scanning ? (
                <div className="mt-4">
                  <input
                    ref={box}
                    id="do-scan"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={onKey}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Scan a package label (PK-000123) or a single carton — or type it and press Enter"
                    className="w-full rounded-xl border-2 border-patina/60 bg-ink-900/60 px-4 py-3 font-mono text-lg text-verdigris-50 placeholder:text-verdigris-200/25 focus:outline-none focus:ring-4 focus:ring-patina/20"
                  />
                  <div
                    id="do-scan-result"
                    aria-live="assertive"
                    className={`mt-3 rounded-2xl border-2 p-4 ${
                      !last ? "border-verdigris-300/15 text-verdigris-200/60" : last.result === "OK" ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-100" : last.result === "DUPLICATE" ? "border-amber-400/50 bg-amber-400/10 text-amber-100" : "border-rose-400/60 bg-rose-500/10 text-rose-100"
                    }`}
                  >
                    {last ? (
                      <>
                        <p className="text-lg font-semibold">{last.result === "OK" ? "✓ " : last.result === "DUPLICATE" ? "! " : "✕ "}{last.message}</p>
                        <p className="font-mono text-xs opacity-75">{last.code.split("\n")[0]}</p>
                      </>
                    ) : (
                      <p>Ready. Scan each package as it goes onto the vehicle — a package counts its cartons once.</p>
                    )}
                  </div>
                  {log.length > 1 ? (
                    <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs" id="do-scan-log">
                      {log.slice(1, 20).map((s, i) => (
                        <li key={`${s.at}-${i}`} className={s.result === "OK" ? "text-emerald-300" : s.result === "DUPLICATE" ? "text-amber-200" : "text-rose-300"}>
                          {s.message?.startsWith(s.code.split("\n")[0]!) ? (
                            s.message
                          ) : (
                            <>
                              <span className="font-mono">{s.code.split("\n")[0]}</span> — {s.message}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <ul className="mt-4 divide-y divide-verdigris-300/10 rounded-xl border border-verdigris-300/10" id="do-packages">
                {o.packageList.map((p) => (
                  <li key={p.id} className="flex items-start gap-3 p-3" id={`do-pkg-${p.code}`}>
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${p.loadedAt || o.status === "DISPATCHED" ? "border-emerald-400 bg-emerald-500/20 text-emerald-200" : "border-verdigris-300/30 text-transparent"}`} aria-label={p.loadedAt ? "Loaded" : "Not loaded"}>✓</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-verdigris-50">
                        <span className="font-mono font-semibold">{p.code}</span>
                        <span className="ml-2 text-xs text-verdigris-200/60">{p.kind === "SINGLE" ? "single carton" : p.kind.toLowerCase()} · {n(p.cartons)} carton{p.cartons === 1 ? "" : "s"}</span>
                      </p>
                      <p className="truncate text-xs text-verdigris-200/55">{p.items}</p>
                      {p.loadedAt ? <p className="text-[0.7rem] text-verdigris-200/45">loaded {fmtTime(p.loadedAt)}{p.loadedBy ? ` · ${p.loadedBy}` : ""}</p> : null}
                    </div>
                    {o.can.edit && !p.loadedAt && o.packageList.length > 1 && o.status !== "LOADED" ? (
                      <button type="button" disabled={busy} onClick={() => void act("REMOVE_PACKAGE", { packageId: p.id }, `${p.code} taken off — it can go on another DO.`)} className="text-xs text-verdigris-300 hover:text-rose-200" data-remove={p.code}>
                        Take off
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {o.noteOtherReady > 0 || o.noteOpen > o.cartons ? (
                <p className="mt-3 text-xs text-amber-200" id="do-rest">
                  The note has more to go{o.noteOtherReady ? `: ${n(o.noteOtherReady)} more verified package${o.noteOtherReady === 1 ? "" : "s"} waiting` : ""}.{" "}
                  {o.noteOtherReady && o.can.edit ? <Link href={`/admin/outward/new?note=${o.noteId}`} className="underline hover:text-patina">Make another dispatch order</Link> : null}
                </p>
              ) : null}
            </Card>
          ) : null}

          {/* Lorry Receipt */}
          {o.status === "DISPATCHED" ? (
            <div className="order-first">{/* once it has left, the LR is the job: first on the page */}<Card className="p-5">
              <div id="do-lr">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={label}>Lorry Receipt</p>
                  <p className={`text-sm ${o.lrStatus === "MISSING" || o.lrStatus === "REJECTED" ? "text-rose-300" : o.lrStatus === "VERIFIED" ? "text-emerald-300" : "text-amber-200"}`}>
                    {o.lrLabel}
                    {o.lrDaysOut !== null ? ` · ${o.lrDaysOut} day${o.lrDaysOut === 1 ? "" : "s"} since it left` : ""}
                  </p>
                </div>
                {o.can.lrCollect && ["PENDING", "MISSING", "COLLECTED", "REJECTED"].includes(o.lrStatus) ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {o.lrStatus !== "COLLECTED" ? (
                      <button type="button" id="do-lr-collected" disabled={busy} onClick={() => void act("COLLECTED", {}, "Marked collected.")} className={btn}>I collected the LR</button>
                    ) : null}
                    <button type="button" id="do-lr-submitted" disabled={busy} onClick={() => void act("SUBMITTED", {}, "Marked handed to the manager.")} className={btn}>Handed to the manager</button>
                  </div>
                ) : null}
                <p className="mt-2 text-xs text-verdigris-200/55">
                  {o.lrCollectedAt ? `Collected ${fmtDateTime(o.lrCollectedAt)}${o.lrCollectedBy ? ` by ${o.lrCollectedBy}` : ""}. ` : ""}
                  {o.lrSubmittedAt ? `Handed over ${fmtDateTime(o.lrSubmittedAt)}${o.lrSubmittedBy ? ` by ${o.lrSubmittedBy}` : ""}.` : ""}
                </p>

                {o.can.lrUpload && o.lrStatus !== "VERIFIED" ? (
                  <div className="mt-4 rounded-xl border border-patina/30 bg-patina/5 p-4" id="do-lr-form">
                    <p className="text-sm font-medium text-verdigris-50">{replaces ? `Replace LR ${replaces.lrNo}` : "Attach the LR"}</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <div>
                        <input id="lr-no" value={lrNo} onChange={(e) => { setLrNo(e.target.value); setLrErr({}); }} placeholder="LR number" className={`w-full rounded-xl border bg-ink-900/60 px-3 py-2.5 font-mono text-sm text-verdigris-50 ${lrErr.lrNo ? "border-rose-500" : "border-verdigris-300/15"}`} />
                        {lrErr.lrNo ? <p className="mt-1 text-xs text-rose-300">{lrErr.lrNo}</p> : null}
                      </div>
                      <div>
                        <input id="lr-date" type="date" value={lrDate} max={today()} onChange={(e) => { setLrDate(e.target.value); setLrErr({}); }} className={`w-full rounded-xl border bg-ink-900/60 px-3 py-2.5 text-sm text-verdigris-50 ${lrErr.lrDate ? "border-rose-500" : "border-verdigris-300/15"}`} />
                        {lrErr.lrDate ? <p className="mt-1 text-xs text-rose-300">{lrErr.lrDate}</p> : null}
                      </div>
                      <div>
                        <label className={`flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-sm text-verdigris-100 ${lrErr.file ? "border-rose-500" : "border-verdigris-300/30"} hover:border-patina`}>
                          <input id="lr-file" type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" onChange={(e) => { setLrFile(e.target.files?.[0] ?? null); setLrErr({}); }} />
                          <span className="truncate">{lrFile ? lrFile.name : "Photo or PDF"}</span>
                        </label>
                        {lrErr.file ? <p className="mt-1 text-xs text-rose-300">{lrErr.file}</p> : null}
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button type="button" id="lr-upload" disabled={busy} onClick={() => void uploadLr()} className={primary}>{busy ? "Sending…" : "Attach LR"}</button>
                      {replaces ? <button type="button" onClick={() => setReplaces(null)} className={btn}>Not a replacement</button> : null}
                    </div>
                  </div>
                ) : null}

                {o.lrs.length ? (
                  <ul className="mt-4 space-y-2" id="do-lrs">
                    {o.lrs.map((lr) => (
                      <li key={lr.id} className={`rounded-xl border p-3 ${LR_TONE[lr.status] ?? "border-verdigris-300/15"}`} id={`lr-${lr.lrNo}`}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm">
                              <b className="font-mono">LR {lr.lrNo}</b> · {lr.lrDate} <span className="ml-1 text-xs opacity-75">{lr.status.toLowerCase()}</span>
                            </p>
                            <p className="text-xs opacity-70">Attached {fmtDateTime(lr.uploadedAt)}{lr.uploadedBy ? ` by ${lr.uploadedBy}` : ""}{lr.checkedAt ? ` · checked by ${lr.checkedBy ?? "?"}` : ""}</p>
                            {lr.duplicateOf ? <p className="text-xs text-amber-200">⚠ {lr.duplicateOf}</p> : null}
                            {lr.rejectReason ? <p className="text-xs text-rose-200">Correction: {lr.rejectReason}</p> : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <a href={lr.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-verdigris-300 underline hover:text-patina">Open {lr.fileType === "application/pdf" ? "PDF" : "photo"}</a>
                            {lr.status === "UPLOADED" && o.can.lrVerify ? (
                              <>
                                <button type="button" disabled={busy} onClick={() => void checkLr(lr, true)} className="rounded-lg bg-emerald-500/80 px-3 py-1 text-xs font-semibold text-ink-900 hover:bg-emerald-400" data-verify={lr.lrNo}>Verify</button>
                                <button type="button" disabled={busy} onClick={() => setDialog({ reject: lr })} className="rounded-lg border border-rose-400/40 px-3 py-1 text-xs text-rose-200" data-reject={lr.lrNo}>Reject</button>
                              </>
                            ) : null}
                            {lr.status === "REJECTED" && o.can.lrUpload ? (
                              <button type="button" onClick={() => { setReplaces(lr); setLrNo(lr.lrNo); }} className="text-xs text-verdigris-300 underline" data-replace={lr.lrNo}>Replace</button>
                            ) : null}
                          </div>
                        </div>
                        {lr.fileType && lr.fileType.startsWith("image/") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <a href={lr.fileUrl} target="_blank" rel="noreferrer"><img src={lr.fileUrl} alt={`LR ${lr.lrNo}`} className="mt-2 max-h-48 rounded-lg object-contain" loading="lazy" /></a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </Card></div>
          ) : null}

          {/* History */}
          <Card className="p-5">
            <p className={label}>History</p>
            <ol className="mt-3 space-y-1.5 text-sm" id="do-events">
              {o.events.map((e, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-32 shrink-0 text-xs text-verdigris-200/50">{fmtDateTime(e.at)}</span>
                  <span className="text-verdigris-100">
                    <b className="font-medium">{EVENT[e.action] ?? e.action}</b>
                    {e.detail ? ` — ${e.detail}` : ""}
                    {e.by ? <span className="text-verdigris-200/55"> · {e.by}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className="space-y-5">
          {/* Checks */}
          <Card className="p-5">
            <p className={label}>Checked against the delivery note</p>
            <ul className="mt-3 space-y-2" id="do-checks">
              {o.checks.map((c) => (
                <li key={c.key} className="flex gap-2 text-sm" data-check={c.key} data-ok={c.ok ? "1" : "0"}>
                  <span className={c.ok ? "text-emerald-300" : c.blocking ? "text-rose-300" : "text-amber-200"}>{c.ok ? "✓" : c.blocking ? "✕" : "!"}</span>
                  <span>
                    <span className="text-verdigris-50">{c.label}</span>
                    <span className="block text-xs text-verdigris-200/60">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          {/* Transport */}
          <Card className="p-5">
            <div className="flex items-center justify-between gap-2">
              <p className={label}>Transport</p>
              {o.can.edit && !editing ? (
                <button type="button" id="do-transport-edit" onClick={() => { setT(toValue(o)); setEditing(true); }} className="text-xs text-verdigris-300 hover:text-patina">Change</button>
              ) : null}
            </div>
            {editing ? (
              <div className="mt-3 space-y-3">
                <TransportFields value={t} onChange={setT} errors={tErr} />
                <div className="flex gap-2">
                  <button type="button" id="do-transport-save" disabled={busy} onClick={() => void saveTransport()} className={primary}>Save</button>
                  <button type="button" onClick={() => setEditing(false)} className={btn}>Cancel</button>
                </div>
              </div>
            ) : (
              <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm" id="do-transport">
                <dt className="text-verdigris-200/55">Transporter</dt><dd className="text-verdigris-50">{o.transportName ?? "—"}{o.transporterMobile ? ` · ${o.transporterMobile}` : ""}</dd>
                <dt className="text-verdigris-200/55">GSTIN</dt><dd className="text-verdigris-50">{o.transporterGstin ?? "—"}</dd>
                <dt className="text-verdigris-200/55">Vehicle</dt><dd className="font-mono text-verdigris-50">{o.vehicleNo ?? "—"} <span className="font-sans text-xs text-verdigris-200/60">{o.vehicleType ?? ""}</span></dd>
                <dt className="text-verdigris-200/55">Driver</dt><dd className="text-verdigris-50">{o.driverName ?? "—"}{o.driverMobile ? ` · ${o.driverMobile}` : ""}</dd>
                <dt className="text-verdigris-200/55">Mode</dt><dd className="text-verdigris-50">{o.transportMode.toLowerCase()}</dd>
                {o.remarks ? (<><dt className="text-verdigris-200/55">Remarks</dt><dd className="text-verdigris-50">{o.remarks}</dd></>) : null}
              </dl>
            )}
          </Card>
        </aside>
      </div>

      {dialog === "depart" ? (
        <ConfirmDialog
          title={`Vehicle ${o.vehicleNo ?? ""} left?`}
          tone="warn"
          busy={busy}
          confirmLabel="Yes, it left"
          message={<>{n(o.packages)} packages ({n(o.cartons)} cartons) leave the warehouse stock now — this cannot be undone. The managers, the agent and the importer are told, and the LR is asked for.</>}
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            if (await act("DEPART", {}, `${o.doNo} dispatched.`)) setDialog(null);
          }}
        />
      ) : null}
      {dialog === "reopen" ? (
        <ConfirmDialog title="Back to loading?" tone="warn" busy={busy} confirmLabel="Back to loading" message="Use it if something must come off or go on again. Nothing has left yet."
          onCancel={() => setDialog(null)} onConfirm={async () => { if (await act("REOPEN", {}, "Back to loading.")) setDialog(null); }} />
      ) : null}
      {dialog === "hold" || dialog === "cancel" ? (
        <ConfirmDialog
          title={dialog === "hold" ? `Hold ${o.doNo}?` : `Cancel ${o.doNo}?`}
          tone={dialog === "hold" ? "warn" : "danger"}
          busy={busy}
          confirmDisabled={!reason.trim()}
          confirmLabel={dialog === "hold" ? "Hold" : "Cancel DO"}
          message={dialog === "hold" ? "Loading stops until it is resumed. Say why." : "Its packages are free for another DO; the number is kept and never reused. Say why."}
          onCancel={() => { setDialog(null); setReason(""); }}
          onConfirm={async () => {
            if (await act(dialog === "hold" ? "HOLD" : "CANCEL", { reason }, dialog === "hold" ? "On hold." : "Cancelled.")) {
              setDialog(null);
              setReason("");
            }
          }}
        >
          <input id="do-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className="mt-3 w-full rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50" />
        </ConfirmDialog>
      ) : null}
      {dialog && typeof dialog === "object" && "reject" in dialog ? (
        <ConfirmDialog
          title={`Reject LR ${dialog.reject.lrNo}?`}
          busy={busy}
          confirmDisabled={!reason.trim()}
          confirmLabel="Reject"
          message="The person who attached it is told what to correct, and attaches it again."
          onCancel={() => { setDialog(null); setReason(""); }}
          onConfirm={() => void checkLr(dialog.reject, false, reason)}
        >
          <input id="lr-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What needs correcting" className="mt-3 w-full rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50" />
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

function toValue(o: DoDetail): TransportValue {
  return {
    transporterId: o.transporterId,
    transportName: o.transportName ?? "",
    transporterMobile: o.transporterMobile ?? "",
    transporterGstin: o.transporterGstin ?? "",
    vehicleId: o.vehicleId,
    vehicleNo: o.vehicleNo ?? "",
    vehicleType: o.vehicleType ?? "",
    driverId: o.driverId,
    driverName: o.driverName ?? "",
    driverMobile: o.driverMobile ?? "",
    transportMode: (o.transportMode as TransportValue["transportMode"]) ?? "ROAD",
    remarks: o.remarks ?? "",
  };
}
