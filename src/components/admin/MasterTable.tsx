"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { EyeIcon, PencilIcon, PowerIcon, TrashIcon, XIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";
import type { ListState } from "@/lib/admin/listing";
import type { MasterField } from "@/lib/admin/master-registry";

import DataTable, {
  SelectAllHeader,
  SelectRowCell,
  Switch,
  type ColumnMeta,
} from "./DataTable";
import { Card, IconButton, StatusBadge } from "./ui";

/**
 * The master-data table: one component, five screens, on DataTable.
 *
 * Only the plain field metadata crosses from the server; the Zod schemas
 * in the registry stay there, where they are the thing that decides
 * what is valid. What is here is the shape of the form and the table.
 *
 * Editing moved out of the row and into a drawer. Inline editing and
 * multi-select fight over the same row — a checkbox next to an input
 * you are typing into is a click away from a bulk action — and a
 * drawer gives a vehicle type's nine fields room to breathe.
 */

export type MasterRow = {
  id: number;
  isActive: boolean;
  /** How many rows elsewhere point at this one, in total. */
  inUse: number;
  /** "3 cities, 1 warehouse" — for the view drawer and delete refusal. */
  inUseDetail: string;
  parentId?: number | null;
  parentLabel?: string | null;
  values: Record<string, string | number | null>;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ParentOption = { id: number; label: string; groupId?: number; groupLabel?: string };

export type MasterSpec = {
  slug: string;
  label: string;
  singular: string;
  fields: MasterField[];
  parent?: {
    key: string;
    label: string;
    options: ParentOption[];
    /** "Country" when the options are grouped one level up. */
    groupLabel?: string;
  } | null;
  dependentNoun: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  /** Create takes many names at once (cities). See the registry. */
  bulkCreate?: { endpoint: string; label: string; hint: string; placeholder: string } | null;
};

/** Split a pasted list: one per line, or comma separated — people paste both. */
export function splitNames(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

type Draft = Record<string, string>;
type Drawer =
  | { mode: "view"; row: MasterRow }
  | { mode: "edit"; row: MasterRow }
  | { mode: "create" }
  | null;
type Confirm =
  | { kind: "delete"; ids: number[]; label: string }
  | { kind: "deactivate-in-use"; row: MasterRow; message: string }
  | null;

const asDraft = (row: MasterRow | null, spec: MasterSpec): Draft => {
  const d: Draft = {};
  for (const f of spec.fields) {
    const v = row?.values[f.key];
    d[f.key] = v === null || v === undefined ? "" : String(v);
  }
  if (spec.parent) d[spec.parent.key] = row?.parentId ? String(row.parentId) : "";
  return d;
};

/** Only send what the user actually typed; `""` means "leave it out",
 *  which is what the server's optional() preprocessing expects. */
function payload(draft: Draft, spec: MasterSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of spec.fields) {
    const raw = draft[field.key] ?? "";
    if (raw === "") continue;
    out[field.key] = field.type === "number" ? Number(raw) : raw;
  }
  if (spec.parent && draft[spec.parent.key]) out[spec.parent.key] = Number(draft[spec.parent.key]);
  return out;
}

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      })
    : "—";

export default function MasterTable({
  spec,
  rows,
  list,
  base,
  filters,
}: {
  spec: MasterSpec;
  rows: MasterRow[];
  list: ListState;
  base: string;
  filters?: React.ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();

  const [drawer, setDrawer] = useState<Drawer>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<number | "drawer" | "bulk" | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const rowLabel = (row: MasterRow) =>
    String(row.values[spec.fields.find((f) => f.key === "name")?.key ?? spec.fields[0]!.key] ?? spec.singular);

  const openView = (row: MasterRow) => { setErrors({}); setDrawer({ mode: "view", row }); };
  const openEdit = (row: MasterRow) => { setErrors({}); setDraft(asDraft(row, spec)); setDrawer({ mode: "edit", row }); };
  const openCreate = () => { setErrors({}); setDraft(asDraft(null, spec)); setDrawer({ mode: "create" }); };
  const close = () => { setDrawer(null); setErrors({}); };

  async function save() {
    if (!drawer || drawer.mode === "view") return;
    setBusy("drawer");
    setErrors({});
    const body = payload(draft, spec);
    if (spec.parent && drawer.mode === "create" && !body[spec.parent.key]) {
      setBusy(null);
      setErrors({ [spec.parent.key]: `Choose a ${spec.parent.label.toLowerCase()}` });
      return;
    }

    // Many at once: the textarea, split, to the bulk endpoint.
    if (drawer.mode === "create" && spec.bulkCreate && spec.parent) {
      const names = splitNames(draft.__bulk ?? "");
      if (names.length === 0) {
        setBusy(null);
        setErrors({ __bulk: `Enter at least one ${spec.singular}` });
        return;
      }
      const result = await api<{ created: number; skipped: string[] }>(spec.bulkCreate.endpoint, {
        body: { [spec.parent.key]: body[spec.parent.key], names },
      });
      setBusy(null);
      if (!result.ok) {
        if (result.error.fields) setErrors(result.error.fields);
        toast.error(result.error.message);
        return;
      }
      const { created, skipped } = result.data;
      if (created === 0) {
        toast.info("Nothing added — all of those already exist there.");
      } else if (skipped.length > 0) {
        toast.success(
          `Added ${created}. Skipped ${skipped.length} already there: ${skipped.slice(0, 3).join(", ")}${skipped.length > 3 ? "…" : ""}`,
        );
      } else {
        toast.success(`Added ${created} ${created === 1 ? spec.singular : spec.label.toLowerCase()}.`);
      }
      close();
      router.refresh();
      return;
    }

    const result =
      drawer.mode === "create"
        ? await api<{ id: number }>(`/admin/master/${spec.slug}`, { body })
        : await api<{ ok: true }>(`/admin/master/${spec.slug}?id=${drawer.row.id}`, {
            method: "PATCH",
            body,
          });
    setBusy(null);
    if (!result.ok) {
      if (result.error.fields) setErrors(result.error.fields);
      toast.error(result.error.message);
      return;
    }
    toast.success(drawer.mode === "create" ? `${cap(spec.singular)} added.` : "Saved.");
    close();
    router.refresh();
  }

  async function toggle(row: MasterRow, force = false) {
    setBusy(row.id);
    const result = await api<{ ok: true }>(
      `/admin/master/${spec.slug}?id=${row.id}${force ? "&force=true" : ""}`,
      { method: "PATCH", body: { isActive: !row.isActive } },
    );
    setBusy(null);
    if (!result.ok) {
      // The server counts what depends on the row and refuses the first
      // time. Not an error to shout about — a question to ask.
      if (result.error.code === "CONFLICT") {
        setConfirm({ kind: "deactivate-in-use", row, message: result.error.message });
        return;
      }
      toast.error(result.error.message);
      return;
    }
    toast.success(row.isActive ? "Deactivated." : "Activated.");
    setConfirm(null);
    router.refresh();
  }

  async function remove(ids: number[]) {
    setBusy("bulk");
    if (ids.length === 1) {
      const result = await api<{ ok: true }>(`/admin/master/${spec.slug}?id=${ids[0]}`, {
        method: "DELETE",
      });
      setBusy(null);
      setConfirm(null);
      if (!result.ok) { toast.error(result.error.message); return; }
      toast.success(`${cap(spec.singular)} deleted.`);
      close();
      router.refresh();
      return;
    }
    await bulk("delete", ids);
    setConfirm(null);
  }

  async function bulk(action: "activate" | "deactivate" | "delete", ids: number[]) {
    setBusy("bulk");
    const result = await api<{
      done: number[];
      skipped: { id: number; reason: string }[];
      notes: { id: number; note: string }[];
    }>(`/admin/master/${spec.slug}/bulk`, { body: { action, ids } });
    setBusy(null);
    if (!result.ok) { toast.error(result.error.message); return; }
    const { done, skipped, notes } = result.data;
    const verb = action === "delete" ? "Deleted" : action === "activate" ? "Activated" : "Deactivated";
    const parts = [`${verb} ${done.length}.`];
    if (skipped.length) parts.push(`Skipped ${skipped.length} — ${skipped[0]!.reason}${skipped.length > 1 ? " and more" : ""}.`);
    if (notes.length) parts.push(`${notes.length} still in use elsewhere.`);
    (skipped.length && !done.length ? toast.error : toast.success)(parts.join(" "));
    router.refresh();
  }

  const columns = useMemo<ColumnDef<MasterRow, unknown>[]>(() => {
    const cols: ColumnDef<MasterRow, unknown>[] = [];

    if (spec.canUpdate || spec.canDelete) {
      cols.push({
        id: "select",
        enableSorting: false,
        header: ({ table }) => <SelectAllHeader table={table} />,
        cell: ({ row }) => <SelectRowCell row={row} label={rowLabel(row.original)} />,
        meta: { width: 2.5 } satisfies ColumnMeta,
      });
    }

    if (spec.parent) {
      cols.push({
        id: "parent",
        accessorFn: (r) => r.parentLabel ?? "",
        header: spec.parent.label,
        cell: ({ row }) => (
          <span className="text-verdigris-200/60">{row.original.parentLabel ?? "—"}</span>
        ),
      });
    }

    for (const f of spec.fields) {
      cols.push({
        id: f.key,
        accessorFn: (r) => r.values[f.key],
        header: f.label,
        meta: { align: f.align, mono: f.mono, width: f.width } satisfies ColumnMeta,
        cell: ({ row }) => {
          const v = row.original.values[f.key];
          if (f.type === "select" && v !== null && v !== undefined) {
            return (
              <span className="rounded-full border border-verdigris-300/20 px-2.5 py-0.5 text-[11px] text-verdigris-200">
                {String(v).toLowerCase().replace(/_/g, " ")}
              </span>
            );
          }
          return v === null || v === undefined || v === "" ? "—" : String(v);
        },
      });
    }

    cols.push({
      id: "inUse",
      accessorFn: (r) => r.inUse,
      header: "In use",
      enableSorting: false,
      meta: { className: "whitespace-nowrap text-xs text-verdigris-200/50" } satisfies ColumnMeta,
      cell: ({ row }) =>
        row.original.inUse > 0 ? row.original.inUseDetail || `${row.original.inUse} ${spec.dependentNoun}` : "—",
    });

    cols.push({
      id: "status",
      accessorFn: (r) => r.isActive,
      header: "Active",
      cell: ({ row }) =>
        spec.canUpdate ? (
          <Switch
            checked={row.original.isActive}
            busy={busy === row.original.id}
            label={row.original.isActive ? `Deactivate ${rowLabel(row.original)}` : `Activate ${rowLabel(row.original)}`}
            onChange={() => toggle(row.original)}
          />
        ) : (
          <StatusBadge value={row.original.isActive ? "ACTIVE" : "CLOSED"} />
        ),
    });

    cols.push({
      id: "actions",
      header: "",
      enableSorting: false,
      meta: { className: "whitespace-nowrap text-right" } satisfies ColumnMeta,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <span className="inline-flex items-center gap-1.5">
            <IconButton label={`View ${rowLabel(r)}`} onClick={() => openView(r)} icon={<EyeIcon className="h-4 w-4" />} />
            {spec.canUpdate ? (
              <IconButton label={`Edit ${rowLabel(r)}`} onClick={() => openEdit(r)} icon={<PencilIcon className="h-4 w-4" />} />
            ) : null}
            {spec.canDelete ? (
              <IconButton
                label={r.inUse > 0 ? `Cannot delete — ${r.inUseDetail} still use it` : `Delete ${rowLabel(r)}`}
                tone="danger"
                disabled={r.inUse > 0}
                onClick={() => setConfirm({ kind: "delete", ids: [r.id], label: rowLabel(r) })}
                icon={<TrashIcon className="h-4 w-4" />}
              />
            ) : null}
          </span>
        );
      },
    });

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, busy]);

  const filtered = list.q !== "" || list.status !== "all" || Object.keys(list.extra).length > 0;

  return (
    <>
      <Card>
        <DataTable<MasterRow>
          columns={columns}
          data={rows}
          list={list}
          base={base}
          label={spec.label.toLowerCase()}
          filters={filters}
          enableSelection={spec.canUpdate || spec.canDelete}
          emptyTitle={filtered ? "Nothing matches that search." : `No ${spec.label.toLowerCase()} yet.`}
          rowClassName={(row) => (row.original.isActive ? "" : "opacity-60")}
          action={
            spec.canCreate ? (
              <button
                type="button"
                onClick={openCreate}
                className="rounded-lg bg-verdigris-400 px-4 py-1.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina"
              >
                Add {spec.singular}
              </button>
            ) : null
          }
          bulk={(selected, clear) => {
            const ids = selected.map((r) => r.id);
            const deletable = selected.filter((r) => r.inUse === 0).map((r) => r.id);
            const b = "rounded-lg border px-3 py-1 text-xs transition-colors disabled:opacity-40";
            return (
              <>
                {spec.canUpdate ? (
                  <>
                    <button type="button" disabled={busy === "bulk"} onClick={() => bulk("activate", ids).then(clear)}
                      className={`${b} border-verdigris-300/25 text-verdigris-100 hover:border-verdigris-300/50`}>
                      Activate
                    </button>
                    <button type="button" disabled={busy === "bulk"} onClick={() => bulk("deactivate", ids).then(clear)}
                      className={`${b} border-verdigris-300/25 text-verdigris-100 hover:border-verdigris-300/50`}>
                      Deactivate
                    </button>
                  </>
                ) : null}
                {spec.canDelete ? (
                  <button type="button" disabled={busy === "bulk" || deletable.length === 0}
                    title={deletable.length < ids.length ? `${ids.length - deletable.length} of these are in use and will be skipped` : undefined}
                    onClick={() => setConfirm({ kind: "delete", ids: deletable, label: `${deletable.length} ${deletable.length === 1 ? spec.singular : spec.label.toLowerCase()}` })}
                    className={`${b} border-rose-400/30 text-rose-200 hover:border-rose-400/60`}>
                    Delete{deletable.length < ids.length ? ` ${deletable.length} of ${ids.length}` : ""}
                  </button>
                ) : null}
                {busy === "bulk" ? <Spinner className="h-3.5 w-3.5" /> : null}
              </>
            );
          }}
        />

        {confirm?.kind === "deactivate-in-use" ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 border-t border-amber-400/25 bg-amber-500/[0.07] px-5 py-3 text-[13px] text-amber-100">
            <span className="flex-1">{confirm.message}</span>
            <IconButton label="Deactivate anyway" tone="danger" busy={busy === confirm.row.id}
              onClick={() => toggle(confirm.row, true)} icon={<PowerIcon className="h-4 w-4" />} />
            <IconButton label="Keep it active" onClick={() => setConfirm(null)} icon={<XIcon className="h-4 w-4" />} />
          </div>
        ) : null}

        {confirm?.kind === "delete" ? (
          <div role="alertdialog" aria-label="Confirm delete"
            className="flex flex-wrap items-center gap-3 border-t border-rose-400/25 bg-rose-500/[0.07] px-5 py-3 text-[13px] text-rose-100">
            <span className="flex-1">
              Delete {confirm.label}? This cannot be undone; the audit log keeps a copy of the values.
            </span>
            <button type="button" disabled={busy === "bulk"} onClick={() => remove(confirm.ids)}
              className="rounded-lg bg-rose-500/80 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-500">
              {busy === "bulk" ? "Deleting…" : "Delete"}
            </button>
            <button type="button" onClick={() => setConfirm(null)}
              className="rounded-lg border border-verdigris-300/20 px-3 py-1 text-xs text-verdigris-100 hover:border-verdigris-300/45">
              Cancel
            </button>
          </div>
        ) : null}
      </Card>

      {drawer ? (
        <MasterDrawer
          spec={spec}
          drawer={drawer}
          draft={draft}
          setDraft={setDraft}
          errors={errors}
          busy={busy === "drawer"}
          onClose={close}
          onSave={save}
          onEdit={(row) => openEdit(row)}
          onDelete={(row) => setConfirm({ kind: "delete", ids: [row.id], label: rowLabel(row) })}
        />
      ) : null}
    </>
  );
}

const cap = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;

// ── drawer ────────────────────────────────────────────────────────

function MasterDrawer({
  spec, drawer, draft, setDraft, errors, busy, onClose, onSave, onEdit, onDelete,
}: {
  spec: MasterSpec;
  drawer: NonNullable<Drawer>;
  draft: Draft;
  setDraft: (d: Draft) => void;
  errors: Record<string, string>;
  busy: boolean;
  onClose: () => void;
  onSave: () => void;
  onEdit: (row: MasterRow) => void;
  onDelete: (row: MasterRow) => void;
}) {
  const view = drawer.mode === "view";
  const row = drawer.mode === "create" ? null : drawer.row;

  /**
   * The parent picker narrowed one level up — a city's state chosen from
   * a country first. Local state only: which group is showing. The
   * value that is saved is still the parent id.
   */
  const grouped = Boolean(spec.parent?.groupLabel);
  const groups = grouped
    ? [...new Map((spec.parent?.options ?? []).map((o) => [o.groupId, o.groupLabel])).entries()]
    : [];
  const currentParent = spec.parent
    ? spec.parent.options.find((o) =>
        view ? o.id === row?.parentId : String(o.id) === (draft[spec.parent!.key] ?? ""),
      )
    : undefined;
  const [group, setGroup] = useState<string>(
    currentParent?.groupId !== undefined
      ? String(currentParent.groupId)
      : groups.length === 1
        ? String(groups[0]![0])
        : "",
  );
  const parentChoices = grouped
    ? (spec.parent?.options ?? []).filter((o) => String(o.groupId) === group)
    : (spec.parent?.options ?? []);
  const title =
    drawer.mode === "create"
      ? `Add ${spec.bulkCreate ? spec.label.toLowerCase() : spec.singular}`
      : drawer.mode === "edit"
        ? `Edit ${spec.singular}`
        : cap(spec.singular);

  const input =
    "mt-1 w-full rounded-lg border bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40";
  const tone = (k: string) => (errors[k] ? "border-rose-400/50" : "border-verdigris-300/15");

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="flex-1 bg-ink-900/70" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex h-full w-full max-w-md flex-col border-l border-verdigris-300/10 bg-ink-850 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-verdigris-300/10 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-verdigris-50">{title}</h2>
            {row ? (
              <p className="mt-0.5 font-mono text-[11px] text-verdigris-200/45">id {row.id}</p>
            ) : null}
          </div>
          <IconButton label="Close" onClick={onClose} icon={<XIcon className="h-4 w-4" />} />
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <form
            id="master-drawer-form"
            onSubmit={(e) => { e.preventDefault(); if (!view) onSave(); }}
            className="space-y-4"
          >
            {spec.parent && grouped && !view ? (
              <div>
                <label htmlFor="f-group" className="text-[12px] font-medium text-verdigris-200/70">
                  {spec.parent.groupLabel}
                </label>
                <select
                  id="f-group"
                  value={group}
                  onChange={(e) => {
                    setGroup(e.target.value);
                    // A different country means the chosen state no longer applies.
                    setDraft({ ...draft, [spec.parent!.key]: "" });
                  }}
                  className={`${input} border-verdigris-300/15`}
                >
                  <option value="" className="bg-ink-850">Choose</option>
                  {groups.map(([gid, glabel]) => (
                    <option key={String(gid)} value={String(gid)} className="bg-ink-850">{glabel}</option>
                  ))}
                </select>
              </div>
            ) : null}

            {spec.parent ? (
              <div>
                <label htmlFor="f-parent" className="text-[12px] font-medium text-verdigris-200/70">
                  {spec.parent.label}
                </label>
                {view ? (
                  <p className="mt-1 text-sm text-verdigris-50">
                    {row?.parentLabel ?? "—"}
                    {grouped && currentParent?.groupLabel ? (
                      <span className="text-verdigris-200/50">, {currentParent.groupLabel}</span>
                    ) : null}
                  </p>
                ) : (
                  <select
                    id="f-parent"
                    value={draft[spec.parent.key] ?? ""}
                    disabled={grouped && !group}
                    onChange={(e) => setDraft({ ...draft, [spec.parent!.key]: e.target.value })}
                    className={`${input} ${tone(spec.parent.key)} disabled:opacity-50`}
                  >
                    <option value="" className="bg-ink-850">
                      {grouped && !group ? `Choose a ${spec.parent.groupLabel?.toLowerCase()} first` : "Choose"}
                    </option>
                    {parentChoices.map((o) => (
                      <option key={o.id} value={o.id} className="bg-ink-850">{o.label}</option>
                    ))}
                  </select>
                )}
                {errors[spec.parent.key] ? <p className="mt-1 text-xs text-rose-300">{errors[spec.parent.key]}</p> : null}
              </div>
            ) : null}

            {drawer.mode === "create" && spec.bulkCreate ? (
              <div>
                <label htmlFor="f-bulk" className="text-[12px] font-medium text-verdigris-200/70">
                  {spec.bulkCreate.label} *
                </label>
                <textarea
                  id="f-bulk"
                  rows={9}
                  value={draft.__bulk ?? ""}
                  placeholder={spec.bulkCreate.placeholder}
                  onChange={(e) => setDraft({ ...draft, __bulk: e.target.value })}
                  className={`${input} ${tone("__bulk")}`}
                />
                <p className="mt-1 text-xs text-verdigris-200/50" aria-live="polite">
                  {(() => {
                    const n = splitNames(draft.__bulk ?? "").length;
                    return n === 0
                      ? spec.bulkCreate.hint
                      : `${n} ${n === 1 ? "name" : "names"} ready. ${spec.bulkCreate.hint}`;
                  })()}
                </p>
                {errors.__bulk ? <p className="mt-1 text-xs text-rose-300">{errors.__bulk}</p> : null}
              </div>
            ) : null}

            {spec.fields.map((f) => (drawer.mode === "create" && spec.bulkCreate ? null : (
              <div key={f.key}>
                <label htmlFor={`f-${f.key}`} className="text-[12px] font-medium text-verdigris-200/70">
                  {f.label}{f.required && !view ? " *" : ""}
                </label>
                {view ? (
                  <p className={`mt-1 text-sm text-verdigris-50 ${f.mono ? "font-mono" : ""}`}>
                    {row?.values[f.key] === null || row?.values[f.key] === undefined || row?.values[f.key] === ""
                      ? "—"
                      : f.type === "select"
                        ? String(row.values[f.key]).toLowerCase().replace(/_/g, " ")
                        : String(row!.values[f.key])}
                  </p>
                ) : f.type === "select" ? (
                  <select
                    id={`f-${f.key}`}
                    value={draft[f.key] ?? ""}
                    onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                    className={`${input} ${tone(f.key)}`}
                  >
                    <option value="" className="bg-ink-850">Choose</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o} value={o} className="bg-ink-850">{o.toLowerCase().replace(/_/g, " ")}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`f-${f.key}`}
                    type="text"
                    inputMode={f.type === "number" ? "decimal" : undefined}
                    value={draft[f.key] ?? ""}
                    placeholder={f.hint}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        [f.key]: f.type === "number" ? e.target.value.replace(/[^\d.]/g, "") : e.target.value,
                      })
                    }
                    className={`${input} ${tone(f.key)} ${f.mono ? "font-mono" : ""}`}
                  />
                )}
                {errors[f.key] ? <p className="mt-1 text-xs text-rose-300">{errors[f.key]}</p> : null}
              </div>
            )))}
          </form>

          {view && row ? (
            <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-verdigris-300/10 pt-5 text-sm">
              <dt className="text-[12px] text-verdigris-200/60">Status</dt>
              <dd><StatusBadge value={row.isActive ? "ACTIVE" : "CLOSED"} /></dd>
              <dt className="text-[12px] text-verdigris-200/60">In use</dt>
              <dd className="text-verdigris-100">{row.inUse > 0 ? row.inUseDetail : "Not referenced anywhere"}</dd>
              <dt className="text-[12px] text-verdigris-200/60">Created</dt>
              <dd className="text-verdigris-100">{fmtDate(row.createdAt)}</dd>
              <dt className="text-[12px] text-verdigris-200/60">Updated</dt>
              <dd className="text-verdigris-100">{fmtDate(row.updatedAt)}</dd>
            </dl>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-verdigris-300/10 px-6 py-4">
          {view && row ? (
            <>
              {spec.canDelete ? (
                <button type="button" disabled={row.inUse > 0}
                  title={row.inUse > 0 ? `${row.inUseDetail} still use it` : undefined}
                  onClick={() => onDelete(row)}
                  className="mr-auto inline-flex items-center gap-1.5 rounded-lg border border-rose-400/30 px-3 py-2 text-sm text-rose-200 hover:border-rose-400/60 disabled:opacity-40">
                  <TrashIcon className="h-4 w-4" /> Delete
                </button>
              ) : null}
              <button type="button" onClick={onClose}
                className="rounded-lg border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45">
                Close
              </button>
              {spec.canUpdate ? (
                <button type="button" onClick={() => onEdit(row)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-patina">
                  <PencilIcon className="h-4 w-4" /> Edit
                </button>
              ) : null}
            </>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={busy}
                className="rounded-lg border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45">
                Cancel
              </button>
              <button type="submit" form="master-drawer-form" disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-patina disabled:opacity-60">
                {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
                {drawer.mode === "create"
                  ? spec.bulkCreate
                    ? `Add ${spec.label.toLowerCase()}`
                    : `Add ${spec.singular}`
                  : "Save changes"}
              </button>
            </>
          )}
        </footer>
      </aside>
    </div>
  );
}
