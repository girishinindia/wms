"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "@/lib/api/client";
import { useToast } from "@/components/Toast";
import { Card, ConfirmDialog, Facts, StatusBadge } from "@/components/admin/ui";

import CartonsPanel from "./CartonsPanel";
import type { Detail } from "./InwardForm";
import { fmt } from "./InwardTable";

/**
 * One request, read by either side. The buttons are the server's `can`
 * block, so nothing offered here is a request it will refuse.
 */

const primary =
  "rounded-xl bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina disabled:opacity-50";
const secondary =
  "rounded-xl border border-verdigris-300/20 px-4 py-2.5 text-sm text-verdigris-100 hover:border-verdigris-300/45 disabled:opacity-50";
const danger =
  "rounded-xl border border-rose-400/40 px-4 py-2.5 text-sm text-rose-200 hover:border-rose-400/70 disabled:opacity-50";

function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  return t.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function InwardDetail({ detail: initial }: { detail: Detail }) {
  const router = useRouter();
  const toast = useToast();
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | "cancel" | "complete">(null);
  const [note, setNote] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);

  // ── Move to another warehouse (super admin) ──
  const [move, setMove] = useState<{ warehouseId: number | null; reason: string } | null>(null);
  const [moveError, setMoveError] = useState<Record<string, string>>({});
  const [sites, setSites] = useState<Array<{ id: number; name: string; code: string; city: string | null }> | null>(null);
  const openMove = async () => {
    setMove({ warehouseId: null, reason: "" });
    setMoveError({});
    if (sites) return;
    const r = await api<{ warehouses: Array<{ id: number; name: string; code: string; city: string | null }> }>(
      `/inward-requests/lookups?importerId=${d.importer.id}`,
      { method: "GET" },
    );
    if (r.ok) setSites(r.data.warehouses);
    else toast.error(r.error.message);
  };

  const run = async (path: string, init: { method?: string; body?: unknown }) => {
    setBusy(true);
    const r = await api<Detail>(path, init);
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error.message);
      return false;
    }
    setD(r.data);
    router.refresh();
    return true;
  };

  const decide = (action: string, extra: Record<string, unknown> = {}) =>
    run(`/inward-requests/${d.id}/decision`, { body: { action, ...extra } });

  const timeline: Array<{ label: string; at: string | null; by: string | null; done: boolean }> = [
    { label: "Created", at: d.createdAt, by: d.people.createdBy, done: true },
    { label: "Submitted", at: d.submittedAt, by: d.people.submittedBy, done: d.submittedAt !== null },
    ...(d.status === "NEEDS_CHANGES" ? [{ label: "Sent back", at: d.lastStatusAt, by: null, done: true }] : []),
    { label: "Acknowledged", at: d.acknowledgedAt, by: d.people.acknowledgedBy, done: d.acknowledgedAt !== null },
    { label: "In process", at: d.status === "IN_PROCESS" ? d.lastStatusAt : null, by: null, done: d.status === "IN_PROCESS" || d.status === "COMPLETED" },
    { label: "Completed", at: d.completedAt, by: d.people.completedBy, done: d.completedAt !== null },
    ...(d.status === "CANCELLED" ? [{ label: "Cancelled", at: d.cancelledAt, by: d.people.cancelledBy, done: true }] : []),
  ];
  // Moves sit in time order among the steps that have happened.
  for (const m of d.moves) {
    const at = new Date(m.at).getTime();
    const i = timeline.findIndex((e) => !e.done || (e.at !== null && new Date(e.at).getTime() > at));
    timeline.splice(i === -1 ? timeline.length : i, 0, {
      label: `Moved to ${m.to}`,
      at: m.at,
      by: [m.by, `from ${m.from}`, m.reason].filter(Boolean).join(" · "),
      done: true,
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-6">
        {d.status === "NEEDS_CHANGES" && d.needsChangesNote ? (
          <Card className="border-rose-400/30 p-4">
            <p className="text-sm text-verdigris-50">
              <span className="font-semibold text-rose-300">Sent back by {d.warehouse.name}:</span> {d.needsChangesNote}
            </p>
          </Card>
        ) : null}

        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-2xl font-semibold text-verdigris-50">{d.containerNumber ?? "No container number yet"}</p>
              <p className="mt-1 text-sm text-verdigris-200/60">
                {d.code} · {d.importer.name} → {d.warehouse.name} ({d.warehouse.code})
              </p>
            </div>
            <StatusBadge value={d.status} />
          </div>
          <div className="mt-5 grid gap-6 sm:grid-cols-2">
            <Facts
              items={[
                { label: "Container type", value: d.containerType?.name ?? "—" },
                { label: "Port", value: d.port?.name ?? "—" },
                { label: "Expected arrival", value: d.expectedArrival ?? "—" },
                { label: "Remarks", value: d.remarks ?? "—" },
              ]}
            />
            <Facts
              items={[
                { label: "Transporter", value: d.transporter ? `${d.transporter.name}${d.transporter.mobile ? ` · +91 ${d.transporter.mobile}` : ""}` : "—" },
                { label: "Vehicle", value: d.vehicle ? `${d.vehicle.registrationNumber}${d.vehicle.typeName ? ` · ${d.vehicle.typeName}` : ""}` : "—" },
                { label: "Driver", value: d.driver ? `${d.driver.name}${d.driver.mobile ? ` · +91 ${d.driver.mobile}` : ""}` : "—" },
                { label: "Licence", value: d.driver?.licenceNumber ?? "—" },
              ]}
            />
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4">
            <h2 className="text-base font-semibold text-verdigris-50">Goods</h2>
            <p className="text-xs text-verdigris-200/55">
              {fmt(d.totals.cartons)} cartons · {fmt(d.totals.pieces)} pieces · {fmt(d.totals.kg)} kg
            </p>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-900/50 text-left text-[11px] uppercase tracking-[0.1em] text-verdigris-300">
                <tr>
                  <th className="px-5 py-2">#</th>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Cartons</th>
                  <th className="px-3 py-2 text-right">Pcs / ctn</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2 text-right">Pieces</th>
                  <th className="px-3 py-2 text-right">Kg / ctn</th>
                  <th className="px-5 py-2 text-right">Kg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-verdigris-300/10">
                {d.items.map((l, i) => (
                  <tr key={l.id}>
                    <td className="px-5 py-2 text-verdigris-200/50">{i + 1}</td>
                    <td className="px-3 py-2 text-verdigris-50">
                      <span className="flex items-center gap-2">
                        {l.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={l.imageUrl} alt="" className="h-8 w-8 rounded-md object-cover" />
                        ) : null}
                        <span>
                          {l.itemCode ? <span className="font-mono text-verdigris-200/60">{l.itemCode} · </span> : null}
                          {l.description}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-verdigris-100">{fmt(l.cartonQty)}</td>
                    <td className="px-3 py-2 text-right font-mono text-verdigris-100">{fmt(l.piecesPerCarton)}</td>
                    <td className="px-3 py-2 text-verdigris-100">{l.unitCode ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-verdigris-50">{fmt(l.totalPieces)}</td>
                    <td className="px-3 py-2 text-right font-mono text-verdigris-100">{fmt(l.kgPerCarton)}</td>
                    <td className="px-5 py-2 text-right font-mono text-verdigris-50">{fmt(l.totalKg)}</td>
                  </tr>
                ))}
                {d.items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-6 text-center text-verdigris-200/50">
                      No goods listed.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        {d.cartons.view ? (
          <CartonsPanel
            key={d.status}
            requestId={d.id}
            onChanged={async () => {
              const r = await api<Detail>(`/inward-requests/${d.id}`, { method: "GET" });
              if (r.ok) setD(r.data);
              router.refresh();
            }}
          />
        ) : null}

        {d.documents.length ? (
          <Card className="p-5">
            <h2 className="text-base font-semibold text-verdigris-50">Documents</h2>
            <ul className="mt-3 divide-y divide-verdigris-300/10">
              {d.documents.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <a href={doc.url} target="_blank" rel="noreferrer" className="truncate text-verdigris-100 hover:text-patina">
                    {doc.originalName ?? doc.contentType}
                  </a>
                  <span className="shrink-0 text-xs text-verdigris-200/45">
                    {doc.bytes >= 1048576 ? `${(doc.bytes / 1048576).toFixed(1)} MB` : `${Math.round(doc.bytes / 1024)} KB`}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Actions</p>
          <div className="mt-3 flex flex-col gap-2">
            {d.can.edit ? (
              <Link href={`/admin/inward/${d.id}/edit`} className={`${secondary} text-center`}>
                Edit
              </Link>
            ) : null}
            {d.can.submit ? (
              <button type="button" disabled={busy} onClick={() => run(`/inward-requests/${d.id}/submit`, {})} className={primary}>
                Submit to warehouse
              </button>
            ) : null}
            {d.can.acknowledge ? (
              <button type="button" disabled={busy} onClick={() => decide("ACKNOWLEDGE")} className={primary}>
                Acknowledge
              </button>
            ) : null}
            {d.can.in_process ? (
              <button type="button" disabled={busy} onClick={() => decide("IN_PROCESS")} className={primary}>
                Mark in process
              </button>
            ) : null}
            {d.can.complete ? (
              <button type="button" disabled={busy} onClick={() => setConfirm("complete")} className={primary}>
                Mark completed
              </button>
            ) : null}
            {d.can.needs_changes ? (
              <button type="button" disabled={busy} onClick={() => setNote("")} className={danger}>
                Needs changes
              </button>
            ) : null}
            {d.can.move ? (
              <button type="button" id="inward-move" disabled={busy} onClick={() => void openMove()} className={secondary}>
                Move to another warehouse
              </button>
            ) : null}
            {d.can.cancel ? (
              <button type="button" disabled={busy} onClick={() => setConfirm("cancel")} className={danger}>
                Cancel request
              </button>
            ) : null}
            {!d.can.edit && !d.can.submit && !d.can.acknowledge && !d.can.in_process && !d.can.complete && !d.can.needs_changes && !d.can.cancel && !d.can.move ? (
              <p className="text-xs text-verdigris-200/50">Nothing to do from here.</p>
            ) : null}
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Timeline</p>
          <ol className="mt-3 space-y-2.5">
            {timeline.map((e) => (
              <li key={e.label} className="flex gap-3 text-sm">
                <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border ${e.done ? "border-patina bg-patina/40" : "border-verdigris-300/25"}`} />
                <span>
                  <span className={e.done ? "text-verdigris-50" : "text-verdigris-200/40"}>{e.label}</span>
                  {e.done && (e.at || e.by) ? (
                    <span className="block text-xs text-verdigris-200/50">{[when(e.at), e.by].filter(Boolean).join(" · ")}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </aside>

      {confirm ? (
        <ConfirmDialog
          title={confirm === "cancel" ? `Cancel ${d.code}?` : `Mark ${d.code} completed?`}
          message={
            confirm === "cancel"
              ? d.status === "DRAFT"
                ? "The draft is kept, marked cancelled."
                : "The warehouse will be told it is withdrawn."
              : "The importer is told the goods are in. Verification and labels come next."
          }
          confirmLabel={confirm === "cancel" ? "Cancel request" : "Complete"}
          tone={confirm === "cancel" ? "danger" : "warn"}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const ok =
              confirm === "cancel"
                ? await run(`/inward-requests/${d.id}`, { method: "DELETE" })
                : await decide("COMPLETE");
            if (ok) setConfirm(null);
          }}
        />
      ) : null}

      {move !== null ? (
        <ConfirmDialog
          title={`Move ${d.code} to another warehouse`}
          busy={busy}
          message={
            <>
              Now going to <span className="font-semibold">{d.warehouse.name}</span>. The new warehouse confirms it again; the
              importer and both warehouses are told.
            </>
          }
          confirmLabel="Move"
          tone="warn"
          onCancel={() => setMove(null)}
          onConfirm={async () => {
            const errs: Record<string, string> = {};
            if (!move.warehouseId) errs.warehouseId = "Choose the new warehouse";
            if (move.reason.trim().length < 3) errs.reason = "Say why it is moving";
            setMoveError(errs);
            if (Object.keys(errs).length) return;
            setBusy(true);
            const r = await api<Detail>(`/inward-requests/${d.id}/move`, {
              body: { warehouseId: move.warehouseId, reason: move.reason.trim() },
            });
            setBusy(false);
            if (!r.ok) {
              setMoveError(r.error.fields ?? {});
              toast.error(r.error.message);
              return;
            }
            setD(r.data);
            setMove(null);
            toast.success(`${r.data.code} now goes to ${r.data.warehouse.name}.`);
            router.refresh();
          }}
        >
          <label htmlFor="move-warehouse" className="mt-4 mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-verdigris-300">
            New warehouse
          </label>
          <select
            id="move-warehouse"
            autoFocus
            value={move.warehouseId ?? ""}
            onChange={(e) => {
              setMove({ ...move, warehouseId: e.target.value ? Number(e.target.value) : null });
              setMoveError((x) => ({ ...x, warehouseId: "" }));
            }}
            className="w-full rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 focus:outline-none focus:ring-2 focus:ring-patina/40"
          >
            <option value="">{sites ? "Choose…" : "Loading…"}</option>
            {(sites ?? [])
              .filter((w) => w.id !== d.warehouse.id)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.city ? ` · ${w.city}` : ""}
                </option>
              ))}
          </select>
          {moveError.warehouseId ? <p className="mt-1 text-xs text-rose-300">{moveError.warehouseId}</p> : null}
          <p className="mt-4 mb-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-verdigris-300">Reason</p>
          <div className="flex flex-wrap gap-1.5">
            {["No storage space", "Closer to the port", "Importer asked"].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setMove({ ...move, reason: r });
                  setMoveError((x) => ({ ...x, reason: "" }));
                }}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${
                  move.reason === r
                    ? "border-patina bg-patina/15 text-patina"
                    : "border-verdigris-300/20 text-verdigris-200/70 hover:border-patina/50 hover:text-patina"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <input
            id="move-reason"
            value={move.reason}
            onChange={(e) => {
              setMove({ ...move, reason: e.target.value });
              setMoveError((x) => ({ ...x, reason: "" }));
            }}
            placeholder="Or type the reason"
            className="mt-2 w-full rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40"
          />
          {moveError.reason ? <p className="mt-1 text-xs text-rose-300">{moveError.reason}</p> : null}
        </ConfirmDialog>
      ) : null}

      {note !== null ? (
        <ConfirmDialog
          title="What needs to change?"
          message="Tell the importer exactly what to fix. They get this note by email and in the app."
          confirmLabel="Send back"
          tone="warn"
          busy={busy}
          onCancel={() => setNote(null)}
          onConfirm={async () => {
            if (note.trim().length < 3) {
              setNoteError("Say what needs to change");
              return;
            }
            const ok = await decide("NEEDS_CHANGES", { note: note.trim() });
            if (ok) setNote(null);
          }}
        >
          <textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setNoteError(null);
            }}
            rows={3}
            autoFocus
            className="mt-4 w-full rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40"
            placeholder="e.g. Container number does not match the bill of lading"
          />
          {noteError ? <p className="mt-1 text-xs text-rose-300">{noteError}</p> : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
