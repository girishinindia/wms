"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { EyeIcon, PencilIcon, TrashIcon, XIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";
import type { GeoOptions } from "@/lib/admin/geo";
import type { SalesAgentRow, SalesArea } from "@/lib/sales-agents/ops";
import { ADULT_YEARS, latestAdultBirthDate } from "@/lib/validation/age";

import DataTable, { SelectAllHeader, SelectRowCell, Switch, type ColumnMeta } from "./DataTable";
import { Card, ConfirmDialog, FactList, IconButton, StatusBadge } from "./ui";

/**
 * Sales agents on DataTable, client mode: the list is an importer's own
 * people (or every importer's, for a super admin) and arrives whole.
 *
 * Same shape as every other list: search, sort, 20 a page, multi-select
 * with a bulk bar, the active switch second-last, view / edit / delete
 * icons last. The drawer does view, edit and create; sales areas are
 * picked from the state and city masters, never typed.
 */

export type SalesAgentsSpec = {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  /** Super admin: the list spans importers, and creating asks which. */
  crossImporter: boolean;
  importers: { id: number; name: string; code: string }[];
  geo: GeoOptions;
};

type Area = SalesArea;
const areaLabel = (a: Area) => `${a.cityName}, ${a.stateName}`;
type Drawer =
  | { mode: "view"; row: SalesAgentRow }
  | { mode: "edit"; row: SalesAgentRow }
  | { mode: "create" }
  | null;
type Draft = Record<string, string>;
type Confirm = { kind: "delete"; ids: number[]; label: string } | null;

const TEXT_KEYS = [
  "firstName", "lastName", "email", "mobile", "birthDate", "joiningDate", "pan",
  "address", "landmark", "area", "cityId", "pincode", "notes",
] as const;

function toDraft(row: SalesAgentRow | null, spec: SalesAgentsSpec): Draft {
  const d: Draft = {};
  for (const k of TEXT_KEYS) {
    const v = row ? (row as unknown as Record<string, unknown>)[k] : undefined;
    d[k] = v === null || v === undefined ? "" : String(v);
  }
  if (!row) d.joiningDate = new Date().toISOString().slice(0, 10);
  d.importerId = row ? String(row.importerId) : spec.importers.length === 1 ? String(spec.importers[0]!.id) : "";
  d.createLogin = row ? "" : "yes";
  return d;
}

const name = (r: SalesAgentRow) => `${r.firstName} ${r.lastName}`.trim();
const fmtDate = (v: string | null) =>
  v ? new Date(`${v}T00:00:00`).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }) : "—";

export default function SalesAgentsTable({
  rows,
  spec,
}: {
  rows: SalesAgentRow[];
  spec: SalesAgentsSpec;
}) {
  const router = useRouter();
  const toast = useToast();
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [areas, setAreas] = useState<Area[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<number | "drawer" | "bulk" | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  /** Shown once after a create-with-login; never stored. */
  const [credentials, setCredentials] = useState<{ name: string; email: string; password: string } | null>(null);

  const openView = (row: SalesAgentRow) => { setErrors({}); setDrawer({ mode: "view", row }); };
  const openEdit = (row: SalesAgentRow) => { setErrors({}); setDraft(toDraft(row, spec)); setAreas(row.salesAreas); setDrawer({ mode: "edit", row }); };
  const openCreate = () => { setErrors({}); setDraft(toDraft(null, spec)); setAreas([]); setDrawer({ mode: "create" }); };
  const close = () => { setDrawer(null); setErrors({}); };

  function body(): Record<string, unknown> {
    const b: Record<string, unknown> = {};
    for (const k of TEXT_KEYS) {
      const t = (draft[k] ?? "").trim();
      if (k === "cityId") b.cityId = t ? Number(t) : null;
      else if (k === "pan") b.pan = t ? t.toUpperCase() : null;
      else b[k] = t === "" ? null : t;
    }
    b.salesAreas = areas;
    return b;
  }

  async function save() {
    if (!drawer || drawer.mode === "view") return;
    setBusy("drawer");
    const payload = body();
    // Required strings must not be sent as null — the schema says so.
    for (const k of ["firstName", "lastName", "mobile", "joiningDate"]) if (payload[k] === null) payload[k] = "";
    let result;
    if (drawer.mode === "create") {
      payload.createLogin = draft.createLogin === "yes";
      if (spec.crossImporter && draft.importerId) payload.importerId = Number(draft.importerId);
      const created = await api<{ agent: SalesAgentRow; login: unknown; tempPassword: string | null }>("/sales-agents", { body: payload });
      if (created.ok && created.data.tempPassword) {
        setCredentials({
          name: `${created.data.agent.firstName} ${created.data.agent.lastName}`.trim(),
          email: created.data.agent.email ?? "",
          password: created.data.tempPassword,
        });
      }
      result = created;
    } else {
      result = await api<SalesAgentRow>(`/sales-agents/${drawer.row.id}`, { method: "PATCH", body: payload });
    }
    setBusy(null);
    if (!result.ok) {
      if (result.error.fields) setErrors(result.error.fields);
      toast.error(result.error.message);
      return;
    }
    toast.success(drawer.mode === "create" ? "Sales agent added." : "Saved.");
    close();
    router.refresh();
  }

  async function toggle(row: SalesAgentRow) {
    setBusy(row.id);
    const result = await api<SalesAgentRow>(`/sales-agents/${row.id}`, { method: "PATCH", body: { isActive: !row.isActive } });
    setBusy(null);
    if (!result.ok) { toast.error(result.error.message); return; }
    toast.success(row.isActive ? "Deactivated." : "Activated.");
    router.refresh();
  }

  async function bulk(action: "activate" | "deactivate" | "delete", ids: number[]) {
    setBusy("bulk");
    const result = await api<{ done: number[]; skipped: { id: number; reason: string }[] }>("/sales-agents/bulk", { body: { action, ids } });
    setBusy(null);
    setConfirm(null);
    if (!result.ok) { toast.error(result.error.message); return; }
    const verb = action === "delete" ? "Deleted" : action === "activate" ? "Activated" : "Deactivated";
    const { done, skipped } = result.data;
    const parts = [`${verb} ${done.length}.`];
    if (skipped.length) parts.push(`Skipped ${skipped.length} — ${skipped[0]!.reason}.`);
    (skipped.length && !done.length ? toast.error : toast.success)(parts.join(" "));
    close();
    router.refresh();
  }

  const columns = useMemo<ColumnDef<SalesAgentRow, unknown>[]>(() => {
    const cols: ColumnDef<SalesAgentRow, unknown>[] = [];
    if (spec.canUpdate || spec.canDelete) {
      cols.push({
        id: "select", enableSorting: false,
        header: ({ table }) => <SelectAllHeader table={table} />,
        cell: ({ row }) => <SelectRowCell row={row} label={name(row.original)} />,
        meta: { width: 2.5 } satisfies ColumnMeta,
      });
    }
    cols.push({ accessorKey: "code", header: "Code", meta: { mono: true, width: 6 } satisfies ColumnMeta });
    cols.push({
      id: "name", accessorFn: (r) => name(r), header: "Name",
      cell: ({ row }) => (
        <button type="button" onClick={() => openView(row.original)} className="text-left font-medium hover:text-patina">
          {name(row.original)}
          {row.original.userId ? null : <span className="ml-1.5 text-[0.72rem] uppercase tracking-wide text-verdigris-200/45">no login</span>}
        </button>
      ),
    });
    if (spec.crossImporter) {
      cols.push({ accessorKey: "importerName", header: "Importer", cell: ({ getValue }) => <span className="text-verdigris-200/70">{String(getValue())}</span> });
    }
    cols.push({
      accessorKey: "mobile", header: "Contact", meta: { className: "text-xs" } satisfies ColumnMeta,
      cell: ({ row }) => (
        <span className="text-verdigris-200/65">
          <span className="block font-mono">{row.original.mobile}</span>
          {row.original.email ? <span className="block text-verdigris-200/45">{row.original.email}</span> : null}
        </span>
      ),
    });
    cols.push({ id: "city", accessorFn: (r) => r.cityLabel ?? "", header: "City", cell: ({ row }) => row.original.cityLabel ?? "—" });
    cols.push({
      id: "areas",
      accessorFn: (r) => r.salesAreas.map((a) => `${areaLabel(a)} ${a.areas.join(" ")}`).join(" | "),
      header: "Sales areas", enableSorting: false,
      cell: ({ row }) => {
        const a = row.original.salesAreas;
        if (!a.length) return <span className="text-verdigris-200/40">—</span>;
        return (
          <span className="flex flex-col gap-1">
            {a.slice(0, 2).map((x, i) => (
              <span key={i} className="text-xs">
                <span className="text-verdigris-100">{x.cityName}</span>
                <span className="text-verdigris-200/45"> · {x.stateName}</span>
                {x.areas.length ? (
                  <span className="block text-[0.78rem] text-verdigris-200/65">
                    {x.areas.slice(0, 3).join(", ")}{x.areas.length > 3 ? ` +${x.areas.length - 3}` : ""}
                  </span>
                ) : null}
              </span>
            ))}
            {a.length > 2 ? <span className="text-[0.78rem] text-verdigris-200/50">+{a.length - 2} more</span> : null}
          </span>
        );
      },
    });
    cols.push({ accessorKey: "joiningDate", header: "Joined", meta: { className: "whitespace-nowrap text-xs text-verdigris-200/60" } satisfies ColumnMeta, cell: ({ getValue }) => fmtDate(getValue() as string) });
    cols.push({ accessorKey: "status", header: "Status", cell: ({ getValue }) => <StatusBadge value={String(getValue())} /> });
    cols.push({
      id: "active", accessorFn: (r) => r.isActive, header: "Active",
      cell: ({ row }) => spec.canUpdate ? (
        <Switch checked={row.original.isActive} busy={busy === row.original.id}
          label={row.original.isActive ? `Deactivate ${name(row.original)}` : `Activate ${name(row.original)}`}
          onChange={() => toggle(row.original)} />
      ) : <StatusBadge value={row.original.isActive ? "ACTIVE" : "CLOSED"} />,
    });
    cols.push({
      id: "actions", header: "", enableSorting: false, meta: { className: "whitespace-nowrap text-right" } satisfies ColumnMeta,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <span className="inline-flex items-center gap-1.5">
            <IconButton label={`View ${name(r)}`} onClick={() => openView(r)} icon={<EyeIcon className="h-4 w-4" />} />
            {spec.canUpdate ? <IconButton label={`Edit ${name(r)}`} onClick={() => openEdit(r)} icon={<PencilIcon className="h-4 w-4" />} /> : null}
            {spec.canDelete ? <IconButton label={`Delete ${name(r)}`} tone="danger" onClick={() => setConfirm({ kind: "delete", ids: [r.id], label: name(r) })} icon={<TrashIcon className="h-4 w-4" />} /> : null}
          </span>
        );
      },
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, busy]);

  return (
    <>
      <Card>
        <DataTable<SalesAgentRow>
          columns={columns}
          data={rows}
          label="sales agents"
          enableSelection={spec.canUpdate || spec.canDelete}
          searchKeys={["code", "firstName", "lastName", "mobile", "email", "importerName", "status", "salesAreas"]}
          emptyTitle="No sales agents yet."
          emptyHint={spec.canCreate ? "Add the people who sell for you; each gets a login for the mobile app." : undefined}
          rowClassName={(row) => (row.original.isActive ? "" : "opacity-60")}
          action={spec.canCreate ? (
            <button type="button" onClick={openCreate}
              className="rounded-lg bg-verdigris-400 px-4 py-1.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina">
              Add sales agent
            </button>
          ) : null}
          bulk={(selected, clear) => {
            const ids = selected.map((r) => r.id);
            const b = "rounded-lg border px-3 py-1 text-xs transition-colors disabled:opacity-40";
            return (
              <>
                {spec.canUpdate ? (
                  <>
                    <button type="button" disabled={busy === "bulk"} onClick={() => bulk("activate", ids).then(clear)} className={`${b} border-verdigris-300/25 text-verdigris-100 hover:border-verdigris-300/50`}>Activate</button>
                    <button type="button" disabled={busy === "bulk"} onClick={() => bulk("deactivate", ids).then(clear)} className={`${b} border-verdigris-300/25 text-verdigris-100 hover:border-verdigris-300/50`}>Deactivate</button>
                  </>
                ) : null}
                {spec.canDelete ? (
                  <button type="button" disabled={busy === "bulk"} onClick={() => setConfirm({ kind: "delete", ids, label: `${ids.length} sales agent${ids.length === 1 ? "" : "s"}` })} className={`${b} border-rose-400/30 text-rose-200 hover:border-rose-400/60`}>Delete</button>
                ) : null}
                {busy === "bulk" ? <Spinner className="h-3.5 w-3.5" /> : null}
              </>
            );
          }}
        />

      </Card>

      {confirm?.kind === "delete" ? (
        <ConfirmDialog
          title={`Delete ${confirm.label}?`}
          message="Their login is closed and the record is kept in the audit log."
          confirmLabel="Delete"
          busy={busy === "bulk"}
          onConfirm={() => bulk("delete", confirm.ids)}
          onCancel={() => setConfirm(null)}
        />
      ) : null}

      {credentials ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink-900/70" aria-hidden />
          <div role="dialog" aria-modal="true" aria-label="Login created"
            className="relative w-full max-w-md rounded-2xl border border-verdigris-300/20 bg-ink-850 p-6 card-shadow">
            <h2 className="text-base font-semibold text-verdigris-50">Login created for {credentials.name}</h2>
            <p className="mt-2 text-sm text-verdigris-200/75">
              The temporary password below was also emailed to {credentials.email}. It is shown
              here ONCE — copy it if you want to hand it over yourself. They must change it at
              first sign-in.
            </p>
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-verdigris-300/20 bg-ink-900/60 px-4 py-3">
              <code className="flex-1 select-all font-mono text-lg tracking-wider text-verdigris-50">{credentials.password}</code>
              <button type="button"
                onClick={() => { void navigator.clipboard?.writeText(credentials.password).then(() => toast.success("Copied.")); }}
                className="rounded-lg border border-verdigris-300/25 px-3 py-1.5 text-xs text-verdigris-100 hover:border-verdigris-300/50">
                Copy
              </button>
            </div>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => setCredentials(null)}
                className="rounded-lg bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-patina">
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {drawer ? (
        <AgentDrawer
          spec={spec} drawer={drawer} draft={draft} setDraft={setDraft} areas={areas} setAreas={setAreas}
          errors={errors} busy={busy === "drawer"} onClose={close} onSave={save} onEdit={openEdit}
          onDelete={(row) => setConfirm({ kind: "delete", ids: [row.id], label: name(row) })}
        />
      ) : null}
    </>
  );
}

// ── drawer ────────────────────────────────────────────────────────

function AgentDrawer({
  spec, drawer, draft, setDraft, areas, setAreas, errors, busy, onClose, onSave, onEdit, onDelete,
}: {
  spec: SalesAgentsSpec;
  drawer: NonNullable<Drawer>;
  draft: Draft;
  setDraft: (d: Draft) => void;
  areas: Area[];
  setAreas: (a: Area[]) => void;
  errors: Record<string, string>;
  busy: boolean;
  onClose: () => void;
  onSave: () => void;
  onEdit: (row: SalesAgentRow) => void;
  onDelete: (row: SalesAgentRow) => void;
}) {
  const view = drawer.mode === "view";
  const row = drawer.mode === "create" ? null : drawer.row;
  const geo = spec.geo;

  // Address pickers: country → state → city. Derived from the saved city
  // when editing, otherwise the only country if there is one.
  const initialCity = row?.cityId ? geo.cities.find((c) => c.id === row.cityId) : undefined;
  const initialState = initialCity ? geo.states.find((s) => s.id === initialCity.stateId) : undefined;
  const [countryId, setCountryId] = useState<string>(initialState ? String(initialState.countryId) : geo.countries.length === 1 ? String(geo.countries[0]!.id) : "");
  const [stateId, setStateId] = useState<string>(initialState ? String(initialState.id) : "");
  const states = geo.states.filter((s) => String(s.countryId) === countryId);
  const cities = geo.cities.filter((c) => String(c.stateId) === stateId);

  // Sales-area picker: State → City from the master, then the areas of
  // that city this agent covers (typed, comma or newline separated —
  // localities are not master data), then Add. Adding the same city
  // again merges the areas into the existing entry.
  const [areaState, setAreaState] = useState<string>("");
  const [areaCity, setAreaCity] = useState<string>("");
  const [areaText, setAreaText] = useState<string>("");
  const areaCities = geo.cities.filter((c) => String(c.stateId) === areaState);
  function addArea() {
    const s = geo.states.find((x) => String(x.id) === areaState);
    const c = geo.cities.find((x) => String(x.id) === areaCity);
    if (!s || !c) return;
    const typed = [...new Set(areaText.split(/[,\n;]+/).map((t) => t.trim()).filter(Boolean))];
    const existing = areas.find((a) => a.cityId === c.id);
    if (existing) {
      setAreas(areas.map((a) => (a.cityId === c.id ? { ...a, areas: [...new Set([...a.areas, ...typed])] } : a)));
    } else {
      setAreas([...areas, { stateId: s.id, stateName: s.name, cityId: c.id, cityName: c.name, areas: typed }]);
    }
    setAreaText("");
    setAreaCity("");
  }
  const removeLocality = (cityId: number, locality: string) =>
    setAreas(areas.map((a) => (a.cityId === cityId ? { ...a, areas: a.areas.filter((x) => x !== locality) } : a)));

  const set = (k: string, v: string) => setDraft({ ...draft, [k]: v });
  const input = "mt-1 w-full rounded-lg border bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40";
  const tone = (k: string) => (errors[k] ? "border-rose-400/50" : "border-verdigris-300/15");
  const label = "block text-xs font-medium text-verdigris-200/80";
  const err = (k: string) => (errors[k] ? <span className="mt-1 block text-xs text-rose-300">{errors[k]}</span> : null);
  const title = drawer.mode === "create" ? "Add sales agent" : drawer.mode === "edit" ? "Edit sales agent" : "Sales agent";

  const text = (k: string, lbl: string, opts: { type?: string; required?: boolean; mono?: boolean; placeholder?: string; span?: boolean; max?: string; hint?: string } = {}) => (
    <label className={`${label} ${opts.span ? "sm:col-span-2" : ""}`}>
      {lbl}{opts.required ? <span className="text-amber-300"> *</span> : null}
      <input type={opts.type ?? "text"} value={draft[k] ?? ""} onChange={(e) => set(k, opts.mono ? e.target.value.toUpperCase() : e.target.value)}
        max={opts.max}
        placeholder={opts.placeholder} className={`${input} ${tone(k)} ${opts.mono ? "font-mono uppercase" : ""}`} />
      {err(k) ?? (opts.hint ? <span className="mt-1 block text-xs text-verdigris-200/45">{opts.hint}</span> : null)}
    </label>
  );
  const select = (value: string, onChange: (v: string) => void, options: { id: number | string; name: string }[], opts: { disabled?: boolean; k?: string; placeholder?: string } = {}) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={opts.disabled} className={`${input} pr-8 ${tone(opts.k ?? "")} disabled:opacity-50`}>
      <option value="" className="bg-ink-850">{opts.placeholder ?? "Choose…"}</option>
      {options.map((o) => <option key={o.id} value={o.id} className="bg-ink-850">{o.name}</option>)}
    </select>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="flex-1 bg-ink-900/70" />
      <aside role="dialog" aria-modal="true" aria-label={title} className="flex h-full w-full max-w-lg flex-col border-l border-verdigris-300/10 bg-ink-850 shadow-2xl">
        <header className="flex items-center justify-between border-b border-verdigris-300/10 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-verdigris-50">{title}</h2>
            {row ? <p className="mt-0.5 font-mono text-[0.78rem] text-verdigris-200/45">{row.code}</p> : null}
          </div>
          <IconButton label="Close" onClick={onClose} icon={<XIcon className="h-4 w-4" />} />
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {view && row ? (
            <FactList
              items={[
                { label: "Code", value: row.code, mono: true },
                { label: "Name", value: name(row) },
                ...(spec.crossImporter ? [{ label: "Importer", value: row.importerName }] : []),
                { label: "Mobile", value: row.mobile, mono: true },
                { label: "Email", value: row.email ?? "—" },
                { label: "Login", value: row.userId ? "Yes (mobile app)" : "No" },
                { label: "Birth date", value: fmtDate(row.birthDate) },
                { label: "Joining date", value: fmtDate(row.joiningDate) },
                { label: "PAN", value: row.pan ?? "—", mono: true },
                { label: "Address", value: [row.address, row.landmark, row.area].filter(Boolean).join(", ") || "—" },
                { label: "City", value: row.cityLabel ?? "—" },
                { label: "Pincode", value: row.pincode ?? "—", mono: true },
                { label: "Sales areas", value: row.salesAreas.length ? (
                  <ul className="space-y-1">
                    {row.salesAreas.map((a, i) => (
                      <li key={i} className="text-sm">
                        <span className="text-verdigris-50">{a.cityName}</span>
                        <span className="text-verdigris-200/50">, {a.stateName}</span>
                        {a.areas.length ? <span className="block text-xs text-verdigris-200/70">{a.areas.join(", ")}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : "—" },
                { label: "Status", value: <StatusBadge value={row.status} /> },
                { label: "Active", value: row.isActive ? "Yes" : "No" },
                { label: "Notes", value: row.notes ?? "—" },
                { label: "Created", value: new Date(row.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) },
              ]}
            />
          ) : (
            <form id="agent-drawer-form" onSubmit={(e) => { e.preventDefault(); onSave(); }} className="space-y-5">
              {drawer.mode === "create" && spec.crossImporter ? (
                <label className={label}>
                  Importer<span className="text-amber-300"> *</span>
                  {select(draft.importerId ?? "", (v) => set("importerId", v), spec.importers.map((i) => ({ id: i.id, name: `${i.name} (${i.code})` })), { k: "importerId" })}
                  {err("importerId")}
                </label>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                {text("firstName", "First name", { required: true })}
                {text("lastName", "Last name", { required: true })}
                {text("mobile", "Mobile", { required: true, placeholder: "9876543210" })}
                {text("email", "Email", { type: "email", required: drawer.mode === "create" })}
                {/* `max` keeps the picker itself from offering a date that
                    would make the agent a minor; the schema refuses the
                    same date if it arrives by any other route. */}
                {text("birthDate", "Birth date", {
                  type: "date",
                  max: latestAdultBirthDate(),
                  hint: `Must be ${ADULT_YEARS} or older`,
                })}
                {text("joiningDate", "Joining date", { type: "date", required: true })}
                {text("pan", "PAN", { mono: true, placeholder: "AAAAA0000A" })}
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Address</p>
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  {text("address", "Address", { span: true })}
                  {text("landmark", "Landmark")}
                  {text("area", "Area / locality")}
                  <label className={label}>Country{select(countryId, (v) => { setCountryId(v); setStateId(""); set("cityId", ""); }, geo.countries)}</label>
                  <label className={label}>State{select(stateId, (v) => { setStateId(v); set("cityId", ""); }, states, { disabled: !countryId })}</label>
                  <label className={label}>City{select(draft.cityId ?? "", (v) => set("cityId", v), cities, { disabled: !stateId, k: "cityId" })}{err("cityId")}</label>
                  {text("pincode", "Pincode", { mono: true })}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Sales areas</p>
                <p className="mt-1 text-xs text-verdigris-200/55">
                  State and city from the master; then the areas of that city this agent covers — one city is
                  usually split between agents by locality.
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className={label}>State{select(areaState, (v) => { setAreaState(v); setAreaCity(""); }, geo.states)}</label>
                  <label className={label}>City{select(areaCity, setAreaCity, areaCities, { disabled: !areaState })}</label>
                  <label className={`${label} sm:col-span-2`}>
                    Areas in this city
                    <textarea
                      value={areaText}
                      onChange={(e) => setAreaText(e.target.value)}
                      disabled={!areaCity}
                      rows={2}
                      placeholder="Andheri East, Bandra West, Kurla — comma or one per line"
                      className={`${input} border-verdigris-300/15 disabled:opacity-50`}
                    />
                  </label>
                  <div className="sm:col-span-2 flex justify-end">
                    <button type="button" onClick={addArea} disabled={!areaCity}
                      className="rounded-lg border border-verdigris-300/25 px-3 py-1.5 text-sm text-verdigris-100 hover:border-verdigris-300/50 disabled:opacity-40">
                      Add territory
                    </button>
                  </div>
                </div>
                {areas.length ? (
                  <ul className="mt-3 space-y-2">
                    {areas.map((a) => (
                      <li key={a.cityId} className="rounded-lg border border-verdigris-300/15 bg-ink-900/40 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-verdigris-50">
                            {a.cityName} <span className="text-verdigris-200/50">· {a.stateName}</span>
                          </span>
                          <button type="button" aria-label={`Remove ${areaLabel(a)}`} onClick={() => setAreas(areas.filter((x) => x.cityId !== a.cityId))}
                            className="grid h-5 w-5 place-items-center rounded-full text-verdigris-200/60 hover:bg-verdigris-100/10 hover:text-verdigris-50">
                            <XIcon className="h-3 w-3" />
                          </button>
                        </div>
                        {a.areas.length ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {a.areas.map((loc) => (
                              <span key={loc} className="inline-flex items-center gap-1 rounded-full border border-verdigris-300/25 py-0.5 pl-2 pr-1 text-[0.78rem] text-verdigris-100">
                                {loc}
                                <button type="button" aria-label={`Remove ${loc}`} onClick={() => removeLocality(a.cityId, loc)}
                                  className="grid h-3.5 w-3.5 place-items-center rounded-full text-verdigris-200/60 hover:text-verdigris-50">
                                  <XIcon className="h-2.5 w-2.5" />
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : <p className="mt-1 text-[0.78rem] text-verdigris-200/45">Whole city</p>}
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-2 text-xs text-verdigris-200/40">None yet.</p>}
                {err("salesAreas")}
              </div>

              <label className={label}>
                Notes
                <textarea value={draft.notes ?? ""} onChange={(e) => set("notes", e.target.value)} rows={2} className={`${input} ${tone("notes")}`} />
              </label>

              {drawer.mode === "create" ? (
                <label className="flex items-start gap-2 text-sm text-verdigris-100">
                  <input type="checkbox" checked={draft.createLogin === "yes"} onChange={(e) => set("createLogin", e.target.checked ? "yes" : "no")} className="mt-0.5 h-4 w-4 accent-verdigris-400" />
                  <span>
                    Create a login for the mobile app
                    <span className="block text-xs text-verdigris-200/55">A temporary password is emailed to the agent; they change it on first sign-in. Needs an email.</span>
                  </span>
                </label>
              ) : null}
            </form>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-verdigris-300/10 px-6 py-4">
          {view && row ? (
            <>
              {spec.canDelete ? <IconButton label={`Delete ${name(row)}`} tone="danger" onClick={() => onDelete(row)} icon={<TrashIcon className="h-4 w-4" />} /> : null}
              <button type="button" onClick={onClose} className="rounded-lg border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45">Close</button>
              {spec.canUpdate ? (
                <button type="button" onClick={() => onEdit(row)} className="inline-flex items-center gap-1.5 rounded-lg bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-patina">
                  <PencilIcon className="h-4 w-4" /> Edit
                </button>
              ) : null}
            </>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45">Cancel</button>
              <button type="submit" form="agent-drawer-form" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-patina disabled:opacity-60">
                {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
                {drawer.mode === "create" ? "Add sales agent" : "Save changes"}
              </button>
            </>
          )}
        </footer>
      </aside>
    </div>
  );
}
