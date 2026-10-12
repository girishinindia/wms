"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useToast } from "@/components/Toast";
import { Card } from "@/components/admin/ui";
import { api } from "@/lib/api/client";
import type { Client, Draft, Header, NoteSummary, StockRow } from "@/lib/delivery/ops";

import HeaderFields, { label } from "./HeaderFields";
import StockPicker, { lineKey, type Chosen } from "./StockPicker";

const n = (v: number) => v.toLocaleString("en-IN");
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * A new delivery note. Every item added holds its cartons for 15 minutes
 * — the countdown at the top. Not sent in time, the cartons go back and
 * the screen offers to start again with the buyer and transport kept.
 * Items from two warehouses become two delivery notes on submit.
 */
export default function DeliveryNoteForm() {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [header, setHeader] = useState<Header | null>(null);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [left, setLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const deadline = useRef<number | null>(null);

  const take = useCallback((d: Draft) => {
    setDraft(d);
    setHeader(d.header);
    deadline.current = d.secondsLeft === null ? null : Date.now() + d.secondsLeft * 1000;
    setLeft(d.secondsLeft);
  }, []);

  const loadStock = useCallback(async (draftId: number) => {
    const r = await api<{ stock: StockRow[] }>(`/delivery/stock?draftId=${draftId}`, { method: "GET" });
    if (r.ok) setStock(r.data.stock);
  }, []);

  const start = useCallback(
    async (copyFrom: number | null) => {
      const r = await api<{ draft: Draft }>("/delivery/draft", { body: { copyFrom } });
      if (!r.ok) return toast.error(r.error.message);
      take(r.data.draft);
      setErrors({});
      void loadStock(r.data.draft.id);
    },
    [take, loadStock, toast],
  );

  // Pick up where this person left off, or start.
  useEffect(() => {
    void (async () => {
      const r = await api<{ draft: Draft | null }>("/delivery/draft", { method: "GET" });
      if (!r.ok) return toast.error(r.error.message);
      if (r.data.draft && r.data.draft.status === "DRAFT") {
        take(r.data.draft);
        void loadStock(r.data.draft.id);
      } else {
        await start(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The countdown. At zero the server is asked, which marks it expired.
  useEffect(() => {
    const t = setInterval(() => {
      if (deadline.current === null) return;
      const s = Math.max(0, Math.round((deadline.current - Date.now()) / 1000));
      setLeft(s);
      if (s === 0 && draft?.status === "DRAFT") {
        deadline.current = null;
        void (async () => {
          const r = await api<{ draft: Draft | null }>("/delivery/draft", { method: "GET" });
          if (r.ok && r.data.draft) take(r.data.draft);
          else setDraft((d) => (d ? { ...d, status: "EXPIRED", lines: [] } : d));
        })();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [draft?.status, take]);

  const commit = useCallback(
    async (patch: Partial<Header>) => {
      if (!draft || draft.status !== "DRAFT") return;
      const r = await api<{ draft: Draft }>(`/delivery/draft/${draft.id}`, { method: "PATCH", body: patch });
      if (!r.ok) {
        if (r.error.fields) setErrors((e) => ({ ...e, ...r.error.fields }));
        else toast.error(r.error.message);
        return;
      }
      setDraft(r.data.draft);
      setErrors((e) => {
        const next = { ...e };
        for (const k of Object.keys(patch)) if ((patch as Record<string, unknown>)[k]) delete next[k];
        return next;
      });
    },
    [draft, toast],
  );

  const pickClient = async (c: Client) => {
    if (!draft) return;
    const r = await api<{ draft: Draft }>(`/delivery/draft/${draft.id}`, { method: "PATCH", body: { clientId: c.id } });
    if (!r.ok) return toast.error(r.error.message);
    setDraft(r.data.draft);
    setHeader(r.data.draft.header);
    setErrors((e) => {
      const rest = { ...e };
      for (const k of ["buyerName", "buyerMobile", "buyerAddress", "buyerCity", "buyerState", "buyerPincode", "buyerGstin"]) delete rest[k];
      return rest;
    });
  };

  // Free counts change as other agents hold and let go: look again every
  // 20 seconds, and when the window comes back into view.
  useEffect(() => {
    if (!draft || draft.status !== "DRAFT") return;
    const again = () => {
      if (document.visibilityState === "visible") void loadStock(draft.id);
    };
    const t = setInterval(again, 20_000);
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [draft?.id, draft?.status, loadStock]); // eslint-disable-line react-hooks/exhaustive-deps

  const hold = async (row: StockRow, cartons: number, orderPieces: number | null) => {
    if (!draft) return { ok: false, message: "Not ready" };
    const r = await api<{ draft: Draft; ok: boolean; message?: string }>(`/delivery/draft/${draft.id}/lines`, {
      method: "PUT",
      body: { warehouseId: row.warehouseId, key: row.key, cartons, orderPieces },
    });
    if (!r.ok) return { ok: false, message: r.error.message };
    take({ ...r.data.draft, header: header ?? r.data.draft.header });
    void loadStock(draft.id);
    return { ok: r.data.ok, message: r.data.message };
  };

  const chosen = useMemo(() => {
    const m: Chosen = {};
    for (const l of draft?.lines ?? []) m[lineKey(l.warehouseId, l.key)] = { cartons: l.cartons, orderPieces: l.orderPieces };
    return m;
  }, [draft?.lines]);

  const byWarehouse = useMemo(() => {
    const m = new Map<string, { items: number; cartons: number; pieces: number; ordered: number }>();
    for (const l of draft?.lines ?? []) {
      const x = m.get(l.warehouseName) ?? { items: 0, cartons: 0, pieces: 0, ordered: 0 };
      x.items += 1;
      x.cartons += l.cartons;
      x.pieces += l.cartons * l.piecesPerCarton;
      x.ordered += l.orderPieces;
      m.set(l.warehouseName, x);
    }
    return [...m.entries()];
  }, [draft?.lines]);

  const submit = async () => {
    if (!draft) return;
    setBusy(true);
    const r = await api<{ notes: NoteSummary[] }>(`/delivery/draft/${draft.id}/submit`, { body: {} });
    setBusy(false);
    if (!r.ok) {
      if (r.error.fields) setErrors(r.error.fields);
      toast.error(r.error.message);
      if (/Time ran out/.test(r.error.message)) setDraft((d) => (d ? { ...d, status: "EXPIRED" } : d));
      return;
    }
    const notes = r.data.notes;
    toast.success(
      notes.length === 1
        ? `Delivery note ${notes[0]!.dnNo} ${notes[0]!.status === "APPROVED" ? "created and approved" : "sent for approval"}.`
        : `${notes.length} delivery notes created — one per warehouse.`,
    );
    router.push(notes.length === 1 ? `/admin/delivery-notes/${notes[0]!.id}` : "/admin/delivery-notes");
    router.refresh();
  };

  const cancel = async () => {
    if (draft && draft.status === "DRAFT") await api(`/delivery/draft/${draft.id}`, { method: "DELETE" });
    router.push("/admin/delivery-notes");
  };

  if (!draft || !header) {
    return <p className="text-sm text-verdigris-200/60">Getting your stock…</p>;
  }

  if (draft.status !== "DRAFT") {
    return (
      <Card className="p-6" >
        <div id="dn-expired" role="alert" className="space-y-3">
          <p className="text-lg font-semibold text-amber-200">Time ran out</p>
          <p className="text-sm text-verdigris-100">
            The delivery note was not sent within 15 minutes, so its cartons were put back for others. The buyer and transport are kept — add the items again.
          </p>
          <div className="flex gap-2">
            <button type="button" id="dn-restart" onClick={() => void start(draft.id)} className="rounded-xl bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 hover:bg-patina">
              Start again
            </button>
            <Link href="/admin/delivery-notes" className="rounded-xl border border-verdigris-300/20 px-4 py-2.5 text-sm text-verdigris-100">
              Back to the list
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  const low = left !== null && left <= 120;
  return (
    <div className="space-y-5">
      {/* Solid underlay: the tinted bar is see-through, and it sits over the form as you scroll. */}
      <div className="sticky top-2 z-30 rounded-xl bg-ink-850">
      <div
        id="dn-timer"
        className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm ${
          left === null
            ? "border-verdigris-300/15 bg-ink-850 text-verdigris-200/75"
            : low
              ? "border-rose-400/50 bg-rose-500/10 text-rose-200"
              : "border-amber-400/40 bg-amber-500/10 text-amber-100"
        }`}
      >
        {left === null ? (
          <span>Cartons are held for 15 minutes from the first item you add.</span>
        ) : (
          <>
            <span>
              Cartons held for you — send within <b className="font-mono text-base" id="dn-clock">{clock(left)}</b>
            </span>
            <span className="text-xs opacity-80">After that they go back to stock for other agents.</span>
          </>
        )}
      </div>
      </div>

      <Card className="p-5 sm:p-6">
        <HeaderFields
          header={header}
          errors={errors}
          set={(k, v) => setHeader((h) => (h ? { ...h, [k]: v } : h))}
          commit={(p) => void commit(p)}
          onPickClient={(c) => void pickClient(c)}
        />
      </Card>

      <Card className="p-5 sm:p-6">
        <p className={label}>Items</p>
        <p className="mb-3 text-sm text-verdigris-200/60">
          Pick cartons from any warehouse. Each warehouse becomes its own delivery note.
        </p>
        <StockPicker stock={stock} chosen={chosen} onSet={hold} />
      </Card>

      <Card className="p-5 sm:p-6">
        <p className={label}>Summary</p>
        {byWarehouse.length === 0 ? (
          <p className="text-sm text-verdigris-200/60" id="dn-summary">No items yet.</p>
        ) : (
          <ul className="space-y-1.5 text-sm" id="dn-summary">
            {byWarehouse.map(([w, x], i) => (
              <li key={w} className="flex flex-wrap justify-between gap-2 text-verdigris-100">
                <span>
                  Delivery note {i + 1} · <b className="text-verdigris-50">{w}</b>
                </span>
                <span className="font-mono">
                  {x.items} item{x.items === 1 ? "" : "s"} · ordered {n(x.ordered)} pcs · {n(x.cartons)} ctn · {n(x.pieces)} pcs
                </span>
              </li>
            ))}
          </ul>
        )}
        {Object.keys(errors).length ? (
          <p className="mt-3 text-sm font-medium text-rose-300" role="alert">Fill in the fields marked in red.</p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => void cancel()} className="rounded-xl border border-verdigris-300/20 px-4 py-2.5 text-sm text-verdigris-100 hover:border-verdigris-300/45">
            Cancel
          </button>
          <button
            type="button"
            id="dn-submit"
            disabled={busy || byWarehouse.length === 0}
            onClick={() => void submit()}
            className="rounded-xl bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 hover:bg-patina disabled:opacity-50"
          >
            {busy ? "Sending…" : byWarehouse.length > 1 ? `Submit ${byWarehouse.length} delivery notes` : "Submit delivery note"}
          </button>
        </div>
      </Card>
    </div>
  );
}
