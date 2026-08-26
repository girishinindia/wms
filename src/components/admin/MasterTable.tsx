"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { EyeIcon, PaperclipIcon, PencilIcon, TrashIcon, XIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";
import { fmtDateTime } from "@/lib/format/datetime";
import AttachmentPanel from "./AttachmentPanel";
import { formatPaise, paiseToInput } from "@/lib/money";
import type { ListState } from "@/lib/admin/listing";
import type { MasterField } from "@/lib/admin/master-registry";

import DataTable, {
  SelectAllHeader,
  SelectRowCell,
  Switch,
  type ColumnMeta,
} from "./DataTable";
import { Card, ConfirmDialog, FactList, IconButton, StatusBadge } from "./ui";

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
  /** The second foreign key, when the resource has one — an expense's
   *  warehouse. Also what decides who sees the row. */
  scopeId?: number | null;
  scopeLabel?: string | null;
  /** Extra foreign keys — a vehicle's type — keyed by field key. */
  linkIds?: Record<string, number | null>;
  linkLabels?: Record<string, string | null>;
  /** The many-to-many the drawer edits: which warehouses a carrier
   *  serves, and a short label for the cell. */
  pivotIds?: number[];
  pivotLabel?: string | null;
  approvalStatus?: string | null;
  approvalNote?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  attachmentCount?: number;
  values: Record<string, string | number | null>;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ParentOption = { id: number; label: string; groupId?: number; groupLabel?: string };

export type MasterSpec = {
  slug: string;
  label: string;
  singular: string;
  /** What to call the rows in running text. Defaults to the lowercased
   *  label, which turns "FAQs" into "faqs" — hence the override. */
  listNoun?: string;
  fields: MasterField[];
  parent?: {
    key: string;
    label: string;
    options: ParentOption[];
    /** "Country" when the options are grouped one level up. */
    groupLabel?: string;
    /** The row can exist without one — a carrier with no city yet. */
    optional?: boolean;
  } | null;
  /** A second picker, and the row's home. See `scope` in the registry. */
  scope?: {
    key: string;
    label: string;
    options: ParentOption[];
  } | null;
  /** Present when rows need a decision. `canDecide` is about THIS
   *  viewer; the route asks the same question again. */
  approval?: { canDecide: boolean } | null;
  links?: { key: string; label: string; required: boolean; options: ParentOption[] }[];
  pivot?: {
    key: string;
    label: string;
    hint: string;
    options: ParentOption[];
    /** True when the caller cannot see every option and must pick one. */
    required: boolean;
  } | null;
  attachments?: { endpoint: string; label: string; hint: string; accept: string } | null;
  /** Delete cancels the row instead of removing it. */
  softDeleteOnly?: boolean;
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
    if (v === null || v === undefined) {
      // A new expense is dated today far more often than any other day.
      d[f.key] = f.type === "date" && !row ? new Date().toISOString().slice(0, 10) : "";
      continue;
    }
    // Stored in paise, edited in rupees.
    d[f.key] = f.type === "money" ? paiseToInput(Number(v)) : String(v);
  }
  for (const l of spec.links ?? []) {
    const current = row?.linkIds?.[l.key];
    d[l.key] = current ? String(current) : "";
  }
  if (spec.pivot) {
    // A comma-joined list of ids: `Draft` is Record<string, string>, and
    // one shape for every field keeps `payload` honest.
    d[spec.pivot.key] = (row?.pivotIds ?? []).join(",");
  }
  if (spec.parent) d[spec.parent.key] = row?.parentId ? String(row.parentId) : "";
  if (spec.scope) {
    d[spec.scope.key] = row?.scopeId
      ? String(row.scopeId)
      : // One site and it is the only one they could pick, so pick it.
        spec.scope.options.length === 1
        ? String(spec.scope.options[0]!.id)
        : "";
  }
  return d;
};

/**
 * Whether a `showWhen` field is currently switched off.
 *
 * `values` is the live draft while editing and the saved row on the
 * view panel, and both store a boolean as the STRING "true" — the draft
 * because every field is a string in one flat map, the row because it
 * arrives that way from the server. Comparing against the string is
 * therefore the honest test, not a coercion mistake.
 */
function hiddenBy(field: MasterField, values: Record<string, unknown>): boolean {
  if (!field.showWhen) return false;
  return (String(values[field.showWhen.field] ?? "") === "true") !== field.showWhen.equals;
}

/** Only send what the user actually typed; `""` means "leave it out",
 *  which is what the server's optional() preprocessing expects. */
function payload(draft: Draft, spec: MasterSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of spec.fields) {
    /**
     * A field its condition has switched off is sent EMPTY, not
     * omitted.
     *
     * Omitting it means "leave whatever is there alone", which is how a
     * carrier ends up not blacklisted with a reason still on the
     * record — the exact row that started this. Sending "" clears the
     * column. The write route does the same again server-side.
     */
    if (hiddenBy(field, draft)) {
      if (field.type === "boolean") out[field.key] = false;
      else out[field.key] = "";
      continue;
    }
    const raw = draft[field.key] ?? "";
    if (field.type === "boolean") {
      out[field.key] = raw === "true";
      continue;
    }
    if (raw === "") continue;
    // `money` stays a string on purpose: `inputToPaise` on the server is
    // the single rounding rule, and turning it into a float here would
    // put a second one in front of it.
    out[field.key] = field.type === "number" ? Number(raw) : raw;
  }
  if (spec.parent && draft[spec.parent.key]) out[spec.parent.key] = Number(draft[spec.parent.key]);
  if (spec.scope && draft[spec.scope.key]) out[spec.scope.key] = Number(draft[spec.scope.key]);
  for (const l of spec.links ?? []) {
    if (draft[l.key]) out[l.key] = Number(draft[l.key]);
  }
  if (spec.pivot) {
    // Always sent, even empty: an untouched key means "leave it alone",
    // and clearing every site has to be expressible.
    out[spec.pivot.key] = (draft[spec.pivot.key] ?? "")
      .split(",")
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0);
  }
  return out;
}

/** "21 Aug 2026" from a `YYYY-MM-DD` string, with no Date in between —
 *  see the `date` note in the registry. */
const fmtDay = (ymd: string) => {
  const [y, m, d] = ymd.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const month = months[Number(m) - 1];
  return month ? `${d} ${month} ${y}` : ymd;
};

const fmtDate = (iso: string | null) => fmtDateTime(iso);

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
    if (spec.parent && !spec.parent.optional && drawer.mode === "create" && !body[spec.parent.key]) {
      setBusy(null);
      setErrors({ [spec.parent.key]: `Choose a ${spec.parent.label.toLowerCase()}` });
      return;
    }
    if (spec.scope && drawer.mode === "create" && !body[spec.scope.key]) {
      setBusy(null);
      setErrors({ [spec.scope.key]: `Choose a ${spec.scope.label.toLowerCase()}` });
      return;
    }
    for (const l of spec.links ?? []) {
      if (l.required && drawer.mode === "create" && !body[l.key]) {
        setBusy(null);
        setErrors({ [l.key]: `Choose a ${l.label.toLowerCase()}` });
        return;
      }
    }
    if (
      spec.pivot?.required &&
      drawer.mode === "create" &&
      (body[spec.pivot.key] as number[] | undefined)?.length === 0
    ) {
      // Saving with none would hide the row from the person who just
      // made it — the server says the same thing, this says it sooner.
      setBusy(null);
      setErrors({ [spec.pivot.key]: `Choose at least one ${spec.pivot.label.toLowerCase()}` });
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

    if (spec.scope) {
      cols.push({
        id: "scope",
        accessorFn: (r) => r.scopeLabel ?? "",
        header: spec.scope.label,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-verdigris-200/60">
            {row.original.scopeLabel ?? "—"}
          </span>
        ),
      });
    }

    for (const l of spec.links ?? []) {
      cols.push({
        id: l.key,
        accessorFn: (r) => r.linkLabels?.[l.key] ?? "",
        header: l.label,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-verdigris-200/60">
            {row.original.linkLabels?.[l.key] ?? "—"}
          </span>
        ),
      });
    }

    if (spec.pivot) {
      cols.push({
        id: "pivot",
        accessorFn: (r) => r.pivotLabel ?? "",
        header: spec.pivot.label,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.pivotLabel ? (
            <span className="whitespace-nowrap font-mono text-[0.72rem] text-verdigris-300">
              {row.original.pivotLabel}
            </span>
          ) : (
            // Not decoration: a carrier linked to nothing is invisible
            // to every warehouse-scoped person on the system.
            <span className="text-xs text-amber-300">no site</span>
          ),
      });
    }

    for (const f of spec.fields) {
      // Editable in the drawer, absent from the list — see `hideInTable`
      // in the registry. An FAQ answer belongs in a form, not a cell.
      if (f.hideInTable) continue;
      cols.push({
        id: f.key,
        accessorFn: (r) => r.values[f.key],
        header: f.label,
        meta: { align: f.align, mono: f.mono, width: f.width } satisfies ColumnMeta,
        cell: ({ row }) => {
          const v = row.original.values[f.key];
          if (f.type === "money" && v !== null && v !== undefined) {
            return (
              <span className="whitespace-nowrap font-medium tabular-nums text-verdigris-50">
                {formatPaise(Number(v))}
              </span>
            );
          }
          if (f.type === "date" && v) {
            return <span className="whitespace-nowrap">{fmtDay(String(v))}</span>;
          }
          if (f.type === "boolean") {
            return String(v) === "true" ? (
              <span className="whitespace-nowrap rounded-full border border-rose-400/30 bg-rose-400/10 px-2.5 py-0.5 text-[0.78rem] text-rose-200">
                yes
              </span>
            ) : (
              <span className="text-verdigris-200/35">—</span>
            );
          }
          if (f.type === "select" && v !== null && v !== undefined) {
            return (
              <span className="rounded-full border border-verdigris-300/20 px-2.5 py-0.5 text-[0.78rem] text-verdigris-200">
                {String(v).toLowerCase().replace(/_/g, " ")}
              </span>
            );
          }
          return v === null || v === undefined || v === "" ? "—" : String(v);
        },
      });
    }

    if (spec.approval) {
      cols.push({
        id: "approval",
        accessorFn: (r) => r.approvalStatus ?? "",
        header: "Approval",
        cell: ({ row }) => {
          const status = row.original.approvalStatus ?? "PENDING";
          const look =
            status === "APPROVED"
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
              : status === "REJECTED"
                ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
                : "border-amber-400/30 bg-amber-400/10 text-amber-200";
          return (
            <span
              className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[0.78rem] ${look}`}
              title={
                status === "PENDING"
                  ? "Waiting for a super admin to decide"
                  : `${status.toLowerCase()} by ${row.original.approvedBy ?? "—"}${
                      row.original.approvedAt ? ` on ${row.original.approvedAt}` : ""
                    }`
              }
            >
              {status === "PENDING" ? "awaiting" : status.toLowerCase()}
            </span>
          );
        },
      });
    }

    if (spec.attachments) {
      cols.push({
        id: "receipts",
        accessorFn: (r) => r.attachmentCount ?? 0,
        header: spec.attachments.label,
        enableSorting: false,
        meta: { className: "whitespace-nowrap text-xs text-verdigris-200/50" } satisfies ColumnMeta,
        cell: ({ row }) =>
          (row.original.attachmentCount ?? 0) > 0 ? (
            <span className="inline-flex items-center gap-1 text-verdigris-200/75">
              <PaperclipIcon className="h-3.5 w-3.5" />
              {row.original.attachmentCount}
            </span>
          ) : (
            <span className="text-amber-300/70">none</span>
          ),
      });
    }

    /**
     * "In use" is about what points AT this row. An expense is pointed
     * at by nothing, so the column would be a solid line of em-dashes
     * taking up space the amount could use.
     */
    if (spec.dependentNoun !== "records") {
      cols.push({
        id: "inUse",
        accessorFn: (r) => r.inUse,
        header: "In use",
        enableSorting: false,
        meta: { className: "whitespace-nowrap text-xs text-verdigris-200/50" } satisfies ColumnMeta,
        cell: ({ row }) =>
          row.original.inUse > 0 ? row.original.inUseDetail || `${row.original.inUse} ${spec.dependentNoun}` : "—",
      });
    }

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
                label={
                  r.inUse > 0
                    ? `Cannot delete — ${r.inUseDetail} still use it`
                    : spec.softDeleteOnly
                      ? `Remove ${rowLabel(r)} from the books`
                      : `Delete ${rowLabel(r)}`
                }
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
          label={spec.listNoun ?? spec.label.toLowerCase()}
          singular={spec.singular}
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

      </Card>

      {confirm?.kind === "deactivate-in-use" ? (
        <ConfirmDialog
          title="Still in use"
          message={confirm.message}
          confirmLabel="Deactivate anyway"
          tone="warn"
          busy={busy === confirm.row.id}
          onConfirm={() => toggle(confirm.row, true)}
          onCancel={() => setConfirm(null)}
        />
      ) : null}

      {confirm?.kind === "delete" ? (
        <ConfirmDialog
          title={
            spec.softDeleteOnly
              ? `Remove ${confirm.label} from the books?`
              : `Delete ${confirm.label}?`
          }
          message={
            spec.softDeleteOnly
              ? "It leaves every list and every total. The row itself is kept, so the year end still adds up and the audit log can say what changed."
              : "This cannot be undone; the audit log keeps a copy of the values."
          }
          confirmLabel={spec.softDeleteOnly ? "Remove" : "Delete"}
          busy={busy === "bulk"}
          onConfirm={() => remove(confirm.ids)}
          onCancel={() => setConfirm(null)}
        />
      ) : null}

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
          onDecided={() => {
            close();
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

const cap = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;

// ── drawer ────────────────────────────────────────────────────────

function MasterDrawer({
  spec, drawer, draft, setDraft, errors, busy, onClose, onSave, onEdit, onDelete, onDecided,
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
  onDecided: () => void;
}) {
  const toast = useToast();
  const view = drawer.mode === "view";
  const row = drawer.mode === "create" ? null : drawer.row;

  /** Approve / reject, and the reason box that a rejection needs. */
  const [deciding, setDeciding] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [note, setNote] = useState("");
  const [decideBusy, setDecideBusy] = useState(false);

  const status = row?.approvalStatus ?? null;
  const canDecide = Boolean(spec.approval?.canDecide && row);

  async function decide(decision: "APPROVED" | "REJECTED") {
    if (!row) return;
    if (decision === "REJECTED" && note.trim().length < 5) {
      toast.error("Say why it is being rejected.");
      return;
    }
    setDecideBusy(true);
    const result = await api<{ ok: true }>(`/admin/expenses/${row.id}/approve`, {
      body: { decision, ...(note.trim() ? { note: note.trim() } : {}) },
    });
    setDecideBusy(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success(decision === "APPROVED" ? "Approved." : "Rejected.");
    setDeciding(null);
    setNote("");
    onDecided();
  }

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
              <p className="mt-0.5 font-mono text-[0.78rem] text-verdigris-200/45">id {row.id}</p>
            ) : null}
          </div>
          <IconButton label="Close" onClick={onClose} icon={<XIcon className="h-4 w-4" />} />
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {view && row ? (
            <FactList
              items={[
                ...(spec.parent
                  ? [
                      {
                        label: spec.parent.label,
                        value: (
                          <>
                            {row.parentLabel ?? "—"}
                            {grouped && currentParent?.groupLabel ? (
                              <span className="text-verdigris-200/60">, {currentParent.groupLabel}</span>
                            ) : null}
                          </>
                        ),
                      },
                    ]
                  : []),
                ...(spec.scope
                  ? [{ label: spec.scope.label, value: row.scopeLabel ?? "—" }]
                  : []),
                ...(spec.links ?? []).map((l) => ({
                  label: l.label,
                  value: row.linkLabels?.[l.key] ?? "—",
                })),
                ...(spec.pivot
                  ? [
                      {
                        label: spec.pivot.label,
                        value: row.pivotLabel ?? "no site",
                      },
                    ]
                  : []),
                /**
                 * The panel builds its own list instead of reusing the
                 * form's loop below, so `showWhen` has to be honoured
                 * HERE too. Gating only the form left "Why blacklisted
                 * — " sitting on the panel of every carrier who is not
                 * blacklisted: the box was gone, the empty line stayed.
                 */
                ...spec.fields.filter((f) => !hiddenBy(f, row.values)).map((f) => ({
                  label: f.label,
                  mono: f.mono,
                  // Same formatting as the cells. The first cut of this
                  // read the raw column and showed "4230075" where the
                  // list beside it said ₹42,300.75 — the two views have
                  // to agree, or one of them is lying about the money.
                  value:
                    row.values[f.key] === null || row.values[f.key] === undefined || row.values[f.key] === ""
                      ? "—"
                      : f.type === "boolean"
                        ? String(row.values[f.key]) === "true" ? "yes" : "no"
                      : f.type === "money"
                        ? formatPaise(Number(row.values[f.key]))
                        : f.type === "date"
                          ? fmtDay(String(row.values[f.key]))
                          : f.type === "select"
                            ? String(row.values[f.key]).toLowerCase().replace(/_/g, " ")
                            : String(row.values[f.key]),
                })),
                ...(spec.approval && row.approvalStatus
                  ? [
                      {
                        label: "Approval",
                        value:
                          row.approvalStatus === "PENDING"
                            ? "awaiting a decision"
                            : `${row.approvalStatus.toLowerCase()} by ${row.approvedBy ?? "—"}${
                                row.approvedAt ? ` on ${row.approvedAt}` : ""
                              }${row.approvalNote ? ` — ${row.approvalNote}` : ""}`,
                      },
                    ]
                  : []),
                { label: "Status", value: <StatusBadge value={row.isActive ? "ACTIVE" : "CLOSED"} /> },
                ...(spec.dependentNoun === "records"
                  ? []
                  : [{ label: "In use", value: row.inUse > 0 ? row.inUseDetail : "Not referenced anywhere" }]),
                { label: "Created", value: fmtDate(row.createdAt) },
                { label: "Updated", value: fmtDate(row.updatedAt) },
              ]}
            />
          ) : (
          <form
            id="master-drawer-form"
            onSubmit={(e) => { e.preventDefault(); if (!view) onSave(); }}
            className="space-y-4"
          >
            {spec.parent && grouped && !view ? (
              <div>
                <label htmlFor="f-group" className="text-[0.84rem] font-medium text-verdigris-200/70">
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
                <label htmlFor="f-parent" className="text-[0.84rem] font-medium text-verdigris-200/70">
                  {spec.parent.label}
                  {view || spec.parent.optional ? "" : " *"}
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

            {spec.scope ? (
              <div>
                <label htmlFor="f-scope" className="text-[0.84rem] font-medium text-verdigris-200/70">
                  {spec.scope.label}
                  {view ? "" : " *"}
                </label>
                {view ? (
                  <p className="mt-1 text-sm text-verdigris-50">{row?.scopeLabel ?? "—"}</p>
                ) : (
                  <select
                    id="f-scope"
                    value={draft[spec.scope.key] ?? ""}
                    onChange={(e) => setDraft({ ...draft, [spec.scope!.key]: e.target.value })}
                    className={`${input} ${tone(spec.scope.key)}`}
                  >
                    <option value="" className="bg-ink-850">
                      {spec.scope.options.length === 0
                        ? `No ${spec.scope.label.toLowerCase()} available to you`
                        : "Choose"}
                    </option>
                    {spec.scope.options.map((o) => (
                      <option key={o.id} value={o.id} className="bg-ink-850">{o.label}</option>
                    ))}
                  </select>
                )}
                {errors[spec.scope.key] ? (
                  <p className="mt-1 text-xs text-rose-300">{errors[spec.scope.key]}</p>
                ) : null}
              </div>
            ) : null}

            {(spec.links ?? []).map((l) => (
              <div key={l.key}>
                <label htmlFor={`f-${l.key}`} className="text-[0.84rem] font-medium text-verdigris-200/70">
                  {l.label}
                  {l.required && !view ? " *" : ""}
                </label>
                {view ? (
                  <p className="mt-1 text-sm text-verdigris-50">{row?.linkLabels?.[l.key] ?? "—"}</p>
                ) : (
                  <select
                    id={`f-${l.key}`}
                    value={draft[l.key] ?? ""}
                    onChange={(e) => setDraft({ ...draft, [l.key]: e.target.value })}
                    className={`${input} ${tone(l.key)}`}
                  >
                    <option value="" className="bg-ink-850">Choose</option>
                    {l.options.map((o) => (
                      <option key={o.id} value={o.id} className="bg-ink-850">{o.label}</option>
                    ))}
                  </select>
                )}
                {errors[l.key] ? <p className="mt-1 text-xs text-rose-300">{errors[l.key]}</p> : null}
              </div>
            ))}

            {spec.pivot ? (
              <div>
                <span className="text-[0.84rem] font-medium text-verdigris-200/70">
                  {spec.pivot.label}
                  {spec.pivot.required && !view ? " *" : ""}
                </span>
                {view ? (
                  <p className="mt-1 text-sm text-verdigris-50">
                    {(row?.pivotIds ?? []).length === 0
                      ? "no site"
                      : spec.pivot.options
                          .filter((o) => (row?.pivotIds ?? []).includes(o.id))
                          .map((o) => o.label)
                          .join(", ") || `${(row?.pivotIds ?? []).length} site(s)`}
                  </p>
                ) : (
                  <>
                    <p className="mt-0.5 text-xs text-verdigris-200/50">{spec.pivot.hint}</p>
                    {(() => {
                      const chosen = (draft[spec.pivot!.key] ?? "").split(",").filter(Boolean).map(Number);
                      const visible = new Set(spec.pivot!.options.map((o) => o.id));
                      const elsewhere = chosen.filter((id) => !visible.has(id)).length;
                      // Saying so matters: the tick list is not the whole
                      // truth for somebody who holds two sites out of six,
                      // and a carrier that looks unlinked here is not.
                      return elsewhere > 0 ? (
                        <p className="mt-1 text-xs text-verdigris-200/45">
                          Also linked to {elsewhere} other {elsewhere === 1 ? "site" : "sites"} you do
                          not manage. Those links are left alone.
                        </p>
                      ) : null;
                    })()}
                    <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-lg border border-verdigris-300/15 bg-ink-900/40 p-2">
                      {spec.pivot.options.length === 0 ? (
                        <p className="px-1 py-2 text-xs text-amber-300">
                          You are not assigned to a warehouse, so there is nothing to link to.
                        </p>
                      ) : (
                        spec.pivot.options.map((o) => {
                          const chosen = (draft[spec.pivot!.key] ?? "")
                            .split(",")
                            .filter(Boolean)
                            .map(Number);
                          const on = chosen.includes(o.id);
                          return (
                            <label
                              key={o.id}
                              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-verdigris-100 hover:bg-verdigris-100/5"
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => {
                                  const next = on
                                    ? chosen.filter((id) => id !== o.id)
                                    : [...chosen, o.id];
                                  setDraft({ ...draft, [spec.pivot!.key]: next.join(",") });
                                }}
                                className="h-4 w-4 rounded border-verdigris-300/30 bg-ink-900 accent-verdigris-400"
                              />
                              {o.label}
                            </label>
                          );
                        })
                      )}
                    </div>
                  </>
                )}
                {errors[spec.pivot.key] ? (
                  <p className="mt-1 text-xs text-rose-300">{errors[spec.pivot.key]}</p>
                ) : null}
              </div>
            ) : null}

            {drawer.mode === "create" && spec.bulkCreate ? (
              <div>
                <label htmlFor="f-bulk" className="text-[0.84rem] font-medium text-verdigris-200/70">
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
              /**
               * `showWhen` gates one field on another's tick.
               *
               * Against the live DRAFT, not the saved row: this branch
               * only ever runs with `view` false — the panel above
               * returns first — and reading the draft is what makes
               * unticking hide the box as you watch rather than on the
               * next open. `payload()` then sends the hidden field
               * empty, so the value leaves with the box instead of
               * travelling on invisibly.
               */
              hiddenBy(f, draft) ? null : (
              <div key={f.key}>
                <label htmlFor={`f-${f.key}`} className="text-[0.84rem] font-medium text-verdigris-200/70">
                  {f.label}{f.required && !view ? " *" : ""}
                </label>
                {view ? (
                  <p
                    className={`mt-1 text-sm text-verdigris-50 ${f.mono ? "font-mono" : ""} ${
                      // Sentences keep the line breaks they were typed
                      // with; a name has none to keep.
                      f.type === "textarea" ? "whitespace-pre-wrap leading-relaxed" : ""
                    }`}
                  >
                    {row?.values[f.key] === null || row?.values[f.key] === undefined || row?.values[f.key] === ""
                      ? "—"
                      : f.type === "select"
                        ? String(row.values[f.key]).toLowerCase().replace(/_/g, " ")
                        : f.type === "money"
                          ? formatPaise(Number(row.values[f.key]))
                          : f.type === "date"
                            ? fmtDay(String(row.values[f.key]))
                            : f.type === "boolean"
                              ? String(row.values[f.key]) === "true" ? "yes" : "no"
                              : String(row!.values[f.key])}
                  </p>
                ) : f.type === "textarea" ? (
                  <textarea
                    id={`f-${f.key}`}
                    rows={8}
                    value={draft[f.key] ?? ""}
                    placeholder={f.hint}
                    onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                    className={`${input} ${tone(f.key)} resize-y leading-relaxed`}
                  />
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
                ) : f.type === "boolean" ? (
                  <label className="mt-1 flex cursor-pointer items-center gap-2 text-sm text-verdigris-100">
                    <input
                      id={`f-${f.key}`}
                      type="checkbox"
                      checked={draft[f.key] === "true"}
                      onChange={(e) =>
                        setDraft({ ...draft, [f.key]: e.target.checked ? "true" : "false" })
                      }
                      className="h-4 w-4 rounded border-verdigris-300/30 bg-ink-900 accent-rose-400"
                    />
                    {f.hint ?? "Yes"}
                  </label>
                ) : f.type === "date" ? (
                  <input
                    id={`f-${f.key}`}
                    type="date"
                    value={draft[f.key] ?? ""}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                    className={`${input} ${tone(f.key)}`}
                  />
                ) : f.type === "money" ? (
                  <div className="relative">
                    {/* The ₹ is furniture, not text in the box: typing
                        over a prefilled symbol is a small daily annoyance
                        and the server strips it anyway. */}
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-verdigris-200/50">
                      ₹
                    </span>
                    <input
                      id={`f-${f.key}`}
                      type="text"
                      inputMode="decimal"
                      value={draft[f.key] ?? ""}
                      placeholder="0.00"
                      onChange={(e) =>
                        setDraft({ ...draft, [f.key]: e.target.value.replace(/[^\d.]/g, "") })
                      }
                      className={`${input} ${tone(f.key)} pl-7 text-right tabular-nums`}
                    />
                  </div>
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
              )
            )))}
          </form>
          )}

          {/* Both of these want a row to hang off, so neither appears
              while one is being created. Attaching a receipt to an
              expense that does not exist yet has nowhere to put it. */}
          {row && spec.attachments ? (
            <div className="mt-6 border-t border-verdigris-300/10 pt-5">
              <AttachmentPanel
                endpoint={spec.attachments.endpoint.replace("{id}", String(row.id))}
                label={spec.attachments.label}
                hint={spec.attachments.hint}
                accept={spec.attachments.accept}
                readOnly={!spec.canUpdate}
              />
            </div>
          ) : null}

        </div>

        {/* The decision, on its own row above the ordinary buttons: it is
            a different kind of action from Edit and Close, and putting a
            reason box in a line of buttons squeezes both. */}
        {view && row && canDecide && deciding ? (
          <div className="border-t border-verdigris-300/10 px-6 py-4">
            <label htmlFor="decide-note" className="text-[0.84rem] font-medium text-verdigris-200/70">
              {deciding === "REJECTED" ? "Why is it being rejected?" : "Note (optional)"}
            </label>
            <input
              id="decide-note"
              type="text"
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 focus:outline-none focus:ring-2 focus:ring-patina/40"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => { setDeciding(null); setNote(""); }}
                className="rounded-lg border border-verdigris-300/20 px-3 py-1.5 text-sm text-verdigris-100 hover:border-verdigris-300/45"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void decide(deciding)}
                disabled={decideBusy}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold disabled:opacity-60 ${
                  deciding === "APPROVED"
                    ? "bg-verdigris-400 text-ink-900 hover:bg-patina"
                    : "bg-rose-500/85 text-white hover:bg-rose-500"
                }`}
              >
                {decideBusy ? <Spinner className="h-3.5 w-3.5" /> : null}
                Confirm {deciding === "APPROVED" ? "approval" : "rejection"}
              </button>
            </div>
          </div>
        ) : null}

        <footer className="flex items-center justify-end gap-2 border-t border-verdigris-300/10 px-6 py-4">
          {view && row ? (
            <>
              {canDecide && !deciding ? (
                <span className="mr-auto inline-flex items-center gap-2">
                  {status !== "APPROVED" ? (
                    <button
                      type="button"
                      onClick={() => { setDeciding("APPROVED"); setNote(""); }}
                      className="rounded-lg border border-emerald-400/35 px-3 py-2 text-sm text-emerald-200 hover:border-emerald-400/70"
                    >
                      Approve
                    </button>
                  ) : null}
                  {status !== "REJECTED" ? (
                    <button
                      type="button"
                      onClick={() => { setDeciding("REJECTED"); setNote(""); }}
                      className="rounded-lg border border-rose-400/30 px-3 py-2 text-sm text-rose-200 hover:border-rose-400/60"
                    >
                      Reject
                    </button>
                  ) : null}
                </span>
              ) : null}
              {spec.canDelete ? (
                <button type="button" disabled={row.inUse > 0}
                  title={row.inUse > 0 ? `${row.inUseDetail} still use it` : undefined}
                  onClick={() => onDelete(row)}
                  className="mr-auto inline-flex items-center gap-1.5 rounded-lg border border-rose-400/30 px-3 py-2 text-sm text-rose-200 hover:border-rose-400/60 disabled:opacity-40">
                  <TrashIcon className="h-4 w-4" /> {spec.softDeleteOnly ? "Remove" : "Delete"}
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
