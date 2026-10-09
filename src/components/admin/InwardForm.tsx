"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { api } from "@/lib/api/client";
import type { ImportResult } from "@/lib/inward/ops";
import { acceptsPackingFile, readPackingFile, type SheetPictures } from "@/lib/inward/sheet-reader";
import { useToast } from "@/components/Toast";
import { Card } from "@/components/admin/ui";
import type { lookupsFor, getRequest } from "@/lib/inward/ops";

import { fmt } from "./InwardTable";

/**
 * The inward request form — one page, four sections, a summary rail.
 *
 * Desktop is where the packing list gets typed in, so the goods table
 * is keyboard-first: Tab walks the cells, Enter on the last cell adds a
 * row, the totals recompute as the digits land. Every picker is a
 * combobox that filters as you type and offers "Add …" when nothing
 * matches, so a new transporter is a dialog, not a trip to another
 * screen. ⌘S / Ctrl+S saves the draft.
 */

export type Lookups = Awaited<ReturnType<typeof lookupsFor>>;
export type Detail = Awaited<ReturnType<typeof getRequest>>;

type Line = {
  key: number;
  itemId: number | null;
  description: string;
  cartonQty: string;
  piecesPerCarton: string;
  unitId: number | null;
  kgPerCarton: string;
  imageUrl: string | null;
};

type Draft = {
  id: number | null;
  warehouseId: number | null;
  containerNumber: string;
  containerTypeId: number | null;
  portId: number | null;
  expectedArrival: string;
  remarks: string;
  transporterId: number | null;
  vehicleId: number | null;
  driverId: number | null;
  items: Line[];
};

let keySeq = 1;
const blankLine = (): Line => ({
  key: keySeq++,
  itemId: null,
  description: "",
  cartonQty: "",
  piecesPerCarton: "",
  unitId: null,
  kgPerCarton: "",
  imageUrl: null,
});

function fromDetail(d: Detail | null, lookups: Lookups): Draft {
  if (!d) {
    return {
      id: null,
      warehouseId: lookups.last?.warehouseId ?? (lookups.warehouses.length === 1 ? lookups.warehouses[0]!.id : null),
      containerNumber: "",
      containerTypeId: null,
      portId: null,
      expectedArrival: "",
      remarks: "",
      transporterId: null,
      vehicleId: null,
      driverId: null,
      items: [blankLine()],
    };
  }
  return {
    id: d.id,
    warehouseId: d.warehouse.id,
    containerNumber: d.containerNumber ?? "",
    containerTypeId: d.containerType?.id ?? null,
    portId: d.port?.id ?? null,
    expectedArrival: d.expectedArrival ?? "",
    remarks: d.remarks ?? "",
    transporterId: d.transporter?.id ?? null,
    vehicleId: d.vehicle?.id ?? null,
    driverId: d.driver?.id ?? null,
    items: d.items.length
      ? d.items.map((l) => ({
          key: keySeq++,
          itemId: l.itemId,
          description: l.description,
          cartonQty: String(l.cartonQty),
          piecesPerCarton: String(l.piecesPerCarton),
          unitId: l.unitId,
          kgPerCarton: String(l.kgPerCarton),
          imageUrl: l.imageUrl,
        }))
      : [blankLine()],
  };
}

function body(d: Draft, importerId: number | null) {
  const items = d.items
    .filter((l) => l.description.trim() !== "" || l.cartonQty !== "" || l.itemId !== null)
    .map((l) => ({
      itemId: l.itemId,
      description: l.description.trim(),
      cartonQty: Number(l.cartonQty),
      piecesPerCarton: Number(l.piecesPerCarton),
      unitId: l.unitId,
      kgPerCarton: Number(l.kgPerCarton),
      imageUrl: l.imageUrl,
    }));
  return {
    // Only a platform user names the importer; for everyone else the
    // server takes it from their role binding and ignores this.
    ...(importerId !== null ? { importerId } : {}),
    warehouseId: d.warehouseId,
    containerNumber: d.containerNumber.trim().toUpperCase() || null,
    containerTypeId: d.containerTypeId,
    portId: d.portId,
    expectedArrival: d.expectedArrival || null,
    remarks: d.remarks.trim() || null,
    transporterId: d.transporterId,
    vehicleId: d.vehicleId,
    driverId: d.driverId,
    items,
  };
}

const input =
  "w-full rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-3.5 py-2.5 text-[15px] text-verdigris-50 placeholder:text-verdigris-200/35 focus:outline-none focus:ring-2 focus:ring-patina/25 disabled:opacity-50";
const cell =
  "w-full rounded-lg border border-verdigris-300/10 bg-ink-900/50 px-2.5 py-1.5 text-sm text-verdigris-50 focus:outline-none focus:ring-2 focus:ring-patina/25";
const label = "mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-verdigris-300";
const primary =
  "rounded-xl bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina disabled:opacity-50";
const secondary =
  "rounded-xl border border-verdigris-300/20 px-4 py-2.5 text-sm text-verdigris-100 hover:border-verdigris-300/45 disabled:opacity-50";

function Err({ text }: { text?: string }) {
  return text ? <p className="mt-1 text-xs text-rose-300">{text}</p> : null;
}

// ── Combobox ──────────────────────────────────────────────────────

type ComboOption = { id: number; label: string; sub?: string; tag?: string };

function Combo({
  id,
  options,
  value,
  onChange,
  placeholder,
  disabled,
  onAddNew,
  addLabel = "Add new",
}: {
  id: string;
  options: ComboOption[];
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder: string;
  disabled?: boolean;
  onAddNew?: (typed: string) => void;
  addLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const chosen = options.find((o) => o.id === value) ?? null;

  const q = typed.trim().toLowerCase();
  const matches = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.sub ?? "").toLowerCase().includes(q))
    : options;

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const pick = (o: ComboOption) => {
    onChange(o.id);
    setTyped("");
    setOpen(false);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, matches.length - (onAddNew ? 0 : 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = matches[cursor];
      if (m) pick(m);
      else if (onAddNew) onAddNew(typed.trim());
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={box} className="relative">
      <input
        id={id}
        disabled={disabled}
        value={open ? typed : (chosen?.label ?? "")}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => {
          setOpen(true);
          setCursor(0);
        }}
        onChange={(e) => {
          setTyped(e.target.value);
          setCursor(0);
          if (!open) setOpen(true);
        }}
        onKeyDown={onKey}
        className={`${input} ${chosen && !open ? "pr-8" : ""}`}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
      />
      {chosen && !open ? (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => onChange(null)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-verdigris-200/50 hover:text-rose-300"
        >
          ✕
        </button>
      ) : null}
      {open && !disabled ? (
        <div
          id={`${id}-listbox`}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-verdigris-300/15 bg-ink-850 p-1 shadow-2xl"
        >
          {matches.map((o, i) => (
            <button
              key={o.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                i === cursor ? "bg-patina/15 text-verdigris-50" : "text-verdigris-100 hover:bg-ink-900/60"
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate">{o.label}</span>
                {o.sub ? <span className="block truncate text-xs text-verdigris-200/50">{o.sub}</span> : null}
              </span>
              {o.tag ? (
                <span className="shrink-0 rounded-full bg-patina/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-patina">
                  {o.tag}
                </span>
              ) : null}
            </button>
          ))}
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-xs text-verdigris-200/50">Nothing matches.</p>
          ) : null}
          {onAddNew ? (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onAddNew(typed.trim())}
              className={`mt-1 flex w-full items-center gap-2 rounded-lg border-t border-verdigris-300/10 px-3 py-2 text-left text-sm font-medium ${
                cursor === matches.length ? "bg-patina/15 text-patina" : "text-patina hover:bg-ink-900/60"
              }`}
            >
              + {q ? `Add "${typed.trim()}"` : addLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Inline "add new" dialogs ──────────────────────────────────────

type AddKind = "transporter" | "vehicle" | "driver" | "item";

function AddDialog({
  kind,
  typed,
  lookups,
  transporterId,
  warehouseId,
  onBehalfOf,
  onClose,
  onAdded,
}: {
  kind: AddKind;
  typed: string;
  lookups: Lookups;
  transporterId: number | null;
  warehouseId: number | null;
  /** The importer a platform user is writing for; null for an importer-side user. */
  onBehalfOf: number | null;
  onClose: () => void;
  onAdded: (kind: AddKind, id: number, row?: Lookups["items"][number]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [f, setF] = useState<Record<string, string>>({
    name: typed,
    registrationNumber: typed.toUpperCase(),
    // The item picker searches by code, so what was typed is the code.
    code: typed.toUpperCase(),
    description: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    setFields({});
    let result;
    if (kind === "item") {
      const path = onBehalfOf !== null ? `/items?importerId=${onBehalfOf}` : "/items";
      result = await api<Lookups["items"][number] & { usedOn: number; isActive: boolean }>(path, {
        body: {
          code: f.code ?? "",
          description: f.description ?? "",
          unitId: f.unitId ? Number(f.unitId) : null,
          piecesPerCarton: f.piecesPerCarton ? Number(f.piecesPerCarton) : null,
          kgPerCarton: f.kgPerCarton ? Number(f.kgPerCarton) : null,
        },
      });
      if (result.ok) {
        onAdded("item", result.data.id, result.data);
        return;
      }
    } else {
      const payload =
        kind === "transporter"
          ? {
              kind,
              warehouseId,
              name: f.name ?? "",
              contactPerson: f.contactPerson ?? "",
              contactMobile: f.contactMobile ?? "",
              gstin: f.gstin ?? "",
              address: f.address ?? "",
            }
          : kind === "vehicle"
            ? {
                kind,
                transporterId,
                vehicleTypeId: f.vehicleTypeId ? Number(f.vehicleTypeId) : null,
                registrationNumber: f.registrationNumber ?? "",
                capacityKg: f.capacityKg ? Number(f.capacityKg) : null,
                rcNumber: f.rcNumber ?? "",
              }
            : {
                kind,
                transporterId,
                name: f.name ?? "",
                mobile: f.mobile ?? "",
                licenceNumber: f.licenceNumber ?? "",
                aadhaarNumber: f.aadhaarNumber ?? "",
              };
      result = await api<{ id: number }>("/inward-requests/propose", {
        body: onBehalfOf !== null ? { ...payload, importerId: onBehalfOf } : payload,
      });
      if (result.ok) {
        onAdded(kind, result.data.id);
        return;
      }
    }
    setBusy(false);
    setError(result.error.message);
    setFields(result.error.fields ?? {});
  };

  const Text = ({ k, l, ph, type = "text" }: { k: string; l: string; ph?: string; type?: string }) => (
    <div>
      <label className={label} htmlFor={`add-${k}`}>
        {l}
      </label>
      <input
        id={`add-${k}`}
        type={type}
        value={f[k] ?? ""}
        placeholder={ph}
        onChange={(e) => set(k, e.target.value)}
        className={input}
      />
      <Err text={fields[k]} />
    </div>
  );

  const title = { transporter: "New transporter", vehicle: "New vehicle", driver: "New driver", item: "New item" }[kind];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 text-left">
      <button type="button" aria-label="Cancel" onClick={onClose} className="absolute inset-0 bg-ink-900/70" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-lg rounded-2xl border border-verdigris-300/10 bg-ink-850 p-6 card-shadow"
      >
        <h2 className="text-lg font-semibold text-verdigris-50">{title}</h2>
        <p className="mt-1 text-xs text-verdigris-200/55">
          {kind === "item"
            ? "Saved to your catalogue, so next time it is a pick and one number."
            : "Added as awaiting approval. Usable on your requests at once; the transporter manager confirms it later."}
        </p>
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {kind === "transporter" ? (
            <>
              <div className="sm:col-span-2">
                <Text k="name" l="Transporter name" />
              </div>
              <Text k="contactPerson" l="Contact person" />
              <Text k="contactMobile" l="Mobile" ph="10 digits" />
              <Text k="gstin" l="GSTIN (optional)" />
              <Text k="address" l="Address (optional)" />
            </>
          ) : kind === "vehicle" ? (
            <>
              <Text k="registrationNumber" l="Vehicle number" ph="MH12AB1234" />
              <div>
                <label className={label} htmlFor="add-vehicleTypeId">
                  Vehicle type
                </label>
                <select
                  id="add-vehicleTypeId"
                  value={f.vehicleTypeId ?? ""}
                  onChange={(e) => set("vehicleTypeId", e.target.value)}
                  className={input}
                >
                  <option value="">Choose…</option>
                  {lookups.vehicleTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <Err text={fields.vehicleTypeId} />
              </div>
              <Text k="capacityKg" l="Capacity kg (optional)" type="number" />
              <Text k="rcNumber" l="RC number (optional)" />
            </>
          ) : kind === "driver" ? (
            <>
              <Text k="name" l="Driver name" />
              <Text k="mobile" l="Mobile" ph="10 digits" />
              <Text k="licenceNumber" l="Licence number" />
              <Text k="aadhaarNumber" l="Aadhaar (optional)" ph="12 digits" />
            </>
          ) : (
            <>
              <Text k="code" l="Item code" ph="As on your packing list — blank to auto-number" />
              <Text k="description" l="Item description" />
              <div>
                <label className={label} htmlFor="add-unitId">
                  Unit
                </label>
                <select id="add-unitId" value={f.unitId ?? ""} onChange={(e) => set("unitId", e.target.value)} className={input}>
                  <option value="">Choose…</option>
                  {lookups.units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.code})
                    </option>
                  ))}
                </select>
              </div>
              <Text k="piecesPerCarton" l="Pieces per carton" type="number" />
              <Text k="kgPerCarton" l="Kg per carton" type="number" />
            </>
          )}
          {error ? (
            <p className="sm:col-span-2 text-sm text-rose-300">{error}</p>
          ) : null}
          <div className="sm:col-span-2 mt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className={secondary}>
              Cancel
            </button>
            <button type="submit" disabled={busy} className={primary}>
              {busy ? "Saving…" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── The form ──────────────────────────────────────────────────────

export default function InwardForm({ lookups: initial, existing }: { lookups: Lookups; existing: Detail | null }) {
  const router = useRouter();
  const toast = useToast();
  const [lookups, setLookups] = useState(initial);
  const [d, setD] = useState<Draft>(() => fromDetail(existing, initial));
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ kind: AddKind; typed: string; line?: number } | null>(null);
  const patch = (p: Partial<Draft>) => setD((s) => ({ ...s, ...p }));

  const transporter = lookups.transporters.find((t) => t.id === d.transporterId) ?? null;

  // A platform user (SUPER_ADMIN) has no company of their own and writes
  // on behalf of one: `importers` is the list to choose from, `importer`
  // the choice. For an importer-side user both are settled server-side.
  const chooser = lookups.importers !== null;
  const onBehalfOf = chooser ? (lookups.importer?.id ?? null) : null;
  const importerPicked = !chooser || onBehalfOf !== null;

  const totals = useMemo(() => {
    let cartons = 0;
    let pieces = 0;
    let kg = 0;
    for (const l of d.items) {
      const c = Number(l.cartonQty) || 0;
      cartons += c;
      pieces += c * (Number(l.piecesPerCarton) || 0);
      kg += c * (Number(l.kgPerCarton) || 0);
    }
    return { cartons, pieces, kg, lines: d.items.filter((l) => l.description.trim() !== "").length };
  }, [d.items]);

  const refreshLookups = useCallback(async () => {
    const path = onBehalfOf !== null ? `/inward-requests/lookups?importerId=${onBehalfOf}` : "/inward-requests/lookups";
    const r = await api<Lookups>(path, { method: "GET" });
    if (r.ok) setLookups(r.data);
    return r.ok ? r.data : null;
  }, [onBehalfOf]);

  const save = useCallback(async (): Promise<number | null> => {
    setBusy(true);
    setError(null);
    setFields({});
    const r = d.id
      ? await api<Detail>(`/inward-requests/${d.id}`, { method: "PUT", body: body(d, onBehalfOf) })
      : await api<Detail>("/inward-requests", { body: body(d, onBehalfOf) });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      setFields(r.error.fields ?? {});
      return null;
    }
    patch({ id: r.data.id });
    return r.data.id;
  }, [d, onBehalfOf]);

  const saveDraft = async () => {
    const id = await save();
    if (id) {
      toast.success("Draft saved.");
      router.push(`/admin/inward/${id}`);
      router.refresh();
    }
  };

  const submit = async () => {
    const id = await save();
    if (!id) return;
    setBusy(true);
    const r = await api<Detail>(`/inward-requests/${id}/submit`, {});
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      setFields(r.error.fields ?? {});
      return;
    }
    toast.success(`${r.data.code} sent to ${r.data.warehouse.name}.`);
    router.push(`/admin/inward/${id}`);
    router.refresh();
  };

  // ⌘S / Ctrl+S saves the draft.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (importerPicked) void saveDraft();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);

  const setLine = (i: number, p: Partial<Line>) =>
    setD((s) => ({ ...s, items: s.items.map((l, j) => (j === i ? { ...l, ...p } : l)) }));

  const applyItem = (i: number, itemId: number | null) => {
    const it = lookups.items.find((x) => x.id === itemId);
    if (!it) {
      setLine(i, { itemId: null });
      return;
    }
    setLine(i, {
      itemId: it.id,
      description: it.description,
      unitId: it.unitId ?? d.items[i]!.unitId,
      piecesPerCarton: it.piecesPerCarton != null ? String(it.piecesPerCarton) : d.items[i]!.piecesPerCarton,
      kgPerCarton: it.kgPerCarton != null ? String(it.kgPerCarton) : d.items[i]!.kgPerCarton,
      imageUrl: it.imageUrl,
    });
    // The one number still to type.
    requestAnimationFrame(() => document.getElementById(`line-${i}-cartons`)?.focus());
  };

  // ── Importing a packing list ──
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [importReport, setImportReport] = useState<ImportResult | null>(null);

  const importFile = async (file: File) => {
    if (!acceptsPackingFile(file.name)) {
      toast.error("Drop an Excel sheet (.xlsx), a CSV or a PDF packing list.");
      return;
    }
    setImporting("Reading the file…");
    setImportReport(null);
    const q = onBehalfOf !== null ? `?importerId=${onBehalfOf}` : "";
    try {
      const read = await readPackingFile(file);
      setImporting("Matching items with your catalogue…");
      const result =
        read.kind === "pdf"
          ? await importPdf(read.bytes, q)
          : await api<ImportResult>(`/items/import${q}`, { body: { fileName: file.name, rows: read.rows } });
      if (!result.ok) {
        setImporting(null);
        toast.error(result.error.message);
        return;
      }
      const r = result.data;
      const imported: Line[] = r.lines.map((l) => ({
        key: keySeq++,
        itemId: l.itemId,
        description: l.description,
        cartonQty: String(l.cartonQty),
        piecesPerCarton: String(l.piecesPerCarton),
        unitId: l.unitId,
        kgPerCarton: String(l.kgPerCarton),
        imageUrl: l.imageUrl,
      }));
      // Typed lines stay; blank ones make way.
      setD((s) => ({
        ...s,
        items: [...s.items.filter((l) => l.description.trim() !== "" || l.itemId !== null || l.cartonQty !== ""), ...imported],
      }));
      setImportReport(r);

      // The sheet's pictures, one per new catalogue row.
      const pictures: SheetPictures = read.kind === "rows" ? read.pictures : new Map();
      const withPicture = r.lines.filter((l) => l.created && l.itemId !== null && pictures.has(l.row));
      let n = 0;
      for (const l of withPicture) {
        n += 1;
        setImporting(`Saving pictures… ${n} of ${withPicture.length}`);
        const url = await uploadPicture(l.itemId!, pictures.get(l.row)!.blob, q);
        if (url) setD((s) => ({ ...s, items: s.items.map((x) => (x.itemId === l.itemId ? { ...x, imageUrl: url } : x)) }));
      }
      await refreshLookups();
      toast.success(
        `${r.lines.length} line${r.lines.length === 1 ? "" : "s"} imported · ${r.created} new in the catalogue, ${r.matched} matched` +
          (r.skipped.length ? ` · ${r.skipped.length} row${r.skipped.length === 1 ? "" : "s"} skipped` : ""),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read that file");
    } finally {
      setImporting(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const addRow = () => setD((s) => ({ ...s, items: [...s.items, blankLine()] }));
  const removeRow = (i: number) =>
    setD((s) => ({ ...s, items: s.items.length === 1 ? [blankLine()] : s.items.filter((_, j) => j !== i) }));

  const onLastCellKey = (e: KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (i === d.items.length - 1) addRow();
      requestAnimationFrame(() => document.getElementById(`line-${i + 1}-item`)?.focus());
    }
  };

  const sameAsLast = () => {
    const last = lookups.last;
    if (!last) return;
    patch({
      containerTypeId: d.containerTypeId ?? last.containerTypeId,
      portId: d.portId ?? last.portId,
      transporterId: d.transporterId ?? last.transporterId,
      vehicleId: d.vehicleId ?? (d.transporterId === null || d.transporterId === last.transporterId ? last.vehicleId : null),
      driverId: d.driverId ?? (d.transporterId === null || d.transporterId === last.transporterId ? last.driverId : null),
    });
  };

  const fieldLabel = (k: string) =>
    ({
      warehouseId: "Warehouse",
      containerNumber: "Container number",
      containerTypeId: "Container type",
      portId: "Port",
      expectedArrival: "Expected arrival",
      transporterId: "Transporter",
      vehicleId: "Vehicle",
      driverId: "Driver",
      items: "Goods",
    })[k] ?? k;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="space-y-6">
        {existing?.status === "NEEDS_CHANGES" && existing.needsChangesNote ? (
          <Card className="border-rose-400/30 p-4">
            <p className="text-sm text-verdigris-50">
              <span className="font-semibold text-rose-300">Sent back by {existing.warehouse.name}:</span>{" "}
              {existing.needsChangesNote}
            </p>
          </Card>
        ) : null}

        {/* ── 0. On behalf of — platform users only ── */}
        {chooser ? (
          <Card className="p-5">
            <h2 className="mb-4 text-base font-semibold text-verdigris-50">Importer</h2>
            {existing ? (
              <p className="text-sm text-verdigris-100">
                {existing.importer.name} <span className="font-mono text-verdigris-200/55">{existing.importer.code}</span>
              </p>
            ) : (
              <>
                <label className={label} htmlFor="importer">
                  Whose goods are these?
                </label>
                <Combo
                  id="importer"
                  placeholder="Choose the importer this request is for"
                  value={onBehalfOf}
                  onChange={(id) => {
                    if (id !== null) router.replace(`/admin/inward/new?importerId=${id}`);
                  }}
                  options={(lookups.importers ?? []).map((i) => ({ id: i.id, label: i.name, sub: i.code }))}
                />
                {!importerPicked ? (
                  <p className="mt-2 text-xs text-verdigris-200/55">
                    Pick the importer first — the catalogue and the carrier register fill in for them.
                  </p>
                ) : null}
              </>
            )}
          </Card>
        ) : null}

        <fieldset disabled={!importerPicked} className="min-w-0 space-y-6 disabled:opacity-60">
        {/* ── 1. Where & what ── */}
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-verdigris-50">1 · Where &amp; what</h2>
            {lookups.last && !existing ? (
              <button type="button" onClick={sameAsLast} className="text-xs font-medium text-patina hover:underline">
                ↺ Same as last time
              </button>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={label} htmlFor="warehouse">
                Warehouse
              </label>
              <Combo
                id="warehouse"
                placeholder="Choose the warehouse this is going to"
                value={d.warehouseId}
                onChange={(id) => patch({ warehouseId: id })}
                options={lookups.warehouses.map((w) => ({
                  id: w.id,
                  label: w.name,
                  sub: [w.code, w.city].filter(Boolean).join(" · "),
                  tag: w.id === lookups.last?.warehouseId ? "last time" : undefined,
                }))}
              />
              <Err text={fields.warehouseId} />
            </div>
            <div>
              <label className={label} htmlFor="container">
                Container number
              </label>
              <input
                id="container"
                value={d.containerNumber}
                onChange={(e) => patch({ containerNumber: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11) })}
                placeholder="TCLU1234567"
                className={`${input} font-mono`}
              />
              <Err text={fields.containerNumber} />
            </div>
            <div>
              <label className={label} htmlFor="ctype">
                Container size / type
              </label>
              <Combo
                id="ctype"
                placeholder="20 ft, 40 ft HC…"
                value={d.containerTypeId}
                onChange={(id) => patch({ containerTypeId: id })}
                options={lookups.containerTypes.map((c) => ({ id: c.id, label: c.name, sub: c.code }))}
              />
              <Err text={fields.containerTypeId} />
            </div>
            <div>
              <label className={label} htmlFor="port">
                Port
              </label>
              <Combo
                id="port"
                placeholder="Where it lands"
                value={d.portId}
                onChange={(id) => patch({ portId: id })}
                options={lookups.ports.map((p) => ({ id: p.id, label: p.name, sub: [p.code, p.state].filter(Boolean).join(" · ") }))}
              />
              <Err text={fields.portId} />
            </div>
            <div>
              <label className={label} htmlFor="eta">
                Expected arrival
              </label>
              <input
                id="eta"
                type="date"
                value={d.expectedArrival}
                onChange={(e) => patch({ expectedArrival: e.target.value })}
                className={input}
              />
              <Err text={fields.expectedArrival} />
            </div>
            <div className="sm:col-span-2">
              <label className={label} htmlFor="remarks">
                Remarks
              </label>
              <textarea
                id="remarks"
                rows={2}
                value={d.remarks}
                onChange={(e) => patch({ remarks: e.target.value })}
                placeholder="Anything the dock should know before the lorry arrives"
                className={input}
              />
            </div>
          </div>
        </Card>

        {/* ── 2. Who brings it ── */}
        <Card className="p-5">
          <h2 className="mb-4 text-base font-semibold text-verdigris-50">2 · Who brings it</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className={label} htmlFor="transporter">
                Transporter
              </label>
              <Combo
                id="transporter"
                placeholder="Search transporters"
                value={d.transporterId}
                onChange={(id) =>
                  patch({ transporterId: id, ...(id !== d.transporterId ? { vehicleId: null, driverId: null } : {}) })
                }
                options={[...lookups.transporters]
                  .sort((a, b) => Number(b.warehouseIds.includes(d.warehouseId ?? -1)) - Number(a.warehouseIds.includes(d.warehouseId ?? -1)))
                  .map((t) => ({
                    id: t.id,
                    label: t.name ?? "",
                    sub: t.mobile ? `+91 ${t.mobile}` : undefined,
                    tag: t.pending ? "pending" : t.warehouseIds.includes(d.warehouseId ?? -1) ? "serves this site" : undefined,
                  }))}
                onAddNew={d.warehouseId ? (typed) => setAdding({ kind: "transporter", typed }) : undefined}
                addLabel="New transporter"
              />
              <Err text={fields.transporterId} />
            </div>
            <div>
              <label className={label} htmlFor="vehicle">
                Vehicle
              </label>
              <Combo
                id="vehicle"
                disabled={!transporter}
                placeholder={transporter ? "Search by number" : "Pick the transporter first"}
                value={d.vehicleId}
                onChange={(id) => patch({ vehicleId: id })}
                options={(transporter?.vehicles ?? []).map((v) => ({
                  id: v.id,
                  label: v.registrationNumber,
                  sub: [v.typeName, v.capacityKg ? `${fmt(v.capacityKg)} kg` : null].filter(Boolean).join(" · "),
                  tag: v.pending ? "pending" : undefined,
                }))}
                onAddNew={transporter ? (typed) => setAdding({ kind: "vehicle", typed }) : undefined}
                addLabel="New vehicle"
              />
              <Err text={fields.vehicleId} />
            </div>
            <div>
              <label className={label} htmlFor="driver">
                Driver
              </label>
              <Combo
                id="driver"
                disabled={!transporter}
                placeholder={transporter ? "Search drivers" : "Pick the transporter first"}
                value={d.driverId}
                onChange={(id) => patch({ driverId: id })}
                options={(transporter?.drivers ?? []).map((v) => ({
                  id: v.id,
                  label: v.name,
                  sub: [v.mobile ? `+91 ${v.mobile}` : null, v.licenceNumber].filter(Boolean).join(" · "),
                  tag: v.pending ? "pending" : undefined,
                }))}
                onAddNew={transporter ? (typed) => setAdding({ kind: "driver", typed }) : undefined}
                addLabel="New driver"
              />
              <Err text={fields.driverId} />
            </div>
          </div>
        </Card>

        {/* ── 3. Goods ── */}
        <Card className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-verdigris-50">3 · Goods</h2>
            <div className="flex items-center gap-3">
              <p className="hidden text-xs text-verdigris-200/50 md:block">Tab moves across · Enter on the last cell adds a row</p>
              <input
                ref={fileRef}
                id="import-file"
                type="file"
                accept=".xlsx,.xlsm,.xls,.csv,.pdf"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importFile(f);
                }}
              />
              <button
                type="button"
                id="import-packing-list"
                disabled={busy || importing !== null}
                onClick={() => fileRef.current?.click()}
                className="rounded-lg border border-verdigris-400/30 px-3 py-1.5 text-xs font-semibold text-verdigris-100 hover:bg-verdigris-400/10 disabled:opacity-50"
              >
                {importing ?? "↥ Import packing list"}
              </button>
            </div>
          </div>
          {importReport && (importReport.skipped.length || importReport.warnings.length) ? (
            <div className="mb-3 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-verdigris-100">
              {importReport.warnings.map((w) => (
                <p key={w}>⚠ {w}</p>
              ))}
              {importReport.skipped.map((sk) => (
                <p key={sk.row}>
                  Row {sk.row} skipped — {sk.reason}
                </p>
              ))}
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[54rem] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-[0.1em] text-verdigris-300">
                <tr>
                  <th className="pb-2 pr-2 w-6">#</th>
                  <th className="pb-2 pr-2 w-40 min-w-[9rem]">Item</th>
                  <th className="pb-2 pr-2 min-w-[12rem]">Description</th>
                  <th className="pb-2 pr-2 w-20 min-w-[5rem]">Cartons</th>
                  <th className="pb-2 pr-2 w-20 min-w-[5rem]">Pcs/ctn</th>
                  <th className="pb-2 pr-2 w-[5.5rem] min-w-[5.5rem]">Unit</th>
                  <th className="pb-2 pr-2 w-20 min-w-[5rem]">Kg/ctn</th>
                  <th className="pb-2 pr-2 w-[4.5rem] text-right">Pieces</th>
                  <th className="pb-2 pr-2 w-[4.5rem] text-right">Kg</th>
                  <th className="pb-2 w-6" />
                </tr>
              </thead>
              <tbody>
                {d.items.map((l, i) => {
                  const c = Number(l.cartonQty) || 0;
                  return (
                    <tr key={l.key} className="align-top">
                      <td className="py-1 pr-2 pt-3 text-verdigris-200/50">{i + 1}</td>
                      <td className="py-1 pr-2">
                        <Combo
                          id={`line-${i}-item`}
                          placeholder="Pick from catalogue"
                          value={l.itemId}
                          onChange={(id) => applyItem(i, id)}
                          options={lookups.items.map((it) => ({
                            id: it.id,
                            label: it.code,
                            sub: [it.description, it.piecesPerCarton ? `${it.piecesPerCarton} ${it.unitCode ?? "pcs"}/ctn` : null]
                              .filter(Boolean)
                              .join(" · "),
                          }))}
                          onAddNew={(typed) => setAdding({ kind: "item", typed, line: i })}
                          addLabel="New item"
                        />
                        <Err text={fields[`items.${i}.itemId`]} />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          value={l.description}
                          onChange={(e) => setLine(i, { description: e.target.value })}
                          className={cell}
                          placeholder="What is in the cartons"
                        />
                        <Err text={fields[`items.${i}.description`]} />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          id={`line-${i}-cartons`}
                          type="number"
                          min={1}
                          value={l.cartonQty}
                          onChange={(e) => setLine(i, { cartonQty: e.target.value })}
                          className={`${cell} text-right`}
                        />
                        <Err text={fields[`items.${i}.cartonQty`]} />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="number"
                          min={1}
                          value={l.piecesPerCarton}
                          onChange={(e) => setLine(i, { piecesPerCarton: e.target.value })}
                          className={`${cell} text-right`}
                        />
                        <Err text={fields[`items.${i}.piecesPerCarton`]} />
                      </td>
                      <td className="py-1 pr-2">
                        <select
                          value={l.unitId ?? ""}
                          onChange={(e) => setLine(i, { unitId: e.target.value ? Number(e.target.value) : null })}
                          className={cell}
                        >
                          <option value="">—</option>
                          {lookups.units.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.code}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="number"
                          min={0}
                          step="0.001"
                          value={l.kgPerCarton}
                          onChange={(e) => setLine(i, { kgPerCarton: e.target.value })}
                          onKeyDown={(e) => onLastCellKey(e, i)}
                          className={`${cell} text-right`}
                        />
                        <Err text={fields[`items.${i}.kgPerCarton`]} />
                      </td>
                      <td className="py-1 pr-2 pt-3 text-right font-mono text-verdigris-100">
                        {fmt(c * (Number(l.piecesPerCarton) || 0))}
                      </td>
                      <td className="py-1 pr-2 pt-3 text-right font-mono text-verdigris-100">
                        {fmt(c * (Number(l.kgPerCarton) || 0))}
                      </td>
                      <td className="py-1 pt-2">
                        <button
                          type="button"
                          aria-label="Remove line"
                          onClick={() => removeRow(i)}
                          className="rounded-md px-1.5 py-1 text-verdigris-200/50 hover:text-rose-300"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-verdigris-300/10 text-sm font-semibold text-verdigris-50">
                  <td className="pt-3" colSpan={3}>
                    <button type="button" onClick={addRow} className="text-xs font-medium text-patina hover:underline">
                      + Add line
                    </button>
                  </td>
                  <td className="pt-3 text-right font-mono">{fmt(totals.cartons)}</td>
                  <td colSpan={3} />
                  <td className="pt-3 pr-2 text-right font-mono">{fmt(totals.pieces)}</td>
                  <td className="pt-3 pr-2 text-right font-mono">{fmt(totals.kg)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <Err text={fields.items} />
        </Card>

        {/* ── 4. Documents ── */}
        <Card className="p-5">
          <h2 className="mb-1 text-base font-semibold text-verdigris-50">4 · Documents (optional)</h2>
          <Documents draftId={d.id} existing={existing} onNeedSave={save} />
        </Card>
        </fieldset>

        {error ? (
          <Card className="border-rose-400/30 p-4">
            <p className="text-sm text-rose-200">{error}</p>
            {Object.keys(fields).length ? (
              <ul className="mt-2 space-y-0.5 text-xs text-rose-200/80">
                {Object.entries(fields).map(([k, v]) => (
                  <li key={k}>
                    • {fieldLabel(k)}: {v}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : null}
      </div>

      {/* ── Summary rail ── */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Summary</p>
          <dl className="mt-3 space-y-2 text-sm">
            {chooser ? <Row k="Importer" v={existing?.importer.name ?? lookups.importer?.name} /> : null}
            <Row k="Warehouse" v={lookups.warehouses.find((w) => w.id === d.warehouseId)?.name} />
            <Row k="Container" v={d.containerNumber || undefined} mono />
            <Row k="Expected" v={d.expectedArrival || undefined} />
            <Row k="Transporter" v={transporter?.name ?? undefined} />
            <Row k="Lines" v={totals.lines ? String(totals.lines) : undefined} />
            <Row k="Cartons" v={totals.cartons ? fmt(totals.cartons) : undefined} />
            <Row k="Pieces" v={totals.pieces ? fmt(totals.pieces) : undefined} />
            <Row k="Weight" v={totals.kg ? `${fmt(totals.kg)} kg` : undefined} />
          </dl>
          <div className="mt-5 flex flex-col gap-2">
            <button type="button" disabled={busy || !importerPicked} onClick={submit} className={primary}>
              {busy ? "Saving…" : "Submit to warehouse"}
            </button>
            <button type="button" disabled={busy || !importerPicked} onClick={saveDraft} className={secondary}>
              Save as draft
            </button>
            <p className="text-center text-[11px] text-verdigris-200/40">⌘S saves the draft</p>
          </div>
        </Card>
      </aside>

      {adding ? (
        <AddDialog
          kind={adding.kind}
          typed={adding.typed}
          lookups={lookups}
          transporterId={d.transporterId}
          warehouseId={d.warehouseId}
          onBehalfOf={onBehalfOf}
          onClose={() => setAdding(null)}
          onAdded={async (kind, id, row) => {
            const line = adding.line;
            setAdding(null);
            if (kind === "item" && row) {
              const next = { ...lookups, items: [...lookups.items, row] };
              setLookups(next);
              if (line !== undefined) {
                setLine(line, {
                  itemId: row.id,
                  description: row.description,
                  unitId: row.unitId,
                  piecesPerCarton: row.piecesPerCarton != null ? String(row.piecesPerCarton) : "",
                  kgPerCarton: row.kgPerCarton != null ? String(row.kgPerCarton) : "",
                  imageUrl: row.imageUrl,
                });
              }
              return;
            }
            await refreshLookups();
            if (kind === "transporter") patch({ transporterId: id, vehicleId: null, driverId: null });
            if (kind === "vehicle") patch({ vehicleId: id });
            if (kind === "driver") patch({ driverId: id });
            toast.success("Added — awaiting approval.");
          }}
        />
      ) : null}
    </div>
  );
}

/** The PDF goes up whole; it has no cells to read here. */
async function importPdf(bytes: ArrayBuffer, q: string) {
  const response = await fetch(`/api/v1/items/import/pdf${q}`, {
    method: "POST",
    headers: { "content-type": "application/pdf" },
    credentials: "same-origin",
    body: bytes,
  });
  const json = (await response.json().catch(() => null)) as { error?: { message?: string } } | ImportResult | null;
  if (!response.ok || !json || "error" in json) {
    return { ok: false as const, error: { message: (json as { error?: { message?: string } } | null)?.error?.message ?? "Could not read that PDF" } };
  }
  return { ok: true as const, data: json as ImportResult };
}

/** Shrink to a thumbnail-sized WebP before it goes up; the register shows it at 40 px. */
async function shrinkPicture(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    const max = 1024;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
    return out && out.size < blob.size ? out : blob;
  } catch {
    return blob;
  }
}

async function uploadPicture(itemId: number, blob: Blob, q: string): Promise<string | null> {
  const picture = await shrinkPicture(blob);
  if (picture.size > 2 * 1024 * 1024) return null;
  const response = await fetch(`/api/v1/items/${itemId}/image${q}`, {
    method: "POST",
    headers: { "content-type": picture.type || "image/png" },
    credentials: "same-origin",
    body: picture,
  });
  if (!response.ok) return null;
  const json = (await response.json().catch(() => null)) as { imageUrl?: string | null } | null;
  return json?.imageUrl ?? null;
}

function Row({ k, v, mono }: { k: string; v?: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-verdigris-200/55">{k}</dt>
      <dd className={`text-right ${v ? "text-verdigris-50" : "text-rose-300/80"} ${mono ? "font-mono" : ""}`}>{v ?? "—"}</dd>
    </div>
  );
}

// ── Documents ─────────────────────────────────────────────────────

function Documents({
  draftId,
  existing,
  onNeedSave,
}: {
  draftId: number | null;
  existing: Detail | null;
  onNeedSave: () => Promise<number | null>;
}) {
  const toast = useToast();
  const [docs, setDocs] = useState(existing?.documents ?? []);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  const upload = async (files: FileList | File[]) => {
    const id = draftId ?? (await onNeedSave());
    if (!id) return;
    setBusy(true);
    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} is over 10 MB`);
        continue;
      }
      const response = await fetch(`/api/v1/inward-requests/${id}/documents`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": file.type || "application/octet-stream", "x-file-name": file.name },
        body: file,
      });
      const payload = (await response.json()) as Detail["documents"][number] & { error?: { message: string } };
      if (!response.ok) {
        toast.error(payload.error?.message ?? "Upload failed");
        continue;
      }
      setDocs((s) => [...s, payload]);
    }
    setBusy(false);
  };

  const remove = async (docId: number) => {
    if (!draftId) return;
    const r = await api<{ removed: boolean }>(`/inward-requests/${draftId}/documents/${docId}`, { method: "DELETE" });
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    setDocs((s) => s.filter((x) => x.id !== docId));
  };

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void upload(e.dataTransfer.files);
        }}
        className={`mt-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-6 text-center text-sm transition-colors ${
          drag ? "border-patina bg-patina/10 text-patina" : "border-verdigris-300/25 text-verdigris-200/60 hover:border-verdigris-300/45"
        }`}
      >
        <input
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            e.target.value = "";
          }}
        />
        {busy ? "Uploading…" : "Drop the bill of lading, packing list or invoice here — or click to choose"}
        <span className="mt-1 text-xs text-verdigris-200/40">PDF, JPG, PNG · up to 10 MB each</span>
      </label>
      {docs.length ? (
        <ul className="mt-3 divide-y divide-verdigris-300/10 rounded-xl border border-verdigris-300/10">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <a href={doc.url} target="_blank" rel="noreferrer" className="truncate text-verdigris-100 hover:text-patina">
                {doc.originalName ?? doc.contentType}
              </a>
              <span className="shrink-0 text-xs text-verdigris-200/45">
                {doc.bytes >= 1024 * 1024 ? `${(doc.bytes / 1048576).toFixed(1)} MB` : `${Math.round(doc.bytes / 1024)} KB`}
              </span>
              <button type="button" onClick={() => remove(doc.id)} className="text-xs text-verdigris-200/50 hover:text-rose-300">
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
