"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/Toast";
import { Card } from "@/components/admin/ui";
import { api } from "@/lib/api/client";
import type { NoteDetail } from "@/lib/delivery/ops";
import { fmtDateTime, fmtDay } from "@/lib/format/datetime";
import { DO_LABEL, LR_LABEL } from "@/lib/outward/labels";

import { FieldError, input, label } from "../delivery/HeaderFields";
import { DoPill } from "./OutwardBoard";

const n = (v: number) => v.toLocaleString("en-IN");

/** On the delivery note: its dispatch orders, a shortcut to make one, and "close the rest short". */
export default function NoteOutwardCard({ note }: { note: NoteDetail }) {
  const router = useRouter();
  const toast = useToast();
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const dos = note.dispatchOrders ?? [];
  if (!dos.length && !note.can.makeDo && !note.shortClosed) return null;

  const close = async () => {
    if (!reason.trim()) return setError("Say why the rest does not go");
    setBusy(true);
    const r = await api<{ returned: number }>(`/outward/notes/${note.id}/close-short`, { body: { reason } });
    setBusy(false);
    if (!r.ok) {
      if (r.error.fields?.reason) setError(r.error.fields.reason);
      return toast.error(r.error.message);
    }
    toast.success(
      `${note.dnNo} closed short${r.data.returned ? ` — ${n(r.data.returned)} picked carton${r.data.returned === 1 ? "" : "s"} go back to storage` : ""}.`,
    );
    setClosing(false);
    router.refresh();
  };

  return (
    <div id="dn-outward">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={label}>Outward</p>
            <p className="text-sm text-verdigris-100">
              {note.openCartons > 0 && !note.shortClosed ? (
                <span id="dn-open-cartons">{n(note.openCartons)} carton{note.openCartons === 1 ? "" : "s"} still to leave</span>
              ) : note.shortClosed ? (
                <span>Closed short — nothing more goes</span>
              ) : (
                <span className="text-emerald-300">Everything has left</span>
              )}
              {note.readyPackages > 0 ? <span className="text-verdigris-200/65"> · {n(note.readyPackages)} package{note.readyPackages === 1 ? "" : "s"} ready to load</span> : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {note.can.makeDo ? (
              <Link
                href={`/admin/outward/new?note=${note.id}`}
                id="dn-make-do"
                className="rounded-xl bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-patina"
              >
                Make dispatch order
              </Link>
            ) : null}
            {note.can.closeShort ? (
              <button
                type="button"
                id="dn-close-short"
                onClick={() => {
                  setReason("");
                  setError("");
                  setClosing(true);
                }}
                className="rounded-xl border border-amber-400/40 px-4 py-2 text-sm text-amber-100 hover:bg-amber-500/10"
              >
                Close the rest short
              </button>
            ) : null}
          </div>
        </div>

        {note.shortClosed ? (
          <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/5 p-3 text-sm text-amber-100" id="dn-short-closed">
            Closed short{note.shortClosed.by ? ` by ${note.shortClosed.by}` : ""} · {fmtDateTime(note.shortClosed.at)}
            {note.shortClosed.reason ? `: ${note.shortClosed.reason}` : ""}
          </p>
        ) : null}

        {dos.length ? (
          <ul className="mt-3 divide-y divide-verdigris-300/10 rounded-xl border border-verdigris-300/10" id="dn-dos">
            {dos.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={`/admin/outward/${d.id}`} className="font-mono font-semibold text-verdigris-50 hover:text-patina">
                    {d.doNo}
                  </Link>
                  <DoPill status={d.status} label={DO_LABEL[d.status] ?? d.status} />
                </span>
                <span className="text-xs text-verdigris-200/65">
                  {d.vehicleNo ?? "no vehicle yet"} · {n(d.packages)} pkg · {n(d.cartons)} ctn
                  {d.dispatchedAt ? ` · left ${fmtDay(d.dispatchedAt)}` : ""}
                  {d.status === "DISPATCHED" ? ` · ${LR_LABEL[d.lrStatus] ?? d.lrStatus}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {closing ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button type="button" aria-label="Cancel" onClick={() => setClosing(false)} className="absolute inset-0 bg-ink-900/70" />
          <div role="alertdialog" aria-modal="true" aria-label="Close the rest short" className="relative w-full max-w-md rounded-2xl border border-amber-400/30 bg-ink-850 p-6 card-shadow">
            <h2 className="text-base font-semibold text-verdigris-50">Close the rest of {note.dnNo} short?</h2>
            <p className="mt-2 text-sm text-verdigris-200/75">
              {n(note.openCartons)} carton{note.openCartons === 1 ? "" : "s"} not on a dispatch order will no longer go. They become free stock again; any already picked must be put back into storage. This is final.
            </p>
            <div className="mt-3">
              <label className={label} htmlFor="dn-short-reason">Reason</label>
              <textarea
                id="dn-short-reason"
                rows={2}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError("");
                }}
                className={`${input} ${error ? "border-rose-500" : "border-verdigris-300/15"}`}
                placeholder="Buyer took part only, stock damaged…"
              />
              <FieldError id="dn-short-reason-err" text={error} />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setClosing(false)} disabled={busy} className="rounded-lg border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100">
                Keep it open
              </button>
              <button
                type="button"
                id="dn-short-confirm"
                onClick={() => void close()}
                disabled={busy}
                className="rounded-lg bg-amber-500/85 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-amber-400 disabled:opacity-60"
              >
                {busy ? "Working…" : "Close short"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
