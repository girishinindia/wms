"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/Toast";
import { Card, StatusBadge } from "@/components/admin/ui";
import { api } from "@/lib/api/client";
import type { NoteDetail } from "@/lib/delivery/ops";
import { fmtDateTime, fmtDay } from "@/lib/format/datetime";

import { FieldError, input, label } from "./HeaderFields";

const n = (v: number) => v.toLocaleString("en-IN");

const KIND: Record<string, string> = {
  IMPORTER: "Approved by the importer",
  IMPORTER_EDIT: "Changed and approved by the importer",
  IMPORTER_CREATED: "Created by the importer",
  AUTO: "Auto-approved — trusted sales agent",
  CONFIRMED: "Approved after confirming with the importer",
};
const ACTION: Record<string, string> = {
  SUBMITTED: "Submitted",
  AUTO_APPROVED: "Auto-approved",
  APPROVED: "Approved",
  CONFIRMED_APPROVED: "Approved on the importer's word",
  REJECTED: "Rejected",
  EDITED: "Changed",
};
const METHODS = [
  ["PHONE", "Phone call"],
  ["IN_PERSON", "In person"],
  ["WHATSAPP", "WhatsApp"],
  ["EMAIL", "Email"],
  ["OTHER", "Other"],
] as const;

type Decide = { kind: "approve" | "reject" };

export default function DeliveryNoteDetail({ note }: { note: NoteDetail }) {
  const router = useRouter();
  const toast = useToast();
  const [deciding, setDeciding] = useState<Decide | null>(null);
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState("");
  const [person, setPerson] = useState("");
  const [cnote, setCnote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const h = note.header;

  const decide = async () => {
    if (!deciding) return;
    const f: Record<string, string> = {};
    if (deciding.kind === "reject" && !reason.trim()) f.reason = "Say why it is rejected";
    if (note.can.confirmNeeded) {
      if (!method) f.method = "How did you confirm with the importer?";
      if (!person.trim()) f.person = "Who at the importer said yes?";
    }
    if (Object.keys(f).length) return setErrors(f);
    setBusy(true);
    const confirm = note.can.confirmNeeded ? { method, person, note: cnote || null } : null;
    const r = await api<{ note: NoteDetail }>(`/delivery-notes/${note.id}/${deciding.kind}`, {
      body: deciding.kind === "reject" ? { reason, confirm } : { confirm },
    });
    setBusy(false);
    if (!r.ok) {
      if (r.error.fields) setErrors(r.error.fields);
      return toast.error(r.error.message);
    }
    toast.success(deciding.kind === "approve" ? `${note.dnNo} approved.` : `${note.dnNo} rejected — its cartons are free again.`);
    setDeciding(null);
    router.refresh();
  };

  const totalPieces = note.lineItems.reduce((s, l) => s + l.pieces, 0);
  const totalCartons = note.lineItems.reduce((s, l) => s + l.cartons, 0);

  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Delivery note</p>
            <p className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-mono text-2xl font-semibold text-verdigris-50" id="dn-no">{note.dnNo}</span>
              <span id="dn-status"><StatusBadge value={note.status === "PENDING" ? "PENDING_APPROVAL" : note.status} /></span>
              {h.priority === "URGENT" ? <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-xs text-amber-200">Urgent</span> : null}
            </p>
            <p className="mt-1 text-sm text-verdigris-200/65">
              {fmtDay(note.dnDate)} · Order {note.orderNo} · {note.warehouseName} · by {note.createdByName}
            </p>
            {note.status === "APPROVED" && note.approvalKind ? (
              <p className="mt-2 text-sm text-emerald-300" id="dn-approved-by">
                {KIND[note.approvalKind]}
                {note.approvedByName && note.approvalKind !== "AUTO" ? ` · ${note.approvedByName}` : ""}
                {note.approvedAt ? ` · ${fmtDateTime(note.approvedAt)}` : ""}
                {note.confirmPerson ? ` · confirmed with ${note.confirmPerson}` : ""}
              </p>
            ) : null}
            {note.status === "REJECTED" ? (
              <p className="mt-2 text-sm text-rose-300" id="dn-rejected">
                Rejected by {note.rejectedByName}: {note.rejectReason}. This note is closed — make a new one if needed.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/v1/delivery-notes/${note.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              id="dn-pdf"
              className="rounded-xl border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45"
            >
              View PDF
            </a>
            <a
              href={`/api/v1/delivery-notes/${note.id}/pdf?download=1`}
              id="dn-download"
              className="rounded-xl border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45"
            >
              Download PDF
            </a>
            {note.can.edit ? (
              <Link
                href={`/admin/delivery-notes/${note.id}/edit`}
                id="dn-edit"
                className="rounded-xl border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45"
              >
                Edit
              </Link>
            ) : null}
            {note.can.reject ? (
              <button type="button" id="dn-reject" onClick={() => { setErrors({}); setDeciding({ kind: "reject" }); }} className="rounded-xl border border-rose-400/40 px-4 py-2 text-sm text-rose-200 hover:bg-rose-500/10">
                Reject
              </button>
            ) : null}
            {note.can.approve ? (
              <button type="button" id="dn-approve" onClick={() => { setErrors({}); setDeciding({ kind: "approve" }); }} className="rounded-xl bg-emerald-500/85 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
                Approve
              </button>
            ) : null}
          </div>
        </div>
        {note.status === "PENDING" && !note.can.approve ? (
          <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/5 p-3 text-sm text-amber-100">
            Waiting for {note.importerName} to approve. Its cartons are kept aside meanwhile.
          </p>
        ) : null}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <p className={label}>Buyer (bill to)</p>
          <p className="text-base font-semibold text-verdigris-50">{h.buyerName}</p>
          <div className="mt-1 space-y-0.5 text-sm text-verdigris-100">
            {h.buyerMobile ? <p>{h.buyerMobile}</p> : null}
            {h.buyerAddress ? <p className="whitespace-pre-line">{h.buyerAddress}</p> : null}
            {h.buyerGstin ? <p>GSTIN {h.buyerGstin}</p> : null}
            {h.destination ? <p>Destination: {h.destination}</p> : null}
          </div>
        </Card>
        <Card className="p-5">
          <p className={label}>Dispatch</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
            <dt className="text-verdigris-200/60">Transport</dt><dd className="text-verdigris-50">{h.transportName ?? "—"}</dd>
            <dt className="text-verdigris-200/60">Payment</dt><dd className="text-verdigris-50">{h.paymentMode ?? "—"}</dd>
            <dt className="text-verdigris-200/60">Billing</dt>
            <dd className="text-verdigris-50">{h.billing === "WITH_BILL" ? `With bill${h.billAmount ? ` · ₹${n(h.billAmount)}` : ""}` : h.billing === "WITHOUT_BILL" ? "Without bill" : "—"}</dd>
            <dt className="text-verdigris-200/60">Packing</dt>
            <dd className="text-verdigris-50">{h.packing === "BUNDLE" ? `${h.bundles ?? ""} bundle${h.bundles === 1 ? "" : "s"}` : h.packing === "LOOSE" ? "Loose" : "Cartons"}</dd>
            {h.instructions ? (<><dt className="text-verdigris-200/60">Instructions</dt><dd className="whitespace-pre-line text-verdigris-50">{h.instructions}</dd></>) : null}
          </dl>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm" id="dn-lines">
          <thead>
            <tr className="border-b border-verdigris-300/10 text-left text-[0.72rem] uppercase tracking-[0.1em] text-verdigris-300">
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 text-right font-medium">Per carton</th>
              <th className="px-4 py-3 text-right font-medium">Cartons</th>
              <th className="px-4 py-3 text-right font-medium">Total pieces</th>
            </tr>
          </thead>
          <tbody>
            {note.lineItems.map((l, i) => (
              <tr key={l.key} className="border-b border-verdigris-300/5">
                <td className="px-4 py-2.5 text-verdigris-200/60">{i + 1}</td>
                <td className="px-4 py-2.5 text-verdigris-50">
                  {l.itemCode ? <span className="font-mono text-verdigris-200/70">{l.itemCode} · </span> : null}
                  {l.description}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-verdigris-100">{n(l.piecesPerCarton)} {l.unitCode ?? "pcs"}</td>
                <td className="px-4 py-2.5 text-right font-mono text-verdigris-50">{n(l.cartons)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-verdigris-50">{n(l.pieces)}</td>
              </tr>
            ))}
            <tr className="bg-ink-900/40 font-semibold">
              <td className="px-4 py-3" colSpan={3}>
                <span className="text-verdigris-100">Total</span>
              </td>
              <td className="px-4 py-3 text-right font-mono text-verdigris-50" id="dn-total-cartons">{n(totalCartons)}</td>
              <td className="px-4 py-3 text-right font-mono text-verdigris-50">{n(totalPieces)}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card className="p-5">
        <p className={label}>History</p>
        <ol className="space-y-2 text-sm" id="dn-history">
          {note.events.map((e, i) => (
            <li key={i} className="flex flex-wrap gap-x-3 border-l-2 border-verdigris-300/20 pl-3">
              <span className="font-medium text-verdigris-50">{ACTION[e.action] ?? e.action}</span>
              <span className="text-verdigris-200/65">{e.by ?? ""}</span>
              <span className="text-verdigris-200/45">{fmtDateTime(e.at)}</span>
              {e.remarks ? <span className="w-full text-xs text-verdigris-200/65">{e.remarks}</span> : null}
            </li>
          ))}
        </ol>
      </Card>

      {deciding ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button type="button" aria-label="Cancel" onClick={() => setDeciding(null)} className="absolute inset-0 bg-ink-900/70" />
          <div role="alertdialog" aria-modal="true" aria-label={deciding.kind === "approve" ? "Approve" : "Reject"} className={`relative w-full max-w-md rounded-2xl border bg-ink-850 p-6 card-shadow ${deciding.kind === "approve" ? "border-emerald-400/30" : "border-rose-400/30"}`}>
            <h2 className="text-base font-semibold text-verdigris-50">
              {deciding.kind === "approve" ? `Approve ${note.dnNo}?` : `Reject ${note.dnNo}?`}
            </h2>
            <p className="mt-2 text-sm text-verdigris-200/75">
              {deciding.kind === "approve"
                ? `${n(totalCartons)} cartons to ${h.buyerName} from ${note.warehouseName}.`
                : "Rejecting is final: its cartons go back to stock and the sales agent must make a new note."}
            </p>
            {deciding.kind === "reject" ? (
              <div className="mt-3">
                <label className={label} htmlFor="dn-reason">Reason</label>
                <textarea id="dn-reason" rows={2} value={reason} onChange={(e) => { setReason(e.target.value); setErrors((x) => ({ ...x, reason: "" })); }} className={`${input} ${errors.reason ? "border-rose-500" : "border-verdigris-300/15"}`} placeholder="Buyer cancelled, wrong quantity…" />
                <FieldError id="dn-reason-err" text={errors.reason} />
              </div>
            ) : null}
            {note.can.confirmNeeded ? (
              <div className="mt-4 space-y-3 rounded-xl border border-amber-400/30 bg-amber-500/5 p-3">
                <p className="text-sm text-amber-100">
                  Only {note.importerName} decides on delivery notes. Ask them first, then record how and who.
                </p>
                <div>
                  <label className={label} htmlFor="dn-method">How did you ask?</label>
                  <select id="dn-method" value={method} onChange={(e) => { setMethod(e.target.value); setErrors((x) => ({ ...x, method: "" })); }} className={`${input} ${errors.method ? "border-rose-500" : "border-verdigris-300/15"}`}>
                    <option value="">Choose…</option>
                    {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <FieldError id="dn-method-err" text={errors.method} />
                </div>
                <div>
                  <label className={label} htmlFor="dn-person">Who said yes?</label>
                  <input id="dn-person" value={person} onChange={(e) => { setPerson(e.target.value); setErrors((x) => ({ ...x, person: "" })); }} className={`${input} ${errors.person ? "border-rose-500" : "border-verdigris-300/15"}`} placeholder="Name at the importer" />
                  <FieldError id="dn-person-err" text={errors.person} />
                </div>
                <div>
                  <label className={label} htmlFor="dn-cnote">Note</label>
                  <input id="dn-cnote" value={cnote} onChange={(e) => setCnote(e.target.value)} className={`${input} border-verdigris-300/15`} placeholder="Optional — e.g. called at 4 pm" />
                </div>
              </div>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDeciding(null)} disabled={busy} className="rounded-lg border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100">Cancel</button>
              <button type="button" id="dn-decide" onClick={() => void decide()} disabled={busy} className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${deciding.kind === "approve" ? "bg-emerald-500/85 hover:bg-emerald-500" : "bg-rose-500/85 hover:bg-rose-500"}`}>
                {busy ? "Working…" : deciding.kind === "approve" ? "Approve" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
