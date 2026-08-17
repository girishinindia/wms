"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { CheckIcon, PencilIcon, PowerIcon, XIcon } from "@/components/icons";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";
import type { MasterField } from "@/lib/admin/master-registry";

import { Card, Empty, IconButton, StatusBadge } from "./ui";

/**
 * One editing surface for every master table.
 *
 * Editing happens in the row rather than in a modal. The job on these
 * screens is almost never "change this one record" — it is "make these
 * eight capacities consistent", and a modal turns that into eight rounds
 * of open, edit, save, close with the rest of the table hidden behind
 * the overlay each time.
 *
 * Only the plain field metadata crosses from the server; the Zod schemas
 * in the registry stay on the server, where they are the thing that
 * actually decides what is valid. What is here is the shape of the form.
 */

export type MasterRow = {
  id: number;
  isActive: boolean;
  /** How many rows elsewhere point at this one. */
  inUse: number;
  parentLabel?: string | null;
  values: Record<string, string | number | null>;
};

export type ParentOption = { id: number; label: string };

export type MasterSpec = {
  slug: string;
  label: string;
  singular: string;
  fields: MasterField[];
  parent?: { key: string; label: string; options: ParentOption[] } | null;
  dependentNoun: string;
  canCreate: boolean;
  canUpdate: boolean;
};

type Draft = Record<string, string>;

const asDraft = (row: MasterRow, fields: MasterField[]): Draft =>
  Object.fromEntries(
    fields.map((f) => [f.key, row.values[f.key] === null || row.values[f.key] === undefined ? "" : String(row.values[f.key])]),
  );

/** Only send what the user actually typed; `""` means "leave it out",
 *  which is what the server's optional() preprocessing expects. */
function payload(draft: Draft, fields: MasterField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = draft[field.key] ?? "";
    if (raw === "") continue;
    out[field.key] = field.type === "number" ? Number(raw) : raw;
  }
  return out;
}

export default function MasterTable({
  spec,
  rows,
}: {
  spec: MasterSpec;
  rows: MasterRow[];
}) {
  const router = useRouter();
  const toast = useToast();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>({});
  const [addParent, setAddParent] = useState<string>("");
  const [busy, setBusy] = useState<number | "new" | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  /** A row whose deactivation the server refused because it is in use. */
  const [confirmOff, setConfirmOff] = useState<{ id: number; message: string } | null>(null);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      Object.values(r.values)
        .concat(r.parentLabel ?? "")
        .some((v) => String(v ?? "").toLowerCase().includes(needle)),
    );
  }, [rows, filter]);

  const activeCount = rows.filter((r) => r.isActive).length;

  function startEdit(row: MasterRow) {
    setConfirmOff(null);
    setErrors({});
    setAdding(false);
    setEditingId(row.id);
    setDraft(asDraft(row, spec.fields));
  }

  async function save(id: number) {
    setBusy(id);
    setErrors({});
    const result = await api<{ ok: true }>(`/admin/master/${spec.slug}?id=${id}`, {
      method: "PATCH",
      body: payload(draft, spec.fields),
    });
    setBusy(null);

    if (!result.ok) {
      if (result.error.fields) setErrors(result.error.fields);
      toast.error(result.error.message);
      return;
    }
    toast.success("Saved.");
    setEditingId(null);
    router.refresh();
  }

  async function create() {
    setBusy("new");
    setErrors({});
    const body = payload(addDraft, spec.fields);
    if (spec.parent) {
      if (!addParent) {
        setBusy(null);
        setErrors({ [spec.parent.key]: `Choose a ${spec.parent.label.toLowerCase()}` });
        toast.error(`Choose a ${spec.parent.label.toLowerCase()}.`);
        return;
      }
      body[spec.parent.key] = Number(addParent);
    }

    const result = await api<{ id: number }>(`/admin/master/${spec.slug}`, { body });
    setBusy(null);

    if (!result.ok) {
      if (result.error.fields) setErrors(result.error.fields);
      toast.error(result.error.message);
      return;
    }
    toast.success(`${spec.singular[0]!.toUpperCase()}${spec.singular.slice(1)} added.`);
    setAdding(false);
    setAddDraft({});
    setAddParent("");
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
        setConfirmOff({ id: row.id, message: result.error.message });
        return;
      }
      toast.error(result.error.message);
      return;
    }
    toast.success(row.isActive ? "Switched off." : "Switched back on.");
    setConfirmOff(null);
    router.refresh();
  }

  const input = (
    field: MasterField,
    value: string,
    onChange: (v: string) => void,
    idPrefix: string,
  ) => {
    const shared =
      "w-full rounded-lg border bg-ink-900/60 px-2.5 py-1.5 text-[13px] text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40";
    const tone = errors[field.key]
      ? "border-rose-400/50"
      : "border-verdigris-300/15";

    if (field.type === "select") {
      return (
        <select
          id={`${idPrefix}-${field.key}`}
          aria-label={field.label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${shared} ${tone}`}
        >
          <option value="" className="bg-ink-850">
            Choose
          </option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o} className="bg-ink-850">
              {o.toLowerCase().replace(/_/g, " ")}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        id={`${idPrefix}-${field.key}`}
        aria-label={field.label}
        type={field.type === "number" ? "text" : "text"}
        inputMode={field.type === "number" ? "decimal" : undefined}
        value={value}
        placeholder={field.hint}
        onChange={(e) =>
          onChange(
            field.type === "number" ? e.target.value.replace(/[^\d.]/g, "") : e.target.value,
          )
        }
        className={`${shared} ${tone} ${field.mono ? "font-mono" : ""} ${
          field.align === "right" ? "text-right" : ""
        }`}
      />
    );
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-verdigris-300/10 px-5 py-4">
        <h2 className="text-sm font-semibold text-verdigris-50">
          {rows.length} defined
          <span className="ml-2 font-normal text-verdigris-200/45">{activeCount} active</span>
        </h2>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter"
            aria-label={`Filter ${spec.label.toLowerCase()}`}
            className="w-40 rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-1.5 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40"
          />
          {spec.canCreate ? (
            <button
              type="button"
              onClick={() => {
                setAdding((v) => !v);
                setEditingId(null);
                setErrors({});
              }}
              className="rounded-lg bg-verdigris-400 px-4 py-1.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina"
            >
              {adding ? "Cancel" : `Add ${spec.singular}`}
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-verdigris-300/10">
              {spec.parent ? (
                <th className="px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-verdigris-400">
                  {spec.parent.label}
                </th>
              ) : null}
              {spec.fields.map((f) => (
                <th
                  key={f.key}
                  style={f.width ? { width: `${f.width}rem` } : undefined}
                  className={`px-4 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-verdigris-400 ${
                    f.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {f.label}
                </th>
              ))}
              <th className="whitespace-nowrap px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-verdigris-400">
                In use
              </th>
              <th className="px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-verdigris-400">
                Status
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>

          <tbody>
            {adding ? (
              <tr className="border-b border-verdigris-300/10 bg-verdigris-500/[0.06]">
                {spec.parent ? (
                  <td className="px-4 py-3">
                    <select
                      aria-label={spec.parent.label}
                      value={addParent}
                      onChange={(e) => setAddParent(e.target.value)}
                      className="w-full rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-2.5 py-1.5 text-[13px] text-verdigris-50 focus:outline-none focus:ring-2 focus:ring-patina/40"
                    >
                      <option value="" className="bg-ink-850">
                        Choose
                      </option>
                      {spec.parent.options.map((o) => (
                        <option key={o.id} value={o.id} className="bg-ink-850">
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                ) : null}
                {spec.fields.map((f) => (
                  <td key={f.key} className="px-4 py-3">
                    {input(
                      f,
                      addDraft[f.key] ?? "",
                      (v) => setAddDraft((d) => ({ ...d, [f.key]: v })),
                      "new",
                    )}
                  </td>
                ))}
                <td className="px-4 py-3 text-xs text-verdigris-200/40">—</td>
                <td className="px-4 py-3">
                  <StatusBadge value="ACTIVE" />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <span className="inline-flex items-center gap-1.5">
                    <IconButton
                      label={`Save this ${spec.singular}`}
                      tone="primary"
                      busy={busy === "new"}
                      onClick={create}
                      icon={<CheckIcon className="h-4 w-4" />}
                    />
                    {/* Cancel belongs next to Save. It was only in the
                        header, which is the wrong end of a wide row —
                        by the time you have filled the last field the
                        way out is off the side of the screen. */}
                    <IconButton
                      label="Discard this row"
                      onClick={() => {
                        setAdding(false);
                        setAddDraft({});
                        setAddParent("");
                        setErrors({});
                      }}
                      disabled={busy === "new"}
                      icon={<XIcon className="h-4 w-4" />}
                    />
                  </span>
                </td>
              </tr>
            ) : null}

            {shown.length === 0 && !adding ? (
              <tr>
                <td colSpan={spec.fields.length + (spec.parent ? 4 : 3)}>
                  <Empty
                    title={
                      rows.length === 0
                        ? `No ${spec.label.toLowerCase()} yet.`
                        : "Nothing matches that filter."
                    }
                  />
                </td>
              </tr>
            ) : null}

            {shown.map((row) => {
              const editing = editingId === row.id;
              return (
                <tr
                  key={row.id}
                  className={`border-b border-verdigris-300/[0.06] last:border-0 ${
                    editing ? "bg-verdigris-500/[0.06]" : "hover:bg-verdigris-100/[0.03]"
                  } ${row.isActive ? "" : "opacity-60"}`}
                >
                  {spec.parent ? (
                    <td className="px-4 py-3 text-verdigris-200/60">{row.parentLabel ?? "—"}</td>
                  ) : null}

                  {spec.fields.map((f) => (
                    <td
                      key={f.key}
                      className={`px-4 py-3 text-verdigris-100 ${
                        f.align === "right" ? "text-right" : ""
                      } ${f.mono && !editing ? "whitespace-nowrap font-mono text-xs text-verdigris-300" : ""}`}
                    >
                      {editing ? (
                        input(
                          f,
                          draft[f.key] ?? "",
                          (v) => setDraft((d) => ({ ...d, [f.key]: v })),
                          String(row.id),
                        )
                      ) : f.type === "select" ? (
                        <span className="rounded-full border border-verdigris-300/20 px-2.5 py-0.5 text-[11px] text-verdigris-200">
                          {String(row.values[f.key] ?? "").toLowerCase().replace(/_/g, " ")}
                        </span>
                      ) : (
                        (row.values[f.key] ?? "—")
                      )}
                    </td>
                  ))}

                  <td className="whitespace-nowrap px-4 py-3 text-xs text-verdigris-200/50">
                    {row.inUse > 0 ? `${row.inUse} ${spec.dependentNoun}` : "—"}
                  </td>

                  <td className="px-4 py-3">
                    <StatusBadge value={row.isActive ? "ACTIVE" : "CLOSED"} />
                  </td>

                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {!spec.canUpdate ? null : editing ? (
                      <span className="inline-flex items-center gap-1.5">
                        <IconButton
                          label="Save changes"
                          tone="primary"
                          busy={busy === row.id}
                          onClick={() => save(row.id)}
                          icon={<CheckIcon className="h-4 w-4" />}
                        />
                        <IconButton
                          label="Discard changes"
                          disabled={busy === row.id}
                          onClick={() => setEditingId(null)}
                          icon={<XIcon className="h-4 w-4" />}
                        />
                      </span>
                    ) : confirmOff?.id === row.id ? (
                      <span className="inline-flex items-center gap-1.5">
                        <IconButton
                          label={`Switch off anyway — ${row.inUse} ${spec.dependentNoun} still use it`}
                          tone="danger"
                          busy={busy === row.id}
                          onClick={() => toggle(row, true)}
                          icon={<PowerIcon className="h-4 w-4" />}
                        />
                        <IconButton
                          label="Keep it switched on"
                          onClick={() => setConfirmOff(null)}
                          icon={<XIcon className="h-4 w-4" />}
                        />
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <IconButton
                          label={`Edit ${String(row.values[spec.fields[0]!.key] ?? spec.singular)}`}
                          onClick={() => startEdit(row)}
                          icon={<PencilIcon className="h-4 w-4" />}
                        />
                        <IconButton
                          label={row.isActive ? "Switch off" : "Switch on"}
                          tone={row.isActive ? "default" : "danger"}
                          busy={busy === row.id}
                          onClick={() => toggle(row)}
                          icon={<PowerIcon className="h-4 w-4" />}
                        />
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {confirmOff ? (
        <p
          role="alert"
          className="border-t border-amber-400/25 bg-amber-500/[0.07] px-5 py-3 text-[13px] text-amber-100"
        >
          {confirmOff.message}
        </p>
      ) : null}

      {Object.keys(errors).length > 0 ? (
        <p
          role="alert"
          className="border-t border-rose-400/25 bg-rose-500/[0.07] px-5 py-3 text-[13px] text-rose-100"
        >
          {Object.entries(errors)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ")}
        </p>
      ) : null}
    </Card>
  );
}
