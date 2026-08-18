"use client";

import { useMemo, useState } from "react";

import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { StatusBadge } from "@/components/admin/ui";
import { api } from "@/lib/api/client";
import type { GeoOptions } from "@/lib/admin/geo";
import type { ImporterProfile } from "@/lib/importer/profile";
import { ENTITY_TYPES } from "@/lib/validation/api-admin";
import { PROFILE_REQUIRED } from "@/lib/validation/api-importer";

/**
 * The importer's own company profile: save as you go, submit when it is
 * complete. Fields the database requires before verification are marked;
 * the Submit button explains what is still missing rather than failing.
 *
 * After verification the identity fields (legal name, entity type,
 * GSTIN, PAN) are read-only — the API refuses them too; this only stops
 * the user typing into something that will be rejected.
 */

type Draft = Record<string, string>;

const LABELS: Record<string, string> = {
  companyName: "Company name",
  legalName: "Legal name",
  tradeName: "Trade name",
  entityType: "Entity type",
  address: "Address",
  landmark: "Landmark",
  area: "Area / locality",
  cityId: "City",
  pincode: "Pincode",
  gstin: "GSTIN",
  pan: "PAN",
  contactPerson: "Contact person",
  contactEmail: "Contact email",
  contactMobile: "Contact mobile",
  alternateMobile: "Alternate mobile",
};

const REQUIRED = new Set<string>([...PROFILE_REQUIRED, "companyName", "contactPerson", "contactEmail", "contactMobile"]);
const LOCKED_AFTER_ACTIVE = new Set(["legalName", "entityType", "gstin", "pan"]);

function toDraft(p: ImporterProfile): Draft {
  const out: Draft = {};
  for (const [k, v] of Object.entries(p.profile)) out[k] = v === undefined || v === null ? "" : String(v);
  return out;
}

export default function CompanyProfileForm({
  initial,
  geo,
}: {
  initial: ImporterProfile;
  geo: GeoOptions;
}) {
  const toast = useToast();
  const [profile, setProfile] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [countryId, setCountryId] = useState<string>(initial.countryId ? String(initial.countryId) : geo.countries.length === 1 ? String(geo.countries[0]!.id) : "");
  const [stateId, setStateId] = useState<string>(initial.stateId ? String(initial.stateId) : "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);

  const verified = profile.status === "ACTIVE";
  const submitted = profile.kycStatus === "SUBMITTED";

  const states = useMemo(() => geo.states.filter((s) => String(s.countryId) === countryId), [geo, countryId]);
  const cities = useMemo(() => geo.cities.filter((c) => String(c.stateId) === stateId), [geo, stateId]);

  const set = (k: string, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setErrors((e) => {
      if (!e[k]) return e;
      const rest = { ...e };
      delete rest[k];
      return rest;
    });
  };

  const missing = PROFILE_REQUIRED.filter((k) => !(draft[k] ?? "").trim());
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(profile));

  /** Body for PATCH: only changed keys, typed. */
  function changes(): Record<string, unknown> {
    const base = toDraft(profile);
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(draft)) {
      if (v === base[k]) continue;
      if (verified && LOCKED_AFTER_ACTIVE.has(k)) continue;
      const t = v.trim();
      if (k === "cityId") body[k] = t ? Number(t) : undefined;
      else if (["tradeName", "landmark", "area", "gstin", "pan", "alternateMobile"].includes(k)) body[k] = t === "" ? null : t;
      else if (t !== "") body[k] = t;
    }
    // Optional fields cleared → the schema's `optional()` accepts null.
    return body;
  }

  async function save(): Promise<boolean> {
    const body = changes();
    if (Object.keys(body).length === 0) return true;
    setBusy("save");
    const result = await api<ImporterProfile>("/importer/me", { method: "PATCH", body });
    setBusy(null);
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      toast.error(result.error.message);
      return false;
    }
    setProfile(result.data);
    setDraft(toDraft(result.data));
    toast.success("Profile saved.");
    return true;
  }

  async function submit() {
    if (missing.length) {
      setErrors(Object.fromEntries(missing.map((k) => [k, "Required before submitting"])));
      toast.error(`Fill in: ${missing.map((k) => LABELS[k] ?? k).join(", ")}`);
      return;
    }
    if (!(await save())) return;
    setBusy("submit");
    const result = await api<{ kycStatus: string }>("/importer/me/submit");
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setProfile((p) => ({ ...p, kycStatus: "SUBMITTED", rejectionReason: null }));
    toast.success("Submitted for verification. We will notify you once it is reviewed.");
    // The shell's lock banner is server-rendered; refresh so it reflects
    // the new state.
    window.setTimeout(() => window.location.reload(), 900);
  }

  const input =
    "mt-1 w-full rounded-lg border bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40 disabled:opacity-60";
  const tone = (k: string) => (errors[k] ? "border-rose-400/50" : "border-verdigris-300/15");
  const label = "block text-xs font-medium text-verdigris-200/80";

  // A render function, not a component: a component declared inside the
  // form would be a new type every render, remounting the input and
  // dropping focus on every keystroke.
  const field = ({
    k,
    type = "text",
    mono = false,
    placeholder,
    hint,
    span = false,
  }: {
    k: string;
    type?: string;
    mono?: boolean;
    placeholder?: string;
    hint?: string;
    span?: boolean;
  }) => {
    const locked = verified && LOCKED_AFTER_ACTIVE.has(k);
    return (
      <label className={`${label} ${span ? "sm:col-span-2" : ""}`}>
        {LABELS[k]}
        {REQUIRED.has(k) ? <span className="text-amber-300"> *</span> : null}
        {locked ? <span className="ml-1 text-verdigris-200/45">(locked after verification)</span> : null}
        <input
          type={type}
          value={draft[k] ?? ""}
          onChange={(e) => set(k, mono ? e.target.value.toUpperCase() : e.target.value)}
          disabled={locked || submitted}
          placeholder={placeholder}
          className={`${input} ${tone(k)} ${mono ? "font-mono uppercase" : ""}`}
        />
        {errors[k] ? <span className="mt-1 block text-xs text-rose-300">{errors[k]}</span> : hint ? (
          <span className="mt-1 block text-xs text-verdigris-200/45">{hint}</span>
        ) : null}
      </label>
    );
  };

  const selectClass = `${input} pr-8`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-6"
      >
        <section className="rounded-2xl border border-verdigris-300/10 bg-ink-850 p-6 card-shadow">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-verdigris-300">Company</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {field({ k: "companyName" })}
            {field({ k: "legalName", hint: "Exactly as on the GST certificate" })}
            {field({ k: "tradeName" })}
            <label className={label}>
              {LABELS.entityType}
              <span className="text-amber-300"> *</span>
              {verified ? <span className="ml-1 text-verdigris-200/45">(locked after verification)</span> : null}
              <select
                value={draft.entityType ?? ""}
                onChange={(e) => set("entityType", e.target.value)}
                disabled={verified || submitted}
                className={`${selectClass} ${tone("entityType")}`}
              >
                <option value="" className="bg-ink-850">Choose…</option>
                {ENTITY_TYPES.map((t) => (
                  <option key={t} value={t} className="bg-ink-850">
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              {errors.entityType ? <span className="mt-1 block text-xs text-rose-300">{errors.entityType}</span> : null}
            </label>
            {field({ k: "gstin", mono: true, placeholder: "22AAAAA0000A1Z5" })}
            {field({ k: "pan", mono: true, placeholder: "AAAAA0000A" })}
          </div>
        </section>

        <section className="rounded-2xl border border-verdigris-300/10 bg-ink-850 p-6 card-shadow">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-verdigris-300">Registered address</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {field({ k: "address", span: true })}
            {field({ k: "landmark" })}
            {field({ k: "area" })}
            <label className={label}>
              Country
              <select
                value={countryId}
                onChange={(e) => { setCountryId(e.target.value); setStateId(""); set("cityId", ""); }}
                disabled={submitted}
                className={`${selectClass} border-verdigris-300/15`}
              >
                <option value="" className="bg-ink-850">Choose…</option>
                {geo.countries.map((c) => (
                  <option key={c.id} value={c.id} className="bg-ink-850">{c.name}</option>
                ))}
              </select>
            </label>
            <label className={label}>
              State
              <select
                value={stateId}
                onChange={(e) => { setStateId(e.target.value); set("cityId", ""); }}
                disabled={!countryId || submitted}
                className={`${selectClass} border-verdigris-300/15`}
              >
                <option value="" className="bg-ink-850">Choose…</option>
                {states.map((s) => (
                  <option key={s.id} value={s.id} className="bg-ink-850">{s.name}</option>
                ))}
              </select>
            </label>
            <label className={label}>
              {LABELS.cityId}<span className="text-amber-300"> *</span>
              <select
                value={draft.cityId ?? ""}
                onChange={(e) => set("cityId", e.target.value)}
                disabled={!stateId || submitted}
                className={`${selectClass} ${tone("cityId")}`}
              >
                <option value="" className="bg-ink-850">Choose…</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id} className="bg-ink-850">{c.name}</option>
                ))}
              </select>
              {errors.cityId ? <span className="mt-1 block text-xs text-rose-300">{errors.cityId}</span> : null}
            </label>
            {field({ k: "pincode", mono: true, placeholder: "400001" })}
          </div>
        </section>

        <section className="rounded-2xl border border-verdigris-300/10 bg-ink-850 p-6 card-shadow">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-verdigris-300">Contact</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {field({ k: "contactPerson" })}
            {field({ k: "contactEmail", type: "email" })}
            {field({ k: "contactMobile", placeholder: "98765 43210" })}
            {field({ k: "alternateMobile" })}
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="submit"
            disabled={busy !== null || !dirty || submitted}
            className="inline-flex items-center gap-2 rounded-lg border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45 disabled:opacity-50"
          >
            {busy === "save" ? <Spinner className="h-3.5 w-3.5" /> : null}
            Save
          </button>
          {!verified && profile.status !== "SUSPENDED" ? (
            <button
              type="button"
              onClick={submit}
              disabled={busy !== null || submitted}
              className="inline-flex items-center gap-2 rounded-lg bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-patina disabled:opacity-50"
            >
              {busy === "submit" ? <Spinner className="h-3.5 w-3.5" /> : null}
              {submitted ? "Submitted" : profile.kycStatus === "REJECTED" ? "Resubmit for verification" : "Submit for verification"}
            </button>
          ) : null}
        </div>
      </form>

      <aside className="space-y-4">
        <div className="rounded-2xl border border-verdigris-300/10 bg-ink-850 p-5 card-shadow">
          <p className="text-xs uppercase tracking-[0.12em] text-verdigris-200/55">Verification</p>
          <div className="mt-2 flex items-center gap-2">
            <StatusBadge value={profile.kycStatus} />
            <StatusBadge value={profile.status} />
          </div>
          <p className="mt-3 text-sm text-verdigris-200/75">
            {verified
              ? "Your company is verified. Everything in the portal is open to you."
              : profile.status === "SUSPENDED"
                ? "Your company has been suspended by the warehouse. Contact them to have it reinstated."
                : submitted
                ? "Our team is reviewing your profile. You will get a notification and an email when it is done."
                : profile.kycStatus === "REJECTED"
                  ? "Your profile was returned. Read the remarks below, correct the details and resubmit."
                  : "Fill in the starred fields and submit. A super admin verifies your company, and the portal opens."}
          </p>
          {profile.rejectionReason && !verified ? (
            <div className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">
              <p className="text-xs uppercase tracking-wide text-rose-200/80">Remarks</p>
              <p className="mt-1">{profile.rejectionReason}</p>
            </div>
          ) : null}
        </div>

        {!verified ? (
          <div className="rounded-2xl border border-verdigris-300/10 bg-ink-850 p-5 card-shadow">
            <p className="text-xs uppercase tracking-[0.12em] text-verdigris-200/55">Checklist</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {PROFILE_REQUIRED.map((k) => {
                const done = Boolean((draft[k] ?? "").trim());
                return (
                  <li key={k} className={`flex items-center gap-2 ${done ? "text-verdigris-100" : "text-verdigris-200/60"}`}>
                    <span className={`grid h-4 w-4 place-items-center rounded-full border text-[10px] ${done ? "border-verdigris-300/50 bg-verdigris-500/20" : "border-verdigris-300/25"}`}>
                      {done ? "✓" : ""}
                    </span>
                    {LABELS[k]}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
