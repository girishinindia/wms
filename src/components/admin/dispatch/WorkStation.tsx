"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useToast } from "@/components/Toast";
import { Card, StatusBadge } from "@/components/admin/ui";
import { api } from "@/lib/api/client";
import type { ScanAnswer, WorkDetail, WorkPackage } from "@/lib/dispatch/ops";
import { fmtDateTime, fmtDay, fmtTime } from "@/lib/format/datetime";

import { beep, keepScanFocus, uid } from "../scan-kit";
import { PACKAGE_LABEL_SIZES, printPackageLabels, printPickList, type PackageLabelSize } from "./package-print";

/**
 * One delivery note in the warehouse. Four scan steps, one box:
 *
 *   Pick    — scan each carton where it lies (gala, dock or put-back shelf)
 *   Arrive  — scan it again at the packing area
 *   Pack    — choose an open package, scan cartons into it, close it
 *   Verify  — scan each package's QR (a single carton: its own sticker)
 *
 * Every scan is checked by the server in one locked step; the box shows
 * green / amber / red and beeps. Works with a USB / Bluetooth scanner or
 * by typing.
 */

type Mode = "PICK" | "ARRIVE" | "PACK" | "VERIFY";
type Pending = { clientScanId: string; code: string; via: "SCAN" | "MANUAL"; mode: Mode; pkg: number | null; remove: boolean };
type Seen = { code: string; mode: Mode; result: ScanAnswer["result"] | "ERROR"; message: string; at: number };

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "PICK", label: "1 · Pick", hint: "Scan each carton where it lies — gala, dock or put-back shelf." },
  { id: "ARRIVE", label: "2 · At packing", hint: "Scan each picked carton as it reaches the packing area." },
  { id: "PACK", label: "3 · Pack", hint: "Choose or open a package, then scan the cartons into it." },
  { id: "VERIFY", label: "4 · Verify", hint: "Scan every package's QR. A single carton: scan its own sticker." },
];

const PK = /\bPK-?(\d{6})\b/i;
const n = (v: number) => v.toLocaleString("en-IN");
const KIND_LABEL: Record<string, string> = { PACKAGE: "Package", BUNDLE: "Bundle", SINGLE: "Single carton" };
const PKG_STATUS: Record<string, string> = { OPEN: "Open", CLOSED: "Closed", VERIFIED: "Verified", CANCELLED: "Cancelled" };
const btn = "rounded-lg border border-verdigris-300/20 px-3 py-1.5 text-xs text-verdigris-100 hover:border-verdigris-300/45 disabled:opacity-50";
const SIZE_KEY = "wms.packageLabelSize";
const field = "w-full rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50";

function firstMode(w: WorkDetail): Mode {
  if (!w.can.pick) return "VERIFY";
  if (w.picked < w.required) return "PICK";
  if (w.arrived < w.picked) return "ARRIVE";
  if (w.packed < w.picked) return "PACK";
  return w.can.verify ? "VERIFY" : "PACK";
}

export default function WorkStation({ initial }: { initial: WorkDetail }) {
  const toast = useToast();
  const [w, setW] = useState(initial);
  const [mode, setMode] = useState<Mode>(() => firstMode(initial));
  const [pkg, setPkg] = useState<number | null>(() => initial.packageList.find((p) => p.status === "OPEN")?.id ?? null);
  const [remove, setRemove] = useState(false);
  const [value, setValue] = useState("");
  const [last, setLast] = useState<Seen | null>(null);
  const [log, setLog] = useState<Seen[]>([]);
  const [pending, setPending] = useState(0);
  const [dialog, setDialog] = useState<null | "assign" | "hold" | { close: WorkPackage } | { cancel: WorkPackage }>(null);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState<PackageLabelSize>("t100x75");
  const [lineQ, setLineQ] = useState("");
  const [todoOnly, setTodoOnly] = useState(false);
  const [pkgShow, setPkgShow] = useState("");
  const [cartonQ, setCartonQ] = useState("");
  const queue = useRef<Pending[]>([]);
  const sending = useRef(false);
  const box = useRef<HTMLInputElement>(null);
  const firstKeyAt = useRef<number | null>(null);
  const keys = useRef(0);
  const buffer = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => keepScanFocus(box, () => dialog !== null), [dialog]);
  const nextRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(SIZE_KEY);
      if (v && PACKAGE_LABEL_SIZES.some((x) => x.id === v)) setSize(v as PackageLabelSize);
    } catch {
      /* not remembered */
    }
  }, []);

  const printLabels = async (list: WorkPackage[]) => {
    if (!list.length) return toast.error("No package to print yet — close a package first.");
    await printPackageLabels(w, list, size);
    // Counted so a reprint is visible later; never blocks the print.
    for (const p of list) void api(`/dispatch/packages/${p.id}`, { method: "PATCH", body: { action: "PRINTED" } });
  };

  const reload = useCallback(async () => {
    const r = await api<{ work: WorkDetail }>(`/dispatch/${initial.id}`, { method: "GET" });
    if (r.ok) setW(r.data.work);
  }, [initial.id]);

  // Others scan the same note: keep the counts fresh.
  useEffect(() => {
    const t = setInterval(() => {
      if (!sending.current && dialog === null) void reload();
    }, 20_000);
    return () => clearInterval(t);
  }, [reload, dialog]);

  const allowed = useMemo(
    () => MODES.filter((m) => (m.id === "VERIFY" ? w.can.verify : m.id === "PACK" ? w.can.pack : w.can.pick)),
    [w.can],
  );
  const openPackages = w.packageList.filter((p) => p.status === "OPEN");
  const active = w.packageList.find((p) => p.id === pkg && p.status === "OPEN") ?? null;

  const show = useCallback((s: Seen) => {
    setLast(s);
    setLog((l) => [s, ...l].slice(0, 100));
    beep(s.result === "OK");
  }, []);

  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      while (queue.current.length) {
        const p = queue.current[0]!;
        const body = { code: p.code, clientScanId: p.clientScanId, via: p.via, device: "Web pick & pack" };
        const r =
          p.mode === "PACK"
            ? await api<{ scan: ScanAnswer }>(`/dispatch/packages/${p.pkg}/scan`, { body: { ...body, remove: p.remove } })
            : await api<{ scan: ScanAnswer }>(`/dispatch/${initial.id}/scan`, { body: { ...body, step: p.mode } });
        if (!r.ok && r.error.code === "NETWORK") {
          setLast({ code: p.code, mode: p.mode, result: "ERROR", message: "No connection — retrying…", at: Date.now() });
          await new Promise((res) => setTimeout(res, 3000));
          continue;
        }
        queue.current.shift();
        setPending(queue.current.length);
        if (!r.ok) show({ code: p.code, mode: p.mode, result: "ERROR", message: r.error.message, at: Date.now() });
        else show({ code: p.code, mode: p.mode, result: r.data.scan.result, message: r.data.scan.message, at: Date.now() });
      }
    } finally {
      sending.current = false;
    }
    await reload();
  }, [initial.id, reload, show]);

  const handle = (raw: string, via: "SCAN" | "MANUAL") => {
    const code = raw.trim();
    if (!code) return;
    if (mode === "PACK") {
      // A package label in pack mode chooses that package.
      const m = PK.exec(code);
      if (m) {
        const hit = w.packageList.find((p) => p.code === `PK-${m[1]}`);
        if (hit && hit.status === "OPEN") {
          setPkg(hit.id);
          show({ code, mode, result: "OK", message: `Packing into ${hit.code}`, at: Date.now() });
        } else {
          show({ code, mode, result: "ERROR", message: hit ? `${hit.code} is ${PKG_STATUS[hit.status]?.toLowerCase()} — reopen it to change it` : "That package is not on this delivery note", at: Date.now() });
        }
        return;
      }
      if (!active) {
        show({ code, mode, result: "ERROR", message: "Open a package first (or scan a package label), then scan the cartons.", at: Date.now() });
        return;
      }
    }
    queue.current.push({ clientScanId: uid(), code, via, mode, pkg: active?.id ?? null, remove });
    setPending(queue.current.length);
    void flush();
  };

  // A scanner reading a QR with several lines types Enter after each one:
  // collect them for a moment and send them as one scan.
  const submitBuffer = () => {
    const code = buffer.current.trim();
    buffer.current = "";
    const started = firstKeyAt.current;
    const k = keys.current;
    firstKeyAt.current = null;
    keys.current = 0;
    if (!code) return;
    const perKey = started && k ? (Date.now() - started) / k : 999;
    handle(code, perKey < 40 && k >= 8 ? "SCAN" : "MANUAL");
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (firstKeyAt.current === null) firstKeyAt.current = Date.now();
    keys.current += 1;
    if (e.key !== "Enter") {
      // More of the same QR still arriving: wait for the end of it.
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

  const act = async (path: string, init: { method?: string; body?: unknown }, done?: string) => {
    setBusy(true);
    const r = await api<{ work: WorkDetail }>(path, init);
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error.message);
      return false;
    }
    setW(r.data.work);
    if (done) toast.success(done);
    return true;
  };

  const newPackage = async (kind: "PACKAGE" | "BUNDLE") => {
    const before = new Set(w.packageList.map((p) => p.id));
    setBusy(true);
    const r = await api<{ work: WorkDetail }>(`/dispatch/${w.id}/packages`, { body: { kind } });
    setBusy(false);
    if (!r.ok) return toast.error(r.error.message);
    setW(r.data.work);
    const made = r.data.work.packageList.find((p) => !before.has(p.id));
    if (made) {
      setPkg(made.id);
      setRemove(false);
      setMode("PACK");
      toast.success(`${made.code} opened — scan cartons into it.`);
    }
  };

  // Shortcuts with Alt (a scanner never sends Alt, so a scan can't set them off):
  // Alt+1…4 step · Alt+N / Alt+B new package / bundle · Alt+W where next · Alt+P pick list · Alt+L labels.
  const altKeys = useRef<(e: KeyboardEvent) => void>(() => {});
  altKeys.current = (e: KeyboardEvent) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || dialog !== null) return;
    const step = { Digit1: "PICK", Digit2: "ARRIVE", Digit3: "PACK", Digit4: "VERIFY" }[e.code] as Mode | undefined;
    if (step && allowed.some((m) => m.id === step)) {
      e.preventDefault();
      setMode(step);
      return;
    }
    if (e.code === "KeyN" && w.can.pack && !w.onHold) {
      e.preventDefault();
      void newPackage("PACKAGE");
    } else if (e.code === "KeyB" && w.can.pack && !w.onHold) {
      e.preventDefault();
      void newPackage("BUNDLE");
    } else if (e.code === "KeyW") {
      e.preventDefault();
      setMode("PICK");
      setTimeout(() => nextRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
    } else if (e.code === "KeyP") {
      e.preventDefault();
      void printPickList(w);
    } else if (e.code === "KeyL") {
      e.preventDefault();
      void printLabels(w.packageList.filter((p) => p.kind !== "SINGLE" && (p.status === "CLOSED" || p.status === "VERIFIED")));
    }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => altKeys.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const tone = !last
    ? "border-verdigris-300/15 bg-ink-900/40 text-verdigris-200/60"
    : last.result === "OK"
      ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200"
      : last.result === "DUPLICATE"
        ? "border-amber-400/60 bg-amber-500/10 text-amber-200"
        : "border-rose-400/60 bg-rose-500/10 text-rose-200";
  const live = w.status === "PENDING" || w.status === "APPROVED";
  const loose = w.cartons.filter((c) => c.area === "PACKING" && !c.packageCode).length;

  return (
    <div className="space-y-5">
      {/* Head */}
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Pick &amp; pack</p>
            <p className="mt-1 flex flex-wrap items-center gap-2">
              <Link href={`/admin/delivery-notes/${w.id}`} className="font-mono text-2xl font-semibold text-verdigris-50 hover:text-patina" id="work-dn">
                {w.dnNo}
              </Link>
              <span id="work-status"><StatusBadge value={w.workStatus} /></span>
              <StatusBadge value={w.status === "PENDING" ? "PENDING_APPROVAL" : w.status} />
              {w.priority === "URGENT" ? <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-xs text-amber-200">Urgent</span> : null}
              {w.handling !== "NORMAL" ? (
                <span className="rounded-full border border-rose-400/50 px-2 py-0.5 text-xs font-semibold text-rose-200">
                  {w.handling === "FRAGILE" ? "Fragile" : "Handle with care"}
                </span>
              ) : null}
            </p>
            <p className="mt-1 text-sm text-verdigris-200/65">
              {fmtDay(w.dnDate)} · Order {w.orderNo} · {w.importerName} · {w.warehouseName}
            </p>
            <p className="mt-1 text-sm text-verdigris-100">
              To <b>{w.buyerName}</b>
              {w.buyerCity ? `, ${w.buyerCity}` : ""}
              {w.transportName ? ` · by ${w.transportName}` : ""}
              {w.packing ? ` · packing: ${w.packing === "OTHER" ? (w.packingOther ?? "other") : w.packing.toLowerCase()}` : ""}
              {w.bundles ? ` (${w.bundles} bundles)` : ""}
            </p>
            <p className="mt-1 text-sm text-verdigris-200/70" id="work-assignees">
              Assigned: {w.assigneeList.length ? w.assigneeList.map((a) => a.name).join(", ") : "nobody yet"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {w.can.assign ? (
              <button type="button" id="work-assign" className={btn} onClick={() => setDialog("assign")}>
                Assign staff
              </button>
            ) : null}
            {w.can.hold ? (
              <button
                type="button"
                id="work-hold"
                className={btn}
                disabled={busy}
                onClick={() => (w.onHold ? void act(`/dispatch/${w.id}/hold`, { body: { on: false } }, "Back in work.") : setDialog("hold"))}
              >
                {w.onHold ? "Resume work" : "Put on hold"}
              </button>
            ) : null}
          </div>
        </div>
        {w.instructions || w.deliveryInstructions ? (
          <p className="mt-3 rounded-lg border border-verdigris-300/15 bg-ink-900/40 p-3 text-sm text-verdigris-100">
            {w.instructions ? <span><b>Packing:</b> {w.instructions} </span> : null}
            {w.deliveryInstructions ? <span><b>Delivery:</b> {w.deliveryInstructions}</span> : null}
          </p>
        ) : null}
        {w.onHold ? (
          <p className="mt-3 rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100" id="work-hold-banner">
            On hold: {w.holdReason}. Scanning is paused until it is resumed.
          </p>
        ) : null}
        {w.status === "PENDING" ? (
          <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/5 p-3 text-sm text-amber-100">
            Not approved by the importer yet. You can pick and pack; it becomes ready for dispatch only after approval.
          </p>
        ) : null}
        {w.workStatus === "READY_FOR_DISPATCH" ? (
          <p className="mt-3 rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm text-emerald-100" id="work-ready">
            Ready for dispatch — {n(w.packages)} package{w.packages === 1 ? "" : "s"}, all verified.
          </p>
        ) : null}
        {!live ? (
          <p className="mt-3 rounded-lg border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-100" id="work-closed">
            This delivery note is {w.status.toLowerCase()}.{" "}
            {w.returning > 0 ? (
              <>
                {n(w.returning)} picked carton{w.returning === 1 ? "" : "s"} must go back into a gala —{" "}
                <Link href="/admin/storage" className="underline">open Store cartons</Link>, scan any gala, then the cartons.
              </>
            ) : (
              "Nothing is left to put back."
            )}
          </p>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" id="work-counts">
          {[
            ["Picked", w.picked, w.required],
            ["At packing", w.arrived, w.picked || w.required],
            ["Packed", w.packed, w.required],
            ["Verified", w.packageList.filter((p) => p.status === "VERIFIED").length, w.packages],
          ].map(([label, a, b]) => (
            <div key={label as string} className="rounded-xl border border-verdigris-300/10 bg-ink-900/40 p-3">
              <p className="text-[0.7rem] uppercase tracking-[0.1em] text-verdigris-300">{label}</p>
              <p className="font-mono text-lg text-verdigris-50">
                {n(a as number)} <span className="text-sm text-verdigris-200/50">/ {n(b as number)}</span>
              </p>
            </div>
          ))}
        </div>
      </Card>

      {/* Scan station */}
      {allowed.length && live ? (
        <Card className="p-5">
          <div className="flex flex-wrap gap-1.5" id="work-modes">
            {allowed.map((m) => (
              <button
                key={m.id}
                type="button"
                id={`work-mode-${m.id.toLowerCase()}`}
                onClick={() => setMode(m.id)}
                className={`rounded-full border px-3.5 py-1.5 text-sm ${
                  mode === m.id ? "border-patina bg-patina/15 text-patina" : "border-verdigris-300/15 text-verdigris-200/70 hover:border-verdigris-300/35"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-sm text-verdigris-200/65">
            {MODES.find((m) => m.id === mode)?.hint}
            <span className="ml-2 text-xs text-verdigris-200/45">Alt+1…4 step · Alt+N package · Alt+B bundle · Alt+W where next</span>
          </p>

          {mode === "PICK" ? (
            w.route.length ? (
              <div ref={nextRef} tabIndex={-1} className="mt-3 rounded-xl border border-patina/40 bg-patina/10 p-3 outline-none" id="work-next-stop">
                <p className="text-sm text-verdigris-50">
                  <span className="mr-2 rounded-md bg-patina/25 px-2 py-0.5 text-xs font-semibold text-patina">
                    Next stop 1 of {w.route.length}
                  </span>
                  {w.route[0]!.floor ? `${w.route[0]!.floor} › ` : ""}
                  <b className="font-mono">{w.route[0]!.place}</b>
                  {w.route[0]!.galaId ? (
                    <Link href={`/admin/locations/galas/${w.route[0]!.galaId}`} className="ml-2 text-xs text-verdigris-300 hover:text-patina">
                      open gala
                    </Link>
                  ) : null}
                </p>
                {w.route[0]!.items.map((it) => (
                  <p key={it.lineId} className="mt-1 text-sm text-verdigris-100">
                    {it.item}: <span className="font-mono text-verdigris-50">{it.cartonNos.join("  ")}</span>
                  </p>
                ))}
                {w.route.length > 1 ? (
                  <p className="mt-1 text-xs text-verdigris-200/65">
                    Then {w.route.slice(1, 4).map((r) => `${r.place} (${r.cartonNos.length})`).join(", ")}
                    {w.route.length > 4 ? " …" : ""}. Scan any right carton — the route adjusts.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-verdigris-200/65">Last stop. Scan any right carton — the route adjusts.</p>
                )}
              </div>
            ) : w.picked >= w.required ? (
              <p className="mt-3 rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm text-emerald-100">Everything is picked.</p>
            ) : (
              <p className="mt-3 rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-100">No free carton of what is left — check with the warehouse admin.</p>
            )
          ) : null}

          {mode === "PACK" ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-verdigris-300/10 bg-ink-900/40 p-3" id="work-pack-bar">
              <span className="text-sm text-verdigris-100">Packing into:</span>
              {openPackages.length ? (
                <select
                  id="work-pkg"
                  value={active?.id ?? ""}
                  onChange={(e) => setPkg(Number(e.target.value) || null)}
                  className="rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-2 py-1.5 text-sm text-verdigris-50"
                >
                  <option value="">Choose…</option>
                  {openPackages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} · {KIND_LABEL[p.kind]} {p.no} · {p.cartons} carton{p.cartons === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-verdigris-200/55">no open package</span>
              )}
              <button type="button" id="work-new-package" className={btn} disabled={busy || w.onHold} onClick={() => void newPackage("PACKAGE")}>
                + New package
              </button>
              <button type="button" id="work-new-bundle" className={btn} disabled={busy || w.onHold} onClick={() => void newPackage("BUNDLE")}>
                + New bundle
              </button>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-verdigris-200/75">
                <input type="checkbox" id="work-remove" checked={remove} onChange={(e) => setRemove(e.target.checked)} />
                Take cartons out
              </label>
            </div>
          ) : null}

          <input
            ref={box}
            id="work-scan"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKey}
            disabled={w.onHold}
            autoComplete="off"
            placeholder={w.onHold ? "On hold" : mode === "VERIFY" ? "Scan a package QR…" : "Scan a carton sticker…"}
            className="mt-3 w-full rounded-xl border border-verdigris-300/20 bg-ink-900/70 px-4 py-3 font-mono text-lg text-verdigris-50 placeholder:text-verdigris-200/35 disabled:opacity-50"
          />
          <div className={`mt-3 rounded-xl border p-4 ${tone}`} id="work-last" aria-live="polite">
            {last ? (
              <>
                <p className="font-semibold">
                  {last.result === "OK" ? "✓ " : last.result === "DUPLICATE" ? "! " : "✕ "}
                  {last.message}
                </p>
                <p className="mt-0.5 font-mono text-xs opacity-70">{last.code.split("\n")[0]}</p>
              </>
            ) : (
              <p className="text-sm">Waiting for the first scan.</p>
            )}
            {pending ? <p className="mt-1 text-xs opacity-80">{pending} scan{pending === 1 ? "" : "s"} sending…</p> : null}
          </div>
          {log.length > 1 ? (
            <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-xs" id="work-log">
              {log.slice(1, 30).map((s, i) => (
                <li key={i} className={s.result === "OK" ? "text-verdigris-100" : s.result === "DUPLICATE" ? "text-amber-300" : "text-rose-300"}>
                  <span className="font-mono">{s.code.split("\n")[0]}</span> — {s.message}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {/* Pick list */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Pick list — where the cartons are</p>
          <span className="ml-auto mr-2 flex flex-wrap items-center gap-2">
            {w.lines.length > 3 ? (
              <input
                id="work-line-search"
                value={lineQ}
                onChange={(e) => setLineQ(e.target.value)}
                placeholder="Find an item…"
                className="w-44 rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-2.5 py-1.5 text-xs text-verdigris-50"
              />
            ) : null}
            <label className="flex items-center gap-1 text-xs text-verdigris-200/75">
              <input type="checkbox" id="work-line-todo" checked={todoOnly} onChange={(e) => setTodoOnly(e.target.checked)} />
              Still to pick
            </label>
          </span>
          <button type="button" id="work-print-picklist" className={btn} onClick={() => void printPickList(w)}>
            Print pick list
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" id="work-lines">
            <thead>
              <tr className="border-b border-verdigris-300/10 text-left text-[0.72rem] uppercase tracking-[0.1em] text-verdigris-300">
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 text-right font-medium">Cartons</th>
                <th className="px-4 py-3 text-right font-medium">Picked</th>
                <th className="px-4 py-3 text-right font-medium">Packed</th>
                <th className="px-4 py-3 font-medium">Take from</th>
              </tr>
            </thead>
            <tbody>
              {w.lines
                .filter((l) => (!todoOnly || l.picked < l.required) && (!lineQ.trim() || `${l.itemCode ?? ""} ${l.description}`.toLowerCase().includes(lineQ.trim().toLowerCase())))
                .map((l) => {
                const done = l.picked >= l.required;
                return (
                  <tr key={l.id} className="border-b border-verdigris-300/5 align-top">
                    <td className="px-4 py-2.5 text-verdigris-50">
                      {l.itemCode ? <span className="font-mono text-verdigris-200/70">{l.itemCode} · </span> : null}
                      {l.description}
                      <p className="text-xs text-verdigris-200/55">
                        {n(l.piecesPerCarton)} {l.unitCode ?? "pcs"} / carton · ordered {n(l.orderPieces)}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-verdigris-50">{n(l.required)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${done ? "text-emerald-300" : "text-amber-200"}`}>{n(l.picked)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-verdigris-100">{n(l.packed)}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {done ? (
                        <span className="text-emerald-300">All picked</span>
                      ) : l.locations.length === 0 ? (
                        <span className="text-rose-300">No free carton found — check with the warehouse admin</span>
                      ) : (
                        <ul className="space-y-1">
                          {l.suggested.map((st, i) => (
                            <li key={`s${i}`} className="rounded-md bg-patina/10 px-2 py-1">
                              <span className="font-semibold text-patina">Take {st.cartonNos.length}</span>
                              <span className="text-verdigris-50"> · {st.place}</span>
                              {st.floor ? <span className="text-verdigris-200/60"> · {st.floor}</span> : null}
                              <p className="break-words font-mono text-[11px] text-verdigris-100">{st.cartonNos.join(", ")}</p>
                            </li>
                          ))}
                          <li className="pt-1 text-[11px] uppercase tracking-[0.08em] text-verdigris-200/45">All free cartons</li>
                          {l.locations.map((loc, i) => (
                            <li key={i}>
                              <span className={`font-semibold ${loc.kind === "GALA" ? "text-verdigris-50" : "text-amber-200"}`}>{loc.place}</span>
                              {loc.floor ? <span className="text-verdigris-200/60"> · {loc.floor}</span> : null}
                              <span className="text-verdigris-200/60"> · {n(loc.cartons)} carton{loc.cartons === 1 ? "" : "s"}</span>
                              <p className="break-words font-mono text-[11px] text-verdigris-200/45">
                                {loc.cartonNos.slice(0, 8).join(", ")}
                                {loc.cartons > 8 ? " …" : ""}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Packages */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Packages</p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="work-label-size"
              value={size}
              onChange={(e) => {
                const v = e.target.value as PackageLabelSize;
                setSize(v);
                try {
                  window.localStorage.setItem(SIZE_KEY, v);
                } catch {
                  /* not remembered */
                }
              }}
              className="rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-2 py-1.5 text-xs text-verdigris-50"
              title={PACKAGE_LABEL_SIZES.find((x) => x.id === size)?.hint}
            >
              {PACKAGE_LABEL_SIZES.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
            {w.packageList.length > 2 ? (
              <select
                id="work-pkg-show"
                aria-label="Show packages"
                value={pkgShow}
                onChange={(e) => setPkgShow(e.target.value)}
                className="rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-2 py-1.5 text-xs text-verdigris-50"
              >
                <option value="">All packages</option>
                <option value="OPEN">Open</option>
                <option value="CLOSED">Closed — to verify</option>
                <option value="VERIFIED">Verified</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            ) : null}
            <button
              type="button"
              id="work-print-labels"
              className={btn}
              onClick={() => void printLabels(w.packageList.filter((p) => p.kind !== "SINGLE" && (p.status === "CLOSED" || p.status === "VERIFIED")))}
            >
              Print package labels
            </button>
          </div>
          {w.can.pack && loose > 0 ? (
            <button
              type="button"
              id="work-singles"
              className={btn}
              disabled={busy}
              onClick={() => void act(`/dispatch/${w.id}/singles`, {}, `${loose} carton${loose === 1 ? "" : "s"} will go as single cartons.`)}
            >
              Send the {loose} loose carton{loose === 1 ? "" : "s"} as single cartons
            </button>
          ) : null}
        </div>
        {w.packageList.length === 0 ? (
          <p className="mt-2 text-sm text-verdigris-200/55">No package yet. In step 3, open a package and scan the cartons into it.</p>
        ) : (
          <ul className="mt-3 grid gap-3 md:grid-cols-2" id="work-packages">
            {w.packageList.filter((p) => !pkgShow || p.status === pkgShow).map((p) => (
              <li
                key={p.id}
                className={`rounded-xl border p-3 ${p.status === "CANCELLED" ? "border-verdigris-300/10 opacity-60" : p.id === active?.id ? "border-patina/60" : "border-verdigris-300/15"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono font-semibold text-verdigris-50">
                    {p.code} <span className="font-sans text-xs font-normal text-verdigris-200/60">· {KIND_LABEL[p.kind]} {p.no}</span>
                  </p>
                  <StatusBadge value={p.status} />
                </div>
                <p className="mt-1 text-xs text-verdigris-200/65">
                  {p.cartons} carton{p.cartons === 1 ? "" : "s"}
                  {p.weightKg ? ` · ${p.weightKg} kg` : ""}
                  {p.lengthCm && p.widthCm && p.heightCm ? ` · ${p.lengthCm}×${p.widthCm}×${p.heightCm} cm` : ""}
                  {p.createdBy ? ` · by ${p.createdBy}` : ""}
                  {p.verifiedAt ? ` · verified ${fmtTime(p.verifiedAt)}${p.verifiedBy ? ` by ${p.verifiedBy}` : ""}` : ""}
                </p>
                <p className="mt-1 break-words font-mono text-[11px] text-verdigris-200/50">{p.cartonNos.join(", ")}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.status === "OPEN" && w.can.pack ? (
                    <>
                      <button type="button" className={btn} onClick={() => { setPkg(p.id); setMode("PACK"); setRemove(false); }}>
                        Pack into this
                      </button>
                      <button type="button" className={btn} disabled={busy || p.cartons === 0} onClick={() => setDialog({ close: p })}>
                        Close
                      </button>
                    </>
                  ) : null}
                  {p.status !== "CANCELLED" ? (
                    <button type="button" className={btn} onClick={() => void printLabels([p])}>
                      Print label
                    </button>
                  ) : null}
                  {(p.status === "CLOSED" || p.status === "VERIFIED") && w.can.manage && p.kind !== "SINGLE" ? (
                    <button type="button" className={btn} disabled={busy} onClick={() => void act(`/dispatch/packages/${p.id}`, { method: "PATCH", body: { action: "REOPEN" } }, `${p.code} reopened.`)}>
                      Reopen
                    </button>
                  ) : null}
                  {p.status !== "CANCELLED" && w.can.manage ? (
                    <button type="button" className={`${btn} text-rose-200`} disabled={busy} onClick={() => setDialog({ cancel: p })}>
                      Cancel package
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Picked cartons and the scan history */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Picked cartons</p>
            {w.cartons.length > 5 ? (
              <input
                id="work-carton-search"
                value={cartonQ}
                onChange={(e) => setCartonQ(e.target.value)}
                placeholder="Carton or package…"
                className="w-40 rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-2.5 py-1.5 text-xs text-verdigris-50"
              />
            ) : null}
          </div>
          {w.cartons.length === 0 ? (
            <p className="px-4 py-4 text-sm text-verdigris-200/55">None yet.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-xs" id="work-cartons">
                <tbody>
                  {w.cartons
                    .filter((c) => !cartonQ.trim() || `${c.cartonNo} ${c.packageCode ?? ""} ${c.fromGala ?? ""}`.toLowerCase().includes(cartonQ.trim().toLowerCase()))
                    .map((c) => (
                    <tr key={c.id} className="border-b border-verdigris-300/5">
                      <td className="px-4 py-2 font-mono text-verdigris-50">{c.cartonNo}</td>
                      <td className="px-2 py-2 text-verdigris-200/70">{c.fromGala ?? "dock"}</td>
                      <td className="px-2 py-2 text-verdigris-200/70">{c.pickedBy}</td>
                      <td className="px-2 py-2">
                        {c.area === "RETURN" ? (
                          <span className="text-rose-300">to put back</span>
                        ) : c.packageCode ? (
                          <span className="font-mono text-emerald-300">{c.packageCode}</span>
                        ) : c.arrived ? (
                          <span className="text-verdigris-100">at packing</span>
                        ) : (
                          <span className="text-amber-200">on the way</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card className="overflow-hidden">
          <p className="px-4 pt-4 text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Last scans (everyone)</p>
          {w.scans.length === 0 ? (
            <p className="px-4 py-4 text-sm text-verdigris-200/55">None yet.</p>
          ) : (
            <ul className="max-h-96 space-y-1 overflow-y-auto px-4 py-3 text-xs" id="work-scans">
              {w.scans.map((s, i) => (
                <li key={i} className={s.result === "OK" ? "text-verdigris-100" : s.result === "DUPLICATE" ? "text-amber-300" : "text-rose-300"}>
                  <span className="text-verdigris-200/50">{fmtDateTime(s.at)}</span> · {s.step.toLowerCase()} · <span className="font-mono">{s.code.split("\n")[0]}</span>
                  {s.message ? ` — ${s.message}` : ""}
                  {s.by ? <span className="text-verdigris-200/50"> · {s.by}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {dialog === "assign" ? <AssignDialog w={w} onClose={() => setDialog(null)} onSaved={(nw) => { setW(nw); setDialog(null); }} /> : null}
      {dialog === "hold" ? (
        <ReasonDialog
          title={`Put ${w.dnNo} on hold?`}
          hint="Picking, packing and verifying stop until it is resumed. The assigned staff are told."
          placeholder="Buyer asked to wait, payment pending…"
          confirm="Put on hold"
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            if (await act(`/dispatch/${w.id}/hold`, { body: { on: true, reason } }, `${w.dnNo} is on hold.`)) setDialog(null);
          }}
        />
      ) : null}
      {dialog && typeof dialog === "object" && "cancel" in dialog ? (
        <ReasonDialog
          title={`Cancel ${dialog.cancel.code}?`}
          hint="Its cartons stay at the packing area, out of any package, to be packed again. The code is not used again."
          placeholder="Wrong cartons, damaged box…"
          confirm="Cancel package"
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            if (await act(`/dispatch/packages/${dialog.cancel.id}`, { method: "PATCH", body: { action: "CANCEL", reason } }, `${dialog.cancel.code} cancelled.`)) setDialog(null);
          }}
        />
      ) : null}
      {dialog && typeof dialog === "object" && "close" in dialog ? (
        <CloseDialog
          p={dialog.close}
          onClose={() => setDialog(null)}
          onConfirm={async (size) => {
            if (await act(`/dispatch/packages/${dialog.close.id}`, { method: "PATCH", body: { action: "CLOSE", ...size } }, `${dialog.close.code} closed.`)) setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Modal({ label, children, onClose }: { label: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink-900/70" />
      <div role="dialog" aria-modal="true" aria-label={label} className="relative w-full max-w-md rounded-2xl border border-verdigris-300/20 bg-ink-850 p-6 card-shadow">
        {children}
      </div>
    </div>
  );
}

function ReasonDialog({
  title,
  hint,
  placeholder,
  confirm,
  onClose,
  onConfirm,
}: {
  title: string;
  hint: string;
  placeholder: string;
  confirm: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal label={title} onClose={onClose}>
      <h2 className="text-base font-semibold text-verdigris-50">{title}</h2>
      <p className="mt-2 text-sm text-verdigris-200/75">{hint}</p>
      <textarea id="work-reason" rows={2} value={reason} onChange={(e) => { setReason(e.target.value); setErr(""); }} placeholder={placeholder} className={`mt-3 ${field} ${err ? "border-rose-500" : ""}`} />
      {err ? <p className="mt-1 text-xs text-rose-300" id="work-reason-err">{err}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100">Back</button>
        <button
          type="button"
          id="work-reason-ok"
          disabled={busy}
          onClick={async () => {
            if (!reason.trim()) return setErr("Say why");
            setBusy(true);
            await onConfirm(reason.trim());
            setBusy(false);
          }}
          className="rounded-lg bg-amber-500/85 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-60"
        >
          {busy ? "Working…" : confirm}
        </button>
      </div>
    </Modal>
  );
}

function CloseDialog({
  p,
  onClose,
  onConfirm,
}: {
  p: WorkPackage;
  onClose: () => void;
  onConfirm: (size: { weightKg: number | null; lengthCm: number | null; widthCm: number | null; heightCm: number | null }) => Promise<void>;
}) {
  const [v, setV] = useState({ weightKg: p.weightKg?.toString() ?? "", lengthCm: p.lengthCm?.toString() ?? "", widthCm: p.widthCm?.toString() ?? "", heightCm: p.heightCm?.toString() ?? "" });
  const [busy, setBusy] = useState(false);
  const num = (s: string) => (s.trim() && Number(s) > 0 ? Number(s) : null);
  return (
    <Modal label={`Close ${p.code}`} onClose={onClose}>
      <h2 className="text-base font-semibold text-verdigris-50">Close {p.code}?</h2>
      <p className="mt-2 text-sm text-verdigris-200/75">
        {p.cartons} carton{p.cartons === 1 ? "" : "s"} inside. Weight and size are optional — they print on the label.
      </p>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {(
          [
            ["weightKg", "Kg"],
            ["lengthCm", "L cm"],
            ["widthCm", "W cm"],
            ["heightCm", "H cm"],
          ] as const
        ).map(([k, l]) => (
          <label key={k} className="text-xs text-verdigris-200/70">
            {l}
            <input id={`work-${k}`} inputMode="decimal" value={v[k]} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} className={`mt-1 ${field}`} />
          </label>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100">Back</button>
        <button
          type="button"
          id="work-close-ok"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onConfirm({ weightKg: num(v.weightKg), lengthCm: num(v.lengthCm), widthCm: num(v.widthCm), heightCm: num(v.heightCm) });
            setBusy(false);
          }}
          className="rounded-lg bg-emerald-500/85 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
        >
          {busy ? "Working…" : "Close package"}
        </button>
      </div>
    </Modal>
  );
}

function AssignDialog({ w, onClose, onSaved }: { w: WorkDetail; onClose: () => void; onSaved: (w: WorkDetail) => void }) {
  const toast = useToast();
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(w.assigneeList.map((a) => a.id)));
  const [busy, setBusy] = useState(false);
  const ROLE: Record<string, string> = { PACKAGE_MANAGER: "Package manager", STORAGE_MANAGER: "Storage manager", WAREHOUSE_ADMIN: "Warehouse admin" };
  return (
    <Modal label="Assign staff" onClose={onClose}>
      <h2 className="text-base font-semibold text-verdigris-50">Who picks and packs {w.dnNo}?</h2>
      <p className="mt-2 text-sm text-verdigris-200/75">Each person you add is told on the app and by phone.</p>
      {w.assignable.length === 0 ? (
        <p className="mt-3 text-sm text-amber-200">Nobody at {w.warehouseName} has the package or storage manager role yet.</p>
      ) : (
        <ul className="mt-3 max-h-72 space-y-1.5 overflow-y-auto" id="work-assign-list">
          {w.assignable.map((u) => (
            <li key={u.id}>
              <label className="flex items-center gap-2 text-sm text-verdigris-50">
                <input
                  type="checkbox"
                  checked={chosen.has(u.id)}
                  onChange={(e) =>
                    setChosen((s) => {
                      const nx = new Set(s);
                      if (e.target.checked) nx.add(u.id);
                      else nx.delete(u.id);
                      return nx;
                    })
                  }
                />
                {u.name}
                <span className="text-xs text-verdigris-200/55">{u.roles.split(",").map((r) => ROLE[r] ?? r).join(", ")}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100">Back</button>
        <button
          type="button"
          id="work-assign-save"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await api<{ work: WorkDetail }>(`/dispatch/${w.id}/assign`, { body: { userIds: [...chosen] } });
            setBusy(false);
            if (!r.ok) return toast.error(r.error.message);
            toast.success("Staff assigned.");
            onSaved(r.data.work);
          }}
          className="rounded-lg bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-patina disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
