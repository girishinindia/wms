"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { XIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";

import type { CityOption, TypeOption, WarehouseRow } from "./WarehousesTable";
import { FactList, StatusBadge } from "./ui";

/**
 * Add, correct or read one warehouse.
 *
 * Thirty-three columns is too many for a flat form, so they are grouped
 * the way somebody standing in a warehouse would describe it: what it is
 * called, where it is, how big it is, what it has, who to ring.
 *
 * Only what changed is sent on an edit — the audit row records the
 * fields in the request, and posting the whole form every time would
 * make each save look like a rewrite of the site and bury the one number
 * that actually moved.
 */

export type WarehouseValues = {
  name: string;
  warehouseTypeId: string;
  address: string;
  landmark: string;
  area: string;
  cityId: string;
  pincode: string;
  latitude: string;
  longitude: string;
  gmapUrl: string;
  totalAreaSqft: string;
  usableAreaSqft: string;
  storageCapacityCbm: string;
  palletPositions: string;
  dockCount: string;
  maxVehicleLengthFt: string;
  floorCount: string;
  contactPerson: string;
  contactMobile: string;
  alternateMobile: string;
  notes: string;
};

const EMPTY: WarehouseValues = {
  name: "", warehouseTypeId: "", address: "", landmark: "", area: "", cityId: "", pincode: "",
  latitude: "", longitude: "", gmapUrl: "", totalAreaSqft: "", usableAreaSqft: "",
  storageCapacityCbm: "", palletPositions: "", dockCount: "", maxVehicleLengthFt: "",
  floorCount: "", contactPerson: "", contactMobile: "", alternateMobile: "", notes: "",
};

/** Sent as numbers, not strings — the schema refuses "12" for a count. */
const NUMERIC = new Set([
  "warehouseTypeId", "cityId", "latitude", "longitude", "totalAreaSqft", "usableAreaSqft",
  "storageCapacityCbm", "palletPositions", "dockCount", "maxVehicleLengthFt", "floorCount",
]);

/** Blank clears the column; these four the database will not take empty. */
const REQUIRED = new Set(["name", "warehouseTypeId", "address", "cityId", "pincode"]);

export default function WarehouseDrawer({
  mode,
  warehouse,
  types,
  cities,
  trigger,
}: {
  mode: "create" | "edit" | "view";
  warehouse?: WarehouseRow;
  types: TypeOption[];
  cities: CityOption[];
  trigger: (open: () => void) => ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const initial = warehouse?.edit ?? EMPTY;
  const [draft, setDraft] = useState<WarehouseValues>(initial);
  const [flags, setFlags] = useState(
    warehouse?.flags ?? { hasRacking: true, hasCctv: false, hasWeighbridge: false },
  );
  const [countryId, setCountryId] = useState(warehouse?.countryId ?? "");
  const [stateId, setStateId] = useState(warehouse?.stateId ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const view = mode === "view";
  const countries = [...new Map(cities.map((c) => [c.countryId, c.countryId])).keys()];
  const states = [
    ...new Map(
      cities
        .filter((c) => !countryId || String(c.countryId) === countryId)
        .map((c) => [c.stateId, { id: c.stateId, name: c.stateName }]),
    ).values(),
  ];
  const cityChoices = cities.filter((c) => !stateId || String(c.stateId) === stateId);

  const set = (k: keyof WarehouseValues, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setErrors((e) => {
      if (!e[k]) return e;
      const rest = { ...e };
      delete rest[k];
      return rest;
    });
  };

  function close() {
    setDraft(initial);
    setFlags(warehouse?.flags ?? { hasRacking: true, hasCctv: false, hasWeighbridge: false });
    setCountryId(warehouse?.countryId ?? "");
    setStateId(warehouse?.stateId ?? "");
    setErrors({});
    setOpen(false);
  }

  /** A value ready for the API, or undefined when the box is empty. */
  const shaped = (k: string, raw: string): unknown => {
    const t = raw.trim();
    if (t === "") return REQUIRED.has(k) ? "" : null;
    return NUMERIC.has(k) ? Number(t) : t;
  };

  async function save() {
    const body: Record<string, unknown> = {};
    if (mode === "create") {
      for (const [k, v] of Object.entries(draft)) {
        const shapedValue = shaped(k, v);
        if (shapedValue !== null) body[k] = shapedValue;
      }
      /**
       * `isActive` is not sent, and there is no checkbox for it.
       *
       * A new site is active — the column defaults that way and the
       * schema agrees. Switching one off is the toggle in the list,
       * the same as every master screen: one control, in one place,
       * that cannot disagree with the row beside it.
       */
      Object.assign(body, flags);
    } else {
      for (const key of Object.keys(initial) as (keyof WarehouseValues)[]) {
        if ((draft[key] ?? "").trim() === (initial[key] ?? "").trim()) continue;
        body[key] = shaped(key, draft[key] ?? "");
      }
      for (const [k, v] of Object.entries(flags)) {
        if (warehouse && warehouse.flags[k as keyof typeof flags] !== v) body[k] = v;
      }
      if (Object.keys(body).length === 0) {
        toast.error("Nothing has changed yet.");
        return;
      }
    }

    setBusy(true);
    setErrors({});
    const result =
      mode === "create"
        ? await api<{ id: number; code: string }>("/admin/warehouses", { body })
        : await api(`/admin/warehouses/${warehouse!.id}`, { method: "PATCH", body });
    setBusy(false);

    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      toast.error(result.error.message);
      return;
    }
    toast.success(
      mode === "create"
        ? `${draft.name} added as ${(result.data as { code: string }).code}.`
        : `${draft.name} updated.`,
    );
    setOpen(false);
    router.refresh();
  }

  const input =
    "mt-1.5 w-full min-w-0 rounded-lg border bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40 disabled:opacity-50";
  const label = "block text-xs font-medium leading-5 text-verdigris-200/80";
  const tone = (k: string) => (errors[k] ? "border-rose-400/50" : "border-verdigris-300/15");
  const err = (k: string) =>
    errors[k] ? <span className="mt-1 block text-xs text-rose-300">{errors[k]}</span> : null;
  const section = "text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300";
  const grid = "mt-3 grid gap-x-5 gap-y-4 @lg:grid-cols-2";

  const text = (
    k: keyof WarehouseValues,
    lbl: string,
    opts: { required?: boolean; span?: boolean; placeholder?: string; hint?: string } = {},
  ) => (
    <label className={`${label} ${opts.span ? "@lg:col-span-2" : ""}`}>
      {lbl}
      {opts.required ? <span className="text-amber-300"> *</span> : null}
      <input
        value={draft[k] ?? ""}
        onChange={(e) => set(k, e.target.value)}
        placeholder={opts.placeholder}
        className={`${input} ${tone(k)}`}
      />
      {err(k) ?? (opts.hint ? <span className="mt-1 block text-xs text-verdigris-200/45">{opts.hint}</span> : null)}
    </label>
  );

  const check = (k: keyof typeof flags, lbl: string) => (
    <label className="flex items-center gap-2 text-sm text-verdigris-100">
      <input
        type="checkbox"
        checked={flags[k]}
        onChange={(e) => setFlags((f) => ({ ...f, [k]: e.target.checked }))}
        className="h-4 w-4 accent-verdigris-400"
      />
      {lbl}
    </label>
  );

  const title =
    mode === "create" ? "Add warehouse" : mode === "edit" ? `Edit ${warehouse?.name}` : warehouse?.name ?? "";

  return (
    <>
      {trigger(() => setOpen(true))}

      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 flex justify-end text-left">
              <button type="button" aria-label="Close" onClick={close} className="flex-1 bg-ink-900/70" />
              <aside
                role="dialog"
                aria-modal="true"
                aria-label={mode === "view" ? "Warehouse" : mode === "edit" ? "Edit warehouse" : "Add warehouse"}
                className="@container flex h-full w-full min-w-0 max-w-[min(46rem,100vw)] flex-col border-l border-verdigris-300/10 bg-ink-850 shadow-2xl"
              >
                <header className="flex items-center justify-between border-b border-verdigris-300/10 px-6 py-4">
                  <div>
                    <h2 className="text-base font-semibold text-verdigris-50">{title}</h2>
                    <p className="mt-0.5 text-xs text-verdigris-200/55">
                      {warehouse
                        ? `${warehouse.code} · ${warehouse.photos} ${warehouse.photos === 1 ? "photo" : "photos"} in the gallery`
                        : "The code is assigned automatically as WH-0001."}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={close}
                    className="inline-grid h-8 w-8 place-items-center rounded-lg border border-verdigris-300/15 text-verdigris-200/75 hover:border-verdigris-300/40 hover:text-verdigris-50"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                </header>

                <div className="flex-1 overflow-y-auto px-6 py-6">
                  {view && warehouse ? (
                    <div className="space-y-6">
                      <FactList
                        labelWidth="11rem"
                        items={[
                          { label: "Code", value: warehouse.code, mono: true },
                          { label: "Type", value: warehouse.typeName ?? "—" },
                          { label: "City", value: warehouse.cityLabel ?? "—" },
                          {
                            label: "Address",
                            value:
                              [initial.address, initial.landmark, initial.area, initial.pincode]
                                .filter(Boolean)
                                .join(", ") || "—",
                          },
                          {
                            label: "Total area",
                            value: initial.totalAreaSqft ? `${Number(initial.totalAreaSqft).toLocaleString("en-IN")} sqft` : "—",
                          },
                          {
                            label: "Usable area",
                            value: initial.usableAreaSqft ? `${Number(initial.usableAreaSqft).toLocaleString("en-IN")} sqft` : "—",
                          },
                          { label: "Storage", value: initial.storageCapacityCbm ? `${initial.storageCapacityCbm} cbm` : "—" },
                          { label: "Pallet positions", value: initial.palletPositions || "—" },
                          { label: "Docks", value: initial.dockCount || "—" },
                          { label: "Floors", value: initial.floorCount || "—" },
                          {
                            label: "Facilities",
                            value:
                              [
                                warehouse.flags.hasRacking ? "racking" : "",
                                warehouse.flags.hasCctv ? "CCTV" : "",
                                warehouse.flags.hasWeighbridge ? "weighbridge" : "",
                              ]
                                .filter(Boolean)
                                .join(", ") || "none recorded",
                          },
                          { label: "Contact", value: initial.contactPerson || "—" },
                          { label: "Mobile", value: initial.contactMobile || "—", mono: true },
                          {
                            label: "Map",
                            value: initial.gmapUrl ? (
                              <a
                                href={initial.gmapUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-verdigris-300 hover:text-patina"
                              >
                                Open in Maps
                              </a>
                            ) : (
                              "—"
                            ),
                          },
                          /* The edit form no longer carries an Active
                             checkbox, so this is where you read the
                             state without leaving the drawer. Changing
                             it is the switch in the list. */
                          {
                            label: "Status",
                            value: <StatusBadge value={warehouse.isActive ? "ACTIVE" : "INACTIVE"} />,
                          },
                          { label: "In use by", value: warehouse.inUse || "nobody yet" },
                          { label: "Notes", value: initial.notes || "—" },
                        ]}
                      />
                    </div>
                  ) : (
                    <form
                      id="warehouse-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void save();
                      }}
                      className="space-y-6"
                    >
                      <div>
                        <p className={section}>Identity</p>
                        <div className={grid}>
                          {text("name", "Warehouse name", { required: true, span: true })}
                          <label className={label}>
                            Type<span className="text-amber-300"> *</span>
                            <select
                              value={draft.warehouseTypeId}
                              onChange={(e) => set("warehouseTypeId", e.target.value)}
                              className={`${input} pr-8 ${tone("warehouseTypeId")}`}
                            >
                              <option value="" className="bg-ink-850">Choose…</option>
                              {types.map((t) => (
                                <option key={t.id} value={t.id} className="bg-ink-850">{t.name}</option>
                              ))}
                            </select>
                            {err("warehouseTypeId")}
                          </label>
                        </div>
                      </div>

                      <div>
                        <p className={section}>Address</p>
                        <div className={grid}>
                          {text("address", "Address", { required: true, span: true })}
                          {text("landmark", "Landmark")}
                          {text("area", "Area / locality")}
                          <label className={label}>
                            Country
                            <select
                              value={countryId}
                              onChange={(e) => { setCountryId(e.target.value); setStateId(""); set("cityId", ""); }}
                              className={`${input} pr-8 border-verdigris-300/15`}
                            >
                              <option value="" className="bg-ink-850">Choose…</option>
                              {countries.map((id) => (
                                <option key={id} value={id} className="bg-ink-850">India</option>
                              ))}
                            </select>
                          </label>
                          <label className={label}>
                            State
                            <select
                              value={stateId}
                              onChange={(e) => { setStateId(e.target.value); set("cityId", ""); }}
                              className={`${input} pr-8 border-verdigris-300/15`}
                            >
                              <option value="" className="bg-ink-850">Choose…</option>
                              {states.map((s) => (
                                <option key={s.id} value={s.id} className="bg-ink-850">{s.name}</option>
                              ))}
                            </select>
                          </label>
                          <label className={label}>
                            City<span className="text-amber-300"> *</span>
                            <select
                              value={draft.cityId}
                              onChange={(e) => set("cityId", e.target.value)}
                              className={`${input} pr-8 ${tone("cityId")}`}
                            >
                              <option value="" className="bg-ink-850">Choose…</option>
                              {cityChoices.map((c) => (
                                <option key={c.id} value={c.id} className="bg-ink-850">{c.name}</option>
                              ))}
                            </select>
                            {err("cityId")}
                          </label>
                          {text("pincode", "Pincode", { required: true, placeholder: "421302" })}
                        </div>
                      </div>

                      <div>
                        <p className={section}>Location</p>
                        <div className={grid}>
                          {text("latitude", "Latitude", { placeholder: "19.2967" })}
                          {text("longitude", "Longitude", { placeholder: "73.0631" })}
                          {text("gmapUrl", "Map link", { span: true, placeholder: "https://maps.app.goo.gl/…" })}
                        </div>
                      </div>

                      <div>
                        <p className={section}>Capacity</p>
                        <div className={grid}>
                          {text("totalAreaSqft", "Total area (sqft)")}
                          {text("usableAreaSqft", "Usable area (sqft)", { hint: "Cannot exceed the total" })}
                          {text("storageCapacityCbm", "Storage (cbm)")}
                          {text("palletPositions", "Pallet positions")}
                          {text("dockCount", "Docks")}
                          {text("maxVehicleLengthFt", "Longest vehicle (ft)")}
                          {text("floorCount", "Floors")}
                        </div>
                      </div>

                      <div>
                        <p className={section}>Facilities</p>
                        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
                          {check("hasRacking", "Racking")}
                          {check("hasCctv", "CCTV")}
                          {check("hasWeighbridge", "Weighbridge")}
                        </div>
                      </div>

                      <div>
                        <p className={section}>Contact</p>
                        <div className={grid}>
                          {text("contactPerson", "Contact person")}
                          {text("contactMobile", "Mobile", { placeholder: "9876543210" })}
                          {text("alternateMobile", "Alternate mobile")}
                        </div>
                      </div>

                      <label className={label}>
                        Internal note
                        <textarea
                          value={draft.notes}
                          onChange={(e) => set("notes", e.target.value)}
                          rows={2}
                          className={`${input} ${tone("notes")}`}
                        />
                        {err("notes")}
                      </label>
                    </form>
                  )}
                </div>

                <footer className="flex items-center justify-end gap-2 border-t border-verdigris-300/10 px-6 py-4">
                  <button
                    type="button"
                    onClick={close}
                    disabled={busy}
                    className="rounded-lg border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45"
                  >
                    {view ? "Close" : "Cancel"}
                  </button>
                  {view ? null : (
                    <button
                      type="submit"
                      form="warehouse-form"
                      disabled={busy}
                      className="inline-flex items-center gap-2 rounded-lg bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-patina disabled:opacity-60"
                    >
                      {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
                      {mode === "create" ? "Add warehouse" : "Save changes"}
                    </button>
                  )}
                </footer>
              </aside>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
