"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";

import { XIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";
import type { GeoOptions } from "@/lib/admin/geo";
import { ENTITY_TYPES } from "@/lib/validation/api-admin";

/**
 * "+ Add importer" — the counter version of self-registration, for a
 * customer who signed up by phone.
 *
 * Only the company name and a contact are required. Fill in the KYC
 * fields too and the company can be verified on the spot; leave them and
 * it lands as PENDING, and the importer completes their own profile
 * through the flow that already exists.
 */

const REQUIRED_FOR_VERIFY = ["legalName", "entityType", "address", "cityId", "pincode", "gstin", "pan"];

export default function ImporterCreateDrawer({ geo }: { geo: GeoOptions }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [countryId, setCountryId] = useState(geo.countries.length === 1 ? String(geo.countries[0]!.id) : "");
  const [stateId, setStateId] = useState("");
  const [createLogin, setCreateLogin] = useState(true);
  const [verifyNow, setVerifyNow] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState<
    { company: string; code: string; email: string; password: string | null; verified: boolean } | null
  >(null);

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
  const complete = REQUIRED_FOR_VERIFY.every((k) => (draft[k] ?? "").trim() !== "");

  function reset() {
    setDraft({});
    setStateId("");
    setErrors({});
    setCreateLogin(true);
    setVerifyNow(true);
  }

  async function save() {
    setBusy(true);
    setErrors({});
    const body: Record<string, unknown> = { createLogin, verifyNow: verifyNow && complete };
    for (const [k, v] of Object.entries(draft)) {
      const t = v.trim();
      if (t === "") continue;
      body[k] = k === "cityId" ? Number(t) : t;
    }
    const result = await api<{
      id: number; code: string; status: string; kycStatus: string; login: string; tempPassword: string | null;
    }>("/admin/importers", { body });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      toast.error(result.error.message);
      return;
    }
    toast.success(`${draft.companyName} added as ${result.data.code}.`);
    setCredentials({
      company: draft.companyName ?? "",
      code: result.data.code,
      email: draft.contactEmail ?? "",
      password: result.data.tempPassword,
      verified: result.data.status === "ACTIVE",
    });
    setOpen(false);
    reset();
    router.refresh();
  }

  const input =
    "mt-1.5 w-full min-w-0 rounded-lg border bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40 disabled:opacity-50";
  const label = "block text-xs font-medium leading-5 text-verdigris-200/80";
  const tone = (k: string) => (errors[k] ? "border-rose-400/50" : "border-verdigris-300/15");
  const err = (k: string) =>
    errors[k] ? <span className="mt-1 block text-xs text-rose-300">{errors[k]}</span> : null;

  const text = (
    k: string,
    lbl: string,
    opts: { required?: boolean; mono?: boolean; placeholder?: string; span?: boolean; type?: string } = {},
  ) => (
    <label className={`${label} ${opts.span ? "@lg:col-span-2" : ""}`}>
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
        className="rounded-lg bg-verdigris-400 px-4 py-1.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina"
      >
        Add importer
      </button>

      {open
        ? createPortal(
        <div className="fixed inset-0 z-50 flex justify-end text-left">
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="flex-1 bg-ink-900/70" />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Add importer"
            className="@container flex h-full w-full min-w-0 max-w-[min(42rem,100vw)] flex-col border-l border-verdigris-300/10 bg-ink-850 shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-verdigris-300/10 px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-verdigris-50">Add importer</h2>
                <p className="mt-0.5 text-xs text-verdigris-200/55">
                  For a customer who signed up by phone. Self-registrations arrive on their own.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="inline-grid h-8 w-8 place-items-center rounded-lg border border-verdigris-300/15 text-verdigris-200/75 hover:border-verdigris-300/40 hover:text-verdigris-50"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <form id="importer-create-form" onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Company</p>
                  <div className="mt-3 grid gap-x-5 gap-y-4 @lg:grid-cols-2">
                    {text("companyName", "Company name", { required: true, span: true })}
                    {text("legalName", "Legal name")}
                    <label className={label}>
                      Entity type
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
                    {text("gstin", "GSTIN", { mono: true, placeholder: "22AAAAA0000A1Z5" })}
                    {text("pan", "PAN", { mono: true, placeholder: "AAAAA0000A" })}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Registered address</p>
                  <div className="mt-3 grid gap-x-5 gap-y-4 @lg:grid-cols-2">
                    {text("address", "Address", { span: true })}
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
                      {select(draft.cityId ?? "", (v) => set("cityId", v), cities, { disabled: !stateId, k: "cityId" })}
                      {err("cityId")}
                    </label>
                    {text("pincode", "Pincode", { mono: true, placeholder: "400001" })}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Contact</p>
                  <div className="mt-3 grid gap-x-5 gap-y-4 @lg:grid-cols-2">
                    {text("contactPerson", "Contact person", { required: true })}
                    {text("contactEmail", "Email", { required: true, type: "email" })}
                    {text("contactMobile", "Mobile", { required: true, placeholder: "9876543210" })}
                    {text("alternateMobile", "Alternate mobile")}
                  </div>
                </div>

                <label className={label}>
                  Internal note
                  <textarea
                    value={draft.notes ?? ""}
                    onChange={(e) => set("notes", e.target.value)}
                    rows={2}
                    className={`${input} ${tone("notes")}`}
                  />
                </label>

                <label className="flex items-start gap-2 text-sm text-verdigris-100">
                  <input
                    type="checkbox"
                    checked={createLogin}
                    onChange={(e) => setCreateLogin(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-verdigris-400"
                  />
                  <span>
                    Create a portal login for the contact
                    <span className="block text-xs text-verdigris-200/55">
                      A temporary password is emailed and shown to you once; they change it at first sign-in.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-2 text-sm text-verdigris-100">
                  <input
                    type="checkbox"
                    checked={verifyNow && complete}
                    disabled={!complete}
                    onChange={(e) => setVerifyNow(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-verdigris-400 disabled:opacity-40"
                  />
                  <span>
                    Verify now — open the portal immediately
                    <span className="block text-xs text-verdigris-200/55">
                      {complete
                        ? "Everything the database requires is filled in."
                        : "Needs legal name, entity type, address, city, pincode, GSTIN and PAN. Without them the importer completes their own profile and you verify it."}
                    </span>
                  </span>
                </label>
              </form>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-verdigris-300/10 px-6 py-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-lg border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="importer-create-form"
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-patina disabled:opacity-60"
              >
                {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
                Add importer
              </button>
            </footer>
          </aside>
        </div>,
            document.body,
          )
        : null}

      {credentials ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 text-left">
          <div className="absolute inset-0 bg-ink-900/70" aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Importer created"
            className="relative w-full max-w-md rounded-2xl border border-verdigris-300/20 bg-ink-850 p-6 card-shadow"
          >
            <h2 className="text-base font-semibold text-verdigris-50">
              {credentials.company} added as {credentials.code}
            </h2>
            <p className="mt-2 text-sm text-verdigris-200/75">
              {credentials.verified
                ? "The company is verified — the portal is open to them."
                : "They will be asked to complete their company profile and submit it for verification."}
            </p>
            {credentials.password ? (
              <>
                <p className="mt-3 text-sm text-verdigris-200/75">
                  The temporary password below was also emailed to {credentials.email}. It is shown here
                  ONCE — copy it if you want to hand it over yourself.
                </p>
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-verdigris-300/20 bg-ink-900/60 px-4 py-3">
                  <code className="flex-1 select-all font-mono text-lg tracking-wider text-verdigris-50">
                    {credentials.password}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(credentials.password!).then(() => toast.success("Copied."));
                    }}
                    className="rounded-lg border border-verdigris-300/25 px-3 py-1.5 text-xs text-verdigris-100 hover:border-verdigris-300/50"
                  >
                    Copy
                  </button>
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-verdigris-200/75">No login was created for this company.</p>
            )}
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setCredentials(null)}
                className="rounded-lg bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-patina"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
