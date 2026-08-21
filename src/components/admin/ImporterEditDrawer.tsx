"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { XIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import type { GeoOptions } from "@/lib/admin/geo";
import { api } from "@/lib/api/client";
import { ENTITY_TYPES } from "@/lib/validation/api-admin";

/**
 * "Edit" — a super admin correcting a company's record, at any status.
 *
 * The same drawer as "Add importer" on purpose: the fields are the same
 * fields, and an operator who has added a company should not have to
 * learn a second layout to fix a typo in it.
 *
 * Only what actually changed is sent. That is not an optimisation — the
 * audit row records the fields in the request, so sending the whole form
 * every time would make every save look like a rewrite of the company
 * and bury the one field that really moved.
 */

export type ImporterEditValues = {
  companyName: string;
  legalName: string;
  tradeName: string;
  entityType: string;
  gstin: string;
  pan: string;
  address: string;
  landmark: string;
  area: string;
  cityId: string;
  pincode: string;
  contactPerson: string;
  contactEmail: string;
  contactMobile: string;
  alternateMobile: string;
  notes: string;
};

/** Blank means "clear this column", so the API is sent "" rather than
 *  nothing — except for the four the database will not accept empty. */
const REQUIRED = new Set(["companyName", "contactPerson", "contactEmail", "contactMobile"]);

export default function ImporterEditDrawer({
  importerId,
  companyName,
  geo,
  initial,
  initialCountryId,
  initialStateId,
  verified,
}: {
  importerId: number;
  companyName: string;
  geo: GeoOptions;
  initial: ImporterEditValues;
  initialCountryId: string;
  initialStateId: string;
  /** ACTIVE or SUSPENDED — the KYC fields cannot be emptied on one. */
  verified: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [countryId, setCountryId] = useState(initialCountryId);
  const [stateId, setStateId] = useState(initialStateId);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const set = (k: string, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setErrors((e) => {
      if (!e[k]) return e;
      const rest = { ...e };
      delete rest[k];
      return rest;
    });
  };

  const states = geo.states.filter((s) => String(s.countryId) === countryId);
  const cities = geo.cities.filter((c) => String(c.stateId) === stateId);

  /** Field by field against what the server sent us. */
  const changed = () => {
    const body: Record<string, unknown> = {};
    for (const key of Object.keys(initial) as (keyof ImporterEditValues)[]) {
      const next = (draft[key] ?? "").trim();
      if (next === (initial[key] ?? "").trim()) continue;
      if (next === "" && REQUIRED.has(key)) {
        // Let the server say it, in the same words it uses everywhere else.
        body[key] = "";
        continue;
      }
      body[key] = key === "cityId" ? (next === "" ? null : Number(next)) : next;
    }
    return body;
  };

  function close() {
    setDraft(initial);
    setCountryId(initialCountryId);
    setStateId(initialStateId);
    setErrors({});
    setOpen(false);
  }

  async function save() {
    const body = changed();
    if (Object.keys(body).length === 0) {
      toast.error("Nothing has changed yet.");
      return;
    }
    setBusy(true);
    setErrors({});
    const result = await api(`/admin/importers/${importerId}`, { method: "PATCH", body });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      toast.error(result.error.message);
      return;
    }
    toast.success(`${draft.companyName || companyName} updated.`);
    setOpen(false);
    setErrors({});
    router.refresh();
  }

  const input =
    "mt-1 w-full rounded-lg border bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40 disabled:opacity-50";
  const label = "block text-xs font-medium text-verdigris-200/80";
  const tone = (k: string) => (errors[k] ? "border-rose-400/50" : "border-verdigris-300/15");
  const err = (k: string) =>
    errors[k] ? <span className="mt-1 block text-xs text-rose-300">{errors[k]}</span> : null;

  const text = (
    k: string,
    lbl: string,
    opts: { required?: boolean; mono?: boolean; placeholder?: string; span?: boolean; type?: string } = {},
  ) => (
    <label className={`${label} ${opts.span ? "sm:col-span-2" : ""}`}>
      {lbl}
      {opts.required ? <span className="text-amber-300"> *</span> : null}
      <input
        type={opts.type ?? "text"}
        value={draft[k] ?? ""}
        onChange={(e) => set(k, opts.mono ? e.target.value.toUpperCase() : e.target.value)}
        placeholder={opts.placeholder}
        className={`${input} ${tone(k)} ${opts.mono ? "font-mono uppercase" : ""}`}
      />
      {err(k)}
    </label>
  );

  const select = (
    value: string,
    onChange: (v: string) => void,
    options: { id: number | string; name: string }[],
    opts: { disabled?: boolean; k?: string } = {},
  ) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={opts.disabled}
      className={`${input} pr-8 ${tone(opts.k ?? "")}`}
    >
      <option value="" className="bg-ink-850">Choose…</option>
      {options.map((o) => (
        <option key={o.id} value={o.id} className="bg-ink-850">{o.name}</option>
      ))}
    </select>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-verdigris-300/25 px-3.5 py-1.5 text-xs font-semibold text-verdigris-100 transition-colors hover:border-verdigris-300/55 hover:text-verdigris-50"
      >
        Edit
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button type="button" aria-label="Close" onClick={close} className="flex-1 bg-ink-900/70" />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Edit importer"
            className="flex h-full w-full max-w-lg flex-col border-l border-verdigris-300/10 bg-ink-850 shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-verdigris-300/10 px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-verdigris-50">Edit {companyName}</h2>
                <p className="mt-0.5 text-xs text-verdigris-200/55">
                  Corrects the company record. Status, verification and credit terms are not changed here.
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

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <form id="importer-edit-form" onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Company</p>
                  <div className="mt-2 grid gap-4 sm:grid-cols-2">
                    {text("companyName", "Company name", { required: true, span: true })}
                    {text("legalName", "Legal name", { required: verified })}
                    <label className={label}>
                      Entity type
                      {verified ? <span className="text-amber-300"> *</span> : null}
                      <select
                        value={draft.entityType ?? ""}
                        onChange={(e) => set("entityType", e.target.value)}
                        className={`${input} pr-8 ${tone("entityType")}`}
                      >
                        <option value="" className="bg-ink-850">Choose…</option>
                        {ENTITY_TYPES.map((t) => (
                          <option key={t} value={t} className="bg-ink-850">{t.replace(/_/g, " ")}</option>
                        ))}
                      </select>
                      {err("entityType")}
                    </label>
                    {text("tradeName", "Trade name")}
                    {/* Not starred even on a verified company: GSTIN and PAN are
                        required to SUBMIT a profile, not to hold one — companies
                        verified before that rule exist without either. */}
                    {text("gstin", "GSTIN", { mono: true, placeholder: "22AAAAA0000A1Z5" })}
                    {text("pan", "PAN", { mono: true, placeholder: "AAAAA0000A" })}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Registered address</p>
                  <div className="mt-2 grid gap-4 sm:grid-cols-2">
                    {text("address", "Address", { span: true, required: verified })}
                    {text("landmark", "Landmark")}
                    {text("area", "Area / locality")}
                    <label className={label}>
                      Country
                      {select(countryId, (v) => { setCountryId(v); setStateId(""); set("cityId", ""); }, geo.countries)}
                    </label>
                    <label className={label}>
                      State
                      {select(stateId, (v) => { setStateId(v); set("cityId", ""); }, states, { disabled: !countryId })}
                    </label>
                    <label className={label}>
                      City
                      {verified ? <span className="text-amber-300"> *</span> : null}
                      {select(draft.cityId ?? "", (v) => set("cityId", v), cities, { disabled: !stateId, k: "cityId" })}
                      {err("cityId")}
                    </label>
                    {text("pincode", "Pincode", { mono: true, required: verified, placeholder: "400001" })}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Contact</p>
                  <div className="mt-2 grid gap-4 sm:grid-cols-2">
                    {text("contactPerson", "Contact person", { required: true })}
                    {text("contactEmail", "Email", { required: true, type: "email" })}
                    {text("contactMobile", "Mobile", { required: true, placeholder: "9876543210" })}
                    {text("alternateMobile", "Alternate mobile")}
                  </div>
                  <p className="mt-2 text-xs text-verdigris-200/50">
                    The company&rsquo;s contact details. The owner&rsquo;s sign-in email and mobile are
                    theirs to change, from their profile, with a code.
                  </p>
                </div>

                <label className={label}>
                  Internal note
                  <textarea
                    value={draft.notes ?? ""}
                    onChange={(e) => set("notes", e.target.value)}
                    rows={2}
                    className={`${input} ${tone("notes")}`}
                  />
                  {err("notes")}
                </label>

                {verified ? (
                  <p className="rounded-lg border border-verdigris-300/15 bg-verdigris-500/[0.06] px-3 py-2 text-xs text-verdigris-200/70">
                    This company is past the pending stage, so the starred fields cannot be left
                    empty — the database keeps a verified record complete. Everything else can be
                    cleared by emptying the box.
                  </p>
                ) : null}
              </form>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-verdigris-300/10 px-6 py-4">
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="rounded-lg border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="importer-edit-form"
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-patina disabled:opacity-60"
              >
                {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
                Save changes
              </button>
            </footer>
          </aside>
        </div>
      ) : null}
    </>
  );
}
