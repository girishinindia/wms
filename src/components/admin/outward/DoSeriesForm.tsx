"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/Toast";
import { Card } from "@/components/admin/ui";
import { api } from "@/lib/api/client";
import type { DoSeries } from "@/lib/outward/ops";

import { FieldError, input, label } from "../delivery/HeaderFields";

/** The company's Dispatch Order numbers — prefix, year, optional warehouse code, next number. */
export default function DoSeriesForm({ initial }: { initial: DoSeries }) {
  const router = useRouter();
  const toast = useToast();
  const [s, setS] = useState({
    prefix: initial.prefix,
    separator: initial.separator as "/" | "-",
    withYear: initial.withYear,
    withWarehouse: initial.withWarehouse,
    padding: String(initial.padding),
    nextNo: String(initial.nextNo),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const pad = Math.min(Math.max(Number(s.padding) || 1, 1), 10);
  const sample = [s.prefix.trim().toUpperCase() || "DO", s.withWarehouse ? "WH-0001" : null, s.withYear ? initial.fy : null, (s.nextNo || "1").padStart(pad, "0")]
    .filter(Boolean)
    .join(s.separator);

  const save = async () => {
    const f: Record<string, string> = {};
    if (!/^[A-Za-z0-9]{1,10}$/.test(s.prefix.trim())) f.prefix = "Letters and numbers only, up to 10";
    if (!/^\d+$/.test(s.nextNo) || Number(s.nextNo) < 1) f.nextNo = "Enter a number, 1 or more";
    if (!/^\d+$/.test(s.padding) || Number(s.padding) < 1 || Number(s.padding) > 10) f.padding = "1 to 10";
    if (Object.keys(f).length) return setErrors(f);
    setBusy(true);
    const r = await api<{ series: DoSeries }>("/outward/series", {
      method: "PUT",
      body: { prefix: s.prefix.trim(), separator: s.separator, withYear: s.withYear, withWarehouse: s.withWarehouse, padding: Number(s.padding), nextNo: Number(s.nextNo) },
    });
    setBusy(false);
    if (!r.ok) {
      if (r.error.fields) setErrors(r.error.fields);
      return toast.error(r.error.message);
    }
    toast.success(`Next dispatch order: ${r.data.series.sample}`);
    setErrors({});
    router.refresh();
  };

  const text = (key: "prefix" | "nextNo" | "padding", ph: string, numeric = false) => (
    <div>
      <input
        id={`doseries-${key}`}
        value={s[key]}
        inputMode={numeric ? "numeric" : undefined}
        placeholder={ph}
        onChange={(e) => {
          setS({ ...s, [key]: numeric ? e.target.value.replace(/\D/g, "") : e.target.value });
          setErrors((x) => ({ ...x, [key]: "" }));
        }}
        className={`${input} ${errors[key] ? "border-rose-500" : "border-verdigris-300/15"}`}
      />
      <FieldError id={`doseries-${key}-err`} text={errors[key]} />
    </div>
  );

  const tick = (key: "withYear" | "withWarehouse", text: string, hint: string) => (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm text-verdigris-100">
      <input type="checkbox" id={`doseries-${key}`} className="mt-1" checked={s[key]} onChange={(e) => setS({ ...s, [key]: e.target.checked })} />
      <span>
        {text}
        <span className="block text-xs text-verdigris-200/55">{hint}</span>
      </span>
    </label>
  );

  return (
    <Card className="max-w-xl space-y-5 p-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className={label}>Prefix</p>
          {text("prefix", "DO")}
        </div>
        <div>
          <p className={label}>Separator</p>
          <select
            id="doseries-separator"
            value={s.separator}
            onChange={(e) => setS({ ...s, separator: e.target.value as "/" | "-" })}
            className={`${input} border-verdigris-300/15`}
          >
            <option value="/">/ (slash)</option>
            <option value="-">- (dash)</option>
          </select>
        </div>
        <div>
          <p className={label}>Digits</p>
          {text("padding", "6", true)}
        </div>
      </div>
      <div className="space-y-3">
        {tick("withYear", `Add the financial year (${initial.fy})`, "Numbers start again from 1 every 1 April.")}
        {tick("withWarehouse", "Add the warehouse code", "Shows which warehouse sent it. The count stays one for the company.")}
      </div>
      <div className="max-w-[12rem]">
        <p className={label}>Next number</p>
        {text("nextNo", "1", true)}
      </div>
      <div className="rounded-xl border border-verdigris-300/10 bg-ink-900/40 p-4 text-sm text-verdigris-100">
        Next dispatch order: <b className="font-mono text-verdigris-50" id="doseries-sample">{sample}</b>
        <p className="mt-2 text-xs text-verdigris-200/70" id="doseries-last">
          Last used: {initial.lastNo ? <b className="font-mono">{initial.lastNo}</b> : "no dispatch order yet"}
        </p>
      </div>
      <button
        type="button"
        id="doseries-save"
        disabled={busy}
        onClick={() => void save()}
        className="rounded-xl bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 hover:bg-patina disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save numbering"}
      </button>
    </Card>
  );
}
