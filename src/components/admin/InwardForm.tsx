"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";

import { api } from "@/lib/api/client";
import { addDays, arrivalProblem, earliestArrival, prettyDate } from "@/lib/inward/arrival";
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
  /** Small WebP for the 34 px square; the photo itself only when opened. */
  thumbUrl: string | null;
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
  thumbUrl: null,
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
          thumbUrl: l.thumbUrl,
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
/** Number cells: no spinner arrows eating the width of a narrow column. */
const num = "px-2 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
const label = "mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-verdigris-300";
const primary =
  "rounded-xl bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina disabled:opacity-50";
const secondary =
  "rounded-xl border border-verdigris-300/20 px-4 py-2.5 text-sm text-verdigris-100 hover:border-verdigris-300/45 disabled:opacity-50";

/** Focus a field once the render that enables it has landed. */
function focusSoon(id: string) {
  setTimeout(() => document.getElementById(id)?.focus(), 60);
}

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
  compact = false,
}: {
  id: string;
  options: ComboOption[];
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder: string;
  disabled?: boolean;
  onAddNew?: (typed: string) => void;
  addLabel?: string;
  /** Table-cell sizing, so a picker lines up with the inputs beside it. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const chosen = options.find((o) => o.id === value) ?? null;
  const at = useFloatingList(box, open);

  const q = typed.trim().toLowerCase();
  const matches = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.sub ?? "").toLowerCase().includes(q))
    : options;

  useEffect(() => {
    const away = (e: MouseEvent) => {
      // The list lives outside the box (it floats over the page), so a
      // press inside either one is not "away".
      const t = e.target as Node;
      if (!box.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  // Keep the keyboard cursor in view as it walks a long list.
  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor, open]);

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
        // A narrow column cuts a long code short; hovering shows it whole.
        title={chosen && !open ? [chosen.label, chosen.sub].filter(Boolean).join(" — ") : undefined}
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
        className={`${compact ? cell : input} ${chosen && !open ? "pr-8" : ""}`}
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
      {open && !disabled && at
        ? createPortal(
        <div
          ref={list}
          id={`${id}-listbox`}
          role="listbox"
          style={{ position: "fixed", left: at.left, top: at.top, bottom: at.bottom, width: at.width, maxHeight: at.maxHeight }}
          className="z-[55] overflow-auto rounded-xl border border-verdigris-300/15 bg-ink-850 p-1 shadow-2xl"
        >
          {matches.map((o, i) => (
            <button
              key={o.id}
              data-index={i}
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
        </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/**
 * Where a combobox's list goes. It floats over the page (fixed, in a
 * portal) rather than inside the field's box, so a scrolling table or a
 * card edge can never clip it to one row. Opens downward, or upward when
 * the field sits near the bottom of the window; follows the field when
 * the page scrolls.
 */
function useFloatingList(anchor: RefObject<HTMLDivElement | null>, open: boolean) {
  const [at, setAt] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setAt(null);
      return;
    }
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const gap = 4;
      const margin = 8;
      const below = window.innerHeight - r.bottom - gap - margin;
      const above = r.top - gap - margin;
      // Wide enough to read a code and its description, never off-screen.
      const width = Math.min(Math.max(r.width, 288), window.innerWidth - 2 * margin);
      const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
      const up = below < 240 && above > below;
      setAt(
        up
          ? { left, width, bottom: window.innerHeight - r.top + gap, maxHeight: Math.min(320, above) }
          : { left, width, top: r.bottom + gap, maxHeight: Math.min(320, below) },
      );
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchor]);

  return at;
}

// ── Inline "add new" dialogs ──────────────────────────────────────

type AddKind = "transporter" | "vehicle" | "driver" | "item";

/** How a field cleans what is typed into it, as it is typed. */
type Shape = "text" | "upper" | { digits: number } | "number";

function shaped(raw: string, shape: Shape): string {
  if (shape === "upper") return raw.toUpperCase();
  if (typeof shape === "object") return raw.replace(/\D/g, "").slice(0, shape.digits);
  return raw;
}

/**
 * One labelled field of an add-new dialog.
 *
 * Deliberately a top-level component. Declared inside the dialog, it was
 * a NEW component type on every render, so React threw the input away
 * and built a fresh one on each keystroke — the cursor fell out after
 * every letter.
 */
function AddField({
  k,
  l,
  ph,
  value,
  onChange,
  error,
  shape = "text",
  autoFocus,
}: {
  k: string;
  l: string;
  ph?: string;
  value: string;
  onChange: (k: string, v: string) => void;
  error?: string;
  shape?: Shape;
  autoFocus?: boolean;
}) {
  const digits = typeof shape === "object";
  return (
    <div>
      <label className={label} htmlFor={`add-${k}`}>
        {l}
      </label>
      <input
        id={`add-${k}`}
        type={shape === "number" ? "number" : digits ? "tel" : "text"}
        inputMode={digits ? "numeric" : shape === "number" ? "decimal" : undefined}
        maxLength={digits ? shape.digits : undefined}
        autoFocus={autoFocus}
        autoComplete="off"
        value={value}
        placeholder={ph}
        onChange={(e) => onChange(k, shaped(e.target.value, shape))}
        className={input}
      />
      <Err text={error} />
    </div>
  );
}

/** Caught before anything is sent, so a typo costs no round trip. */
function precheck(kind: AddKind, f: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const need = (k: string, msg: string) => {
    if (!(f[k] ?? "").trim()) out[k] = msg;
  };
  const mobile = (k: string) => {
    const v = f[k] ?? "";
    if (v && !/^[6-9][0-9]{9}$/.test(v)) out[k] = "Enter a 10-digit mobile number";
  };
  if (kind === "transporter") {
    need("name", "Name the transporter");
    need("contactPerson", "Who should the dock call?");
    need("contactMobile", "Enter a 10-digit mobile number");
    mobile("contactMobile");
  } else if (kind === "vehicle") {
    need("registrationNumber", "Enter the vehicle number");
    need("vehicleTypeId", "Choose the vehicle type");
  } else if (kind === "driver") {
    need("name", "Name the driver");
    need("mobile", "Enter a 10-digit mobile number");
    mobile("mobile");
    need("licenceNumber", "Enter the licence number");
    const a = f.aadhaarNumber ?? "";
    if (a && a.length !== 12) out.aadhaarNumber = "Aadhaar is 12 digits";
  } else {
    need("description", "Describe the item");
  }
  return out;
}

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

  // Esc closes, wherever the cursor is.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    const early = precheck(kind, f);
    if (Object.keys(early).length) {
      setFields(early);
      setError(null);
      return;
    }
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

  // Every field shares these; `first` is where the cursor starts.
  const field = (k: string, l: string, opts: { ph?: string; shape?: Shape; first?: boolean } = {}) => (
    <AddField
      k={k}
      l={l}
      ph={opts.ph}
      shape={opts.shape}
      autoFocus={opts.first}
      value={f[k] ?? ""}
      onChange={set}
      error={fields[k]}
    />
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
                {field("name", "Transporter name", { first: true })}
              </div>
              {field("contactPerson", "Contact person")}
              {field("contactMobile", "Mobile", { ph: "10 digits", shape: { digits: 10 } })}
              {field("gstin", "GSTIN (optional)", { shape: "upper" })}
              {field("address", "Address (optional)")}
            </>
          ) : kind === "vehicle" ? (
            <>
              {field("registrationNumber", "Vehicle number", { ph: "MH12AB1234", shape: "upper", first: true })}
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
              {field("capacityKg", "Capacity kg (optional)", { shape: "number" })}
              {field("rcNumber", "RC number (optional)", { shape: "upper" })}
            </>
          ) : kind === "driver" ? (
            <>
              {field("name", "Driver name", { first: true })}
              {field("mobile", "Mobile", { ph: "10 digits", shape: { digits: 10 } })}
              {field("licenceNumber", "Licence number", { ph: "GJ0520190012345", shape: "upper" })}
              {field("aadhaarNumber", "Aadhaar (optional)", { ph: "12 digits", shape: { digits: 12 } })}
            </>
          ) : (
            <>
              {field("code", "Item code", { ph: "As on your packing list — blank to auto-number", shape: "upper", first: true })}
              {field("description", "Item description")}
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
              {field("piecesPerCarton", "Pieces per carton", { shape: "number" })}
              {field("kgPerCarton", "Kg per carton", { shape: "number" })}
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

  // The earliest arrival anyone may enter: tomorrow, India time.
  const firstArrival = earliestArrival();
  const setArrival = (v: string) => {
    patch({ expectedArrival: v });
    const late = arrivalProblem(v);
    setFields((f) => {
      const rest = { ...f };
      delete rest.expectedArrival;
      return late ? { ...rest, expectedArrival: late } : rest;
    });
  };

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
      thumbUrl: it.thumbUrl,
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
        thumbUrl: l.thumbUrl,
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
        const up = await uploadPicture(l.itemId!, pictures.get(l.row)!.blob, q);
        if ("url" in up) {
          setD((s) => ({
            ...s,
            items: s.items.map((x) => (x.itemId === l.itemId ? { ...x, imageUrl: up.url, thumbUrl: up.thumb } : x)),
          }));
        }
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

  // ── A picture for a goods line ──
  const photoRef = useRef<HTMLInputElement>(null);
  /** The line (by key) the file chooser was opened for. */
  const photoFor = useRef<number | null>(null);
  const [photoBusy, setPhotoBusy] = useState<number | null>(null);

  /** The photo box was pressed. The chooser opens at once — a browser
   *  only lets a click open it — and the rest happens once a file is in. */
  const askPhoto = (l: Line) => {
    if (l.itemId === null && l.description.trim().length < 2) {
      toast.error("Pick the item or type what it is first.");
      document.getElementById(`line-${d.items.indexOf(l)}-item`)?.focus();
      return;
    }
    photoFor.current = l.key;
    photoRef.current?.click();
  };

  /** A free-typed line has no catalogue row to hang a picture on, so it
   *  gets one: saved quietly with an auto-numbered code and the line's
   *  own figures. Every other free line with the same description is the
   *  same product, so it is linked too and shows the same picture. */
  const catalogueFor = async (l: Line): Promise<number | null> => {
    const r = await api<Lookups["items"][number] & { usedOn: number; isActive: boolean }>(
      onBehalfOf !== null ? `/items?importerId=${onBehalfOf}` : "/items",
      {
        body: {
          code: "",
          description: l.description.trim(),
          unitId: l.unitId,
          piecesPerCarton: Number(l.piecesPerCarton) > 0 ? Math.round(Number(l.piecesPerCarton)) : null,
          kgPerCarton: Number(l.kgPerCarton) > 0 ? Number(l.kgPerCarton) : null,
        },
      },
    );
    if (!r.ok) {
      toast.error(r.error.message);
      return null;
    }
    const row = r.data;
    const same = l.description.trim().toLowerCase();
    setLookups((lk) => ({ ...lk, items: [...lk.items, row] }));
    setD((s) => ({
      ...s,
      items: s.items.map((x) =>
        x.key === l.key || (x.itemId === null && x.description.trim().toLowerCase() === same) ? { ...x, itemId: row.id } : x,
      ),
    }));
    return row.id;
  };

  /** Add or replace the item's picture straight from the goods line. It
   *  lands on the catalogue row, so every line using that item shows it. */
  const photoPicked = async (file: File) => {
    const key = photoFor.current;
    photoFor.current = null;
    const line = d.items.find((x) => x.key === key);
    if (!line) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose a picture (JPG, PNG or WebP).");
      return;
    }
    setPhotoBusy(line.key);
    try {
      const itemId = line.itemId ?? (await catalogueFor(line));
      if (itemId === null) return;
      const up = await uploadPicture(itemId, file, onBehalfOf !== null ? `?importerId=${onBehalfOf}` : "");
      if ("error" in up) {
        toast.error(up.error);
        return;
      }
      const { url, thumb } = up;
      setD((s) => ({ ...s, items: s.items.map((x) => (x.itemId === itemId ? { ...x, imageUrl: url, thumbUrl: thumb } : x)) }));
      setLookups((lk) => ({
        ...lk,
        items: lk.items.map((it) => (it.id === itemId ? { ...it, imageUrl: url, thumbUrl: thumb } : it)),
      }));
      toast.success(line.itemId === null ? "Saved to the catalogue with its picture." : "Picture saved to the catalogue.");
    } finally {
      setPhotoBusy(null);
      if (photoRef.current) photoRef.current.value = "";
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
                min={firstArrival}
                value={d.expectedArrival}
                onChange={(e) => setArrival(e.target.value)}
                className={input}
              />
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {[
                  { n: 1, l: "Tomorrow" },
                  { n: 3, l: "+3 days" },
                  { n: 7, l: "+1 week" },
                ].map((c) => {
                  const v = addDays(firstArrival, c.n - 1);
                  return (
                    <button
                      key={c.n}
                      type="button"
                      onClick={() => setArrival(v)}
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                        d.expectedArrival === v
                          ? "border-patina bg-patina/15 text-patina"
                          : "border-verdigris-300/20 text-verdigris-200/70 hover:border-patina/50 hover:text-patina"
                      }`}
                    >
                      {c.l}
                    </button>
                  );
                })}
              </div>
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
                ref={photoRef}
                id="line-photo-file"
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void photoPicked(f);
                }}
              />
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
          {/* Fits the card — no sideways scroll on a laptop. Only a phone-
              width window scrolls, and the pickers float over the page so
              nothing here can clip them. */}
          <div className="max-md:overflow-x-auto">
            <table className="w-full table-fixed text-sm max-md:min-w-[44rem]">
              <thead className="text-left text-[11px] uppercase tracking-[0.06em] text-verdigris-300">
                <tr>
                  {/* Item and description share what the number columns leave. */}
                  <th className="pb-2 pr-2 w-5">#</th>
                  <th className="pb-2 pr-2">Item</th>
                  <th className="pb-2 pr-2">Description</th>
                  <th className="pb-2 pr-1.5 w-[3.75rem]">Ctns</th>
                  <th className="pb-2 pr-1.5 w-[3.75rem] whitespace-nowrap">Pcs/ctn</th>
                  <th className="pb-2 pr-1.5 w-[4.25rem]">Unit</th>
                  <th className="pb-2 pr-1.5 w-[3.75rem] whitespace-nowrap">Kg/ctn</th>
                  <th className="pb-2 pr-1.5 w-[4.5rem] text-right">Total</th>
                  <th className="pb-2 w-5" />
                </tr>
              </thead>
              <tbody>
                {d.items.map((l, i) => {
                  const c = Number(l.cartonQty) || 0;
                  return (
                    <tr key={l.key} className="align-top">
                      <td className="py-1 pr-2 pt-[11px] text-verdigris-200/50">{i + 1}</td>
                      <td className="py-1 pr-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            id={`line-${i}-photo`}
                            title={
                              l.imageUrl
                                ? "Replace the item's picture"
                                : l.itemId === null
                                  ? "Add a picture — saves this item to the catalogue"
                                  : "Add a picture of this item"
                            }
                            disabled={photoBusy === l.key}
                            onClick={() => askPhoto(l)}
                            className={`h-[34px] w-[34px] shrink-0 overflow-hidden rounded-lg border text-verdigris-300 hover:border-patina/50 hover:text-patina disabled:opacity-50 ${
                              l.imageUrl ? "border-verdigris-300/15" : "border-dashed border-verdigris-300/30"
                            }`}
                          >
                            {photoBusy === l.key ? (
                              <span className="block text-[10px]">…</span>
                            ) : l.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={l.thumbUrl ?? l.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                            ) : (
                              <svg aria-hidden viewBox="0 0 24 24" className="mx-auto h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 8h3l2-2.5h6L17 8h3v11H4z" />
                                <circle cx="12" cy="13" r="3.5" />
                              </svg>
                            )}
                          </button>
                          <div className="min-w-0 flex-1">
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
                              compact
                            />
                          </div>
                        </div>
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
                      <td className="py-1 pr-1.5">
                        <input
                          id={`line-${i}-cartons`}
                          type="number"
                          min={1}
                          value={l.cartonQty}
                          onChange={(e) => setLine(i, { cartonQty: e.target.value })}
                          className={`${cell} ${num}`}
                        />
                        <Err text={fields[`items.${i}.cartonQty`]} />
                      </td>
                      <td className="py-1 pr-1.5">
                        <input
                          type="number"
                          min={1}
                          value={l.piecesPerCarton}
                          onChange={(e) => setLine(i, { piecesPerCarton: e.target.value })}
                          className={`${cell} ${num}`}
                        />
                        <Err text={fields[`items.${i}.piecesPerCarton`]} />
                      </td>
                      <td className="py-1 pr-1.5">
                        <select
                          value={l.unitId ?? ""}
                          onChange={(e) => setLine(i, { unitId: e.target.value ? Number(e.target.value) : null })}
                          className={`${cell} px-1.5`}
                        >
                          <option value="">—</option>
                          {lookups.units.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.code}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 pr-1.5">
                        <input
                          type="number"
                          min={0}
                          step="0.001"
                          value={l.kgPerCarton}
                          onChange={(e) => setLine(i, { kgPerCarton: e.target.value })}
                          onKeyDown={(e) => onLastCellKey(e, i)}
                          className={`${cell} ${num}`}
                        />
                        <Err text={fields[`items.${i}.kgPerCarton`]} />
                      </td>
                      <td className="py-1 pr-1.5 pt-[5px] text-right font-mono text-[12px] leading-tight text-verdigris-100">
                        <span className="block whitespace-nowrap">{fmt(c * (Number(l.piecesPerCarton) || 0))} pcs</span>
                        <span className="block whitespace-nowrap text-verdigris-200/60">{fmt(c * (Number(l.kgPerCarton) || 0))} kg</span>
                      </td>
                      <td className="py-1 pt-[7px]">
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
                  <td className="pt-3 pr-2 text-right font-mono">{fmt(totals.cartons)}</td>
                  <td colSpan={3} />
                  <td className="pt-3 pr-2 text-right font-mono text-[12px] leading-tight">
                    <span className="block whitespace-nowrap">{fmt(totals.pieces)} pcs</span>
                    <span className="block whitespace-nowrap">{fmt(totals.kg)} kg</span>
                  </td>
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
            <Row k="Expected" v={d.expectedArrival ? prettyDate(d.expectedArrival) : undefined} />
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
                  thumbUrl: row.thumbUrl,
                });
                // Picked and filled — the cartons are what's left to type.
                focusSoon(`line-${line}-cartons`);
              }
              return;
            }
            await refreshLookups();
            if (kind === "transporter") patch({ transporterId: id, vehicleId: null, driverId: null });
            if (kind === "vehicle") patch({ vehicleId: id });
            if (kind === "driver") patch({ driverId: id });
            toast.success("Added — awaiting approval.");
            // On to the next blank in "Who brings it".
            const next = kind === "transporter" ? "vehicle" : kind === "vehicle" && d.driverId === null ? "driver" : null;
            if (next) focusSoon(next);
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

/** The stored picture's URL, or why it was not stored. */
async function uploadPicture(
  itemId: number,
  blob: Blob,
  q: string,
): Promise<{ url: string; thumb: string | null } | { error: string }> {
  const picture = await shrinkPicture(blob);
  if (picture.size > 2 * 1024 * 1024) return { error: "That picture is over 2 MB even after shrinking" };
  const response = await fetch(`/api/v1/items/${itemId}/image${q}`, {
    method: "POST",
    headers: { "content-type": picture.type || "image/png" },
    credentials: "same-origin",
    body: picture,
  });
  const json = (await response.json().catch(() => null)) as
    | { imageUrl?: string | null; thumbUrl?: string | null; error?: { message?: string } }
    | null;
  if (!response.ok || !json?.imageUrl) return { error: json?.error?.message ?? "The picture could not be stored" };
  return { url: json.imageUrl, thumb: json.thumbUrl ?? null };
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
