"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import Field from "@/components/Field";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";

import { Card, FactList } from "./ui";

/**
 * The decision.
 *
 * Approval and rejection share a screen because they share an input: the
 * reviewer reads the same registration either way, and splitting them
 * across two pages means reading it twice.
 *
 * The approve form carries the five fields
 * `importer_complete_before_active` demands. They are marked required
 * here for the user's sake, but the check constraint is the thing that
 * actually guarantees an ACTIVE importer is a complete one — this form
 * is a good error message in front of it, not a replacement for it.
 */

export type CityOption = { id: number; name: string; stateName: string };

const ENTITY_TYPES = [
  ["PRIVATE_LIMITED", "Private limited"],
  ["PUBLIC_LIMITED", "Public limited"],
  ["LLP", "LLP"],
  ["PARTNERSHIP", "Partnership"],
  ["PROPRIETORSHIP", "Proprietorship"],
  ["HUF", "HUF"],
  ["TRUST", "Trust"],
  ["SOCIETY", "Society"],
  ["GOVERNMENT", "Government"],
] as const;

type Errors = Record<string, string>;

export type SubmittedProfile = {
  legalName: string;
  tradeName: string;
  entityType: string;
  address: string;
  landmark: string;
  area: string;
  cityId: string;
  cityLabel: string;
  pincode: string;
  gstin: string;
  pan: string;
};

const LABEL: Record<string, string> = {
  legalName: "Legal name",
  entityType: "Entity type",
  address: "Address",
  cityId: "City",
  pincode: "Pincode",
  gstin: "GSTIN",
  pan: "PAN",
};

export default function ImporterReview({
  importerId,
  companyName,
  cities,
  canDecide,
  initial,
  kycStatus,
  missing,
  rejectionReason,
}: {
  importerId: number;
  companyName: string;
  cities: CityOption[];
  canDecide: boolean;
  /** What the importer has saved so far — pre-fills the form and, once
   *  submitted and complete, is shown read-only for verification. */
  initial: SubmittedProfile;
  kycStatus: string;
  /** Required fields the importer has not filled yet. */
  missing: string[];
  rejectionReason: string | null;
}) {
  const router = useRouter();
  const toast = useToast();

  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const submitted = kycStatus === "SUBMITTED";
  const complete = missing.length === 0;
  /** Submitted and complete → verify what they sent; otherwise the
   *  reviewer fills the gaps themselves (an admin-created importer, or
   *  a phone-and-paper KYC). */
  const [editing, setEditing] = useState(!(submitted && complete));

  const [form, setForm] = useState({
    legalName: initial.legalName || companyName,
    entityType: initial.entityType || "PRIVATE_LIMITED",
    address: initial.address,
    cityId: initial.cityId || (cities[0]?.id ? String(cities[0].id) : ""),
    pincode: initial.pincode,
    gstin: initial.gstin,
    pan: initial.pan,
    notes: "",
  });

  const set = (key: keyof typeof form) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  };

  async function approve() {
    setFormError(null);
    setErrors({});

    if (cities.length === 0) {
      setFormError("There are no cities to choose from yet. Add one first.");
      toast.error("Add a city before approving.");
      return;
    }

    setBusy("approve");
    const result = await api<{ code: string }>(`/admin/importers/${importerId}/approve`, {
      body: {
        legalName: form.legalName,
        entityType: form.entityType,
        address: form.address,
        cityId: Number(form.cityId),
        pincode: form.pincode,
        gstin: form.gstin || undefined,
        pan: form.pan || undefined,
        notes: form.notes || undefined,
      },
    });
    setBusy(null);

    if (!result.ok) {
      // This form is not react-hook-form, so `applyFieldErrors` does not
      // fit — the server's field map goes straight into local state.
      const fields = result.error.fields;
      if (fields && Object.keys(fields).length > 0) setErrors(fields);
      else setFormError(result.error.message);
      toast.error(result.error.message);
      return;
    }

    toast.success(`${companyName} approved as ${result.data.code}.`);
    router.refresh();
  }

  async function reject() {
    setFormError(null);
    if (reason.trim().length < 10) {
      setErrors({ reason: "Give a reason of at least 10 characters" });
      toast.error("A rejection needs a reason.");
      return;
    }

    setBusy("reject");
    const result = await api<{ ok: true }>(`/admin/importers/${importerId}/reject`, {
      body: { reason: reason.trim() },
    });
    setBusy(null);

    if (!result.ok) {
      setFormError(result.error.message);
      toast.error(result.error.message);
      return;
    }

    toast.success("Rejected, and the applicant has been told why.");
    setRejecting(false);
    router.refresh();
  }

  if (!canDecide) {
    return (
      <Card className="p-6">
        <p className="text-sm text-verdigris-200/70">
          This registration is waiting for a decision, but your account does not hold{" "}
          <span className="font-mono text-xs text-verdigris-300">importer.approve</span>.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-verdigris-50">
            {submitted ? "Submitted for verification" : "Complete and approve"}
          </h2>
          <p className="mt-1 text-xs text-verdigris-200/50">
            {submitted
              ? "The importer completed their profile and asked to be verified. Check it against their documents, then approve or return it."
              : kycStatus === "REJECTED"
                ? "Returned to the importer with remarks; they can fix it and resubmit. You may still complete and approve it yourself."
                : "The importer has not submitted their profile yet. Wait for them, or fill in what is missing and approve."}
          </p>
        </div>
        {submitted && complete ? (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="rounded-lg border border-verdigris-300/20 px-3 py-1.5 text-xs text-verdigris-100 hover:border-verdigris-300/45"
          >
            {editing ? "Show as submitted" : "Edit before approving"}
          </button>
        ) : null}
      </div>

      {!complete && !submitted ? (
        <p className="mt-3 rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          Still missing: {missing.map((m) => LABEL[m] ?? m).join(", ")}.
        </p>
      ) : null}
      {kycStatus === "REJECTED" && rejectionReason ? (
        <p className="mt-3 rounded-lg border border-rose-400/25 bg-rose-500/[0.06] px-3 py-2 text-xs text-rose-100">
          Last remarks: {rejectionReason}
        </p>
      ) : null}

      {!editing ? (
        <div className="mt-5">
          <FactList
            items={[
              { label: "Legal name", value: initial.legalName },
              { label: "Trade name", value: initial.tradeName || "—" },
              { label: "Entity type", value: initial.entityType.replace(/_/g, " ") },
              { label: "GSTIN", value: initial.gstin || "—", mono: true },
              { label: "PAN", value: initial.pan || "—", mono: true },
              { label: "Address", value: [initial.address, initial.landmark, initial.area].filter(Boolean).join(", ") },
              { label: "City", value: initial.cityLabel || "—" },
              { label: "Pincode", value: initial.pincode, mono: true },
            ]}
          />
          <div className="mt-4">
            <Field
              id="notes"
              label="Internal note"
              value={form.notes}
              error={errors.notes}
              hint="Not shown to the importer"
              onChange={(e) => set("notes")(e.target.value)}
            />
          </div>
        </div>
      ) : null}

      {formError ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-[13px] text-rose-100"
        >
          {formError}
        </p>
      ) : null}

      {editing ? (
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field
          id="legalName"
          label="Legal name"
          required
          value={form.legalName}
          error={errors.legalName}
          hint="Exactly as it appears on the GST certificate"
          onChange={(e) => set("legalName")(e.target.value)}
        />

        <div>
          <label
            htmlFor="entityType"
            className="mb-1.5 block text-[13px] font-medium text-verdigris-100"
          >
            Entity type <span className="text-rose-300">*</span>
          </label>
          <select
            id="entityType"
            value={form.entityType}
            onChange={(e) => set("entityType")(e.target.value)}
            className="w-full rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-4 py-3 text-[15px] text-verdigris-50 focus:outline-none focus:ring-2 focus:ring-patina/40"
          >
            {ENTITY_TYPES.map(([value, label]) => (
              <option key={value} value={value} className="bg-ink-850">
                {label}
              </option>
            ))}
          </select>
        </div>

        <Field
          id="address"
          label="Registered address"
          required
          value={form.address}
          error={errors.address}
          wrapperClassName="sm:col-span-2"
          onChange={(e) => set("address")(e.target.value)}
        />

        <div>
          <label
            htmlFor="cityId"
            className="mb-1.5 block text-[13px] font-medium text-verdigris-100"
          >
            City <span className="text-rose-300">*</span>
          </label>
          <select
            id="cityId"
            value={form.cityId}
            onChange={(e) => set("cityId")(e.target.value)}
            disabled={cities.length === 0}
            className="w-full rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-4 py-3 text-[15px] text-verdigris-50 focus:outline-none focus:ring-2 focus:ring-patina/40 disabled:opacity-55"
          >
            {cities.length === 0 ? (
              <option value="">No cities added yet</option>
            ) : (
              cities.map((c) => (
                <option key={c.id} value={c.id} className="bg-ink-850">
                  {c.name} — {c.stateName}
                </option>
              ))
            )}
          </select>
          {errors.cityId ? (
            <p role="alert" className="mt-1.5 text-xs text-rose-300">
              {errors.cityId}
            </p>
          ) : null}
        </div>

        <Field
          id="pincode"
          label="Pincode"
          required
          inputMode="numeric"
          maxLength={6}
          value={form.pincode}
          error={errors.pincode}
          onChange={(e) => set("pincode")(e.target.value.replace(/\D/g, ""))}
        />

        <Field
          id="gstin"
          label="GSTIN"
          value={form.gstin}
          error={errors.gstin}
          hint="Optional"
          maxLength={15}
          onChange={(e) => set("gstin")(e.target.value.toUpperCase())}
        />

        <Field
          id="pan"
          label="PAN"
          value={form.pan}
          error={errors.pan}
          hint="Optional"
          maxLength={10}
          onChange={(e) => set("pan")(e.target.value.toUpperCase())}
        />

        <Field
          id="notes"
          label="Internal note"
          value={form.notes}
          error={errors.notes}
          hint="Not shown to the importer"
          wrapperClassName="sm:col-span-2"
          onChange={(e) => set("notes")(e.target.value)}
        />
      </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={approve}
          disabled={busy !== null}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-verdigris-400 px-6 py-3 text-sm font-semibold text-ink-900 transition-all hover:bg-patina disabled:cursor-not-allowed disabled:opacity-55"
        >
          {busy === "approve" ? <Spinner className="h-4 w-4" /> : null}
          {busy === "approve" ? "Approving…" : submitted ? "Verify and activate" : "Approve and activate"}
        </button>

        <button
          type="button"
          onClick={() => setRejecting((v) => !v)}
          disabled={busy !== null}
          className="rounded-xl border border-rose-400/30 px-5 py-3 text-sm font-medium text-rose-200 transition-colors hover:border-rose-400/55 hover:text-rose-100 disabled:opacity-55"
        >
          {rejecting ? "Cancel" : submitted ? "Return with remarks" : "Reject"}
        </button>

        <p className="text-xs text-verdigris-200/40">
          Either way the applicant is notified, and the decision is written to the audit log.
        </p>
      </div>

      {rejecting ? (
        <div className="mt-5 rounded-xl border border-rose-400/25 bg-rose-500/[0.06] p-4">
          <label htmlFor="reason" className="block text-[13px] font-medium text-rose-100">
            Why is this being rejected?
          </label>
          <p className="mt-1 text-xs text-rose-200/60">
            This text is sent to the applicant, so write it for them to read.
          </p>
          <textarea
            id="reason"
            rows={3}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setErrors((err) => ({ ...err, reason: "" }));
            }}
            className="mt-3 w-full rounded-xl border border-rose-400/25 bg-ink-900/60 px-4 py-3 text-[15px] text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-rose-400/40"
            placeholder="The GST certificate does not match the company name given."
          />
          {errors.reason ? (
            <p role="alert" className="mt-1.5 text-xs text-rose-300">
              {errors.reason}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reject}
            disabled={busy !== null}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-rose-500/90 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-500 disabled:opacity-55"
          >
            {busy === "reject" ? <Spinner className="h-4 w-4" /> : null}
            {busy === "reject" ? "Rejecting…" : "Confirm rejection"}
          </button>
        </div>
      ) : null}
    </Card>
  );
}
