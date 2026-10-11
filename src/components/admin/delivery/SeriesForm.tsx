"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/Toast";
import { Card } from "@/components/admin/ui";
import { api } from "@/lib/api/client";
import type { Series } from "@/lib/delivery/ops";

import { FieldError, input, label } from "./HeaderFields";

export default function SeriesForm({ initial }: { initial: Series }) {
  const router = useRouter();
  const toast = useToast();
  const [s, setS] = useState({ prefix: initial.prefix, nextNo: String(initial.nextNo), orderPrefix: initial.orderPrefix, nextOrderNo: String(initial.nextOrderNo) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const sample = `${s.prefix}/${initial.fy}/${s.nextNo || "…"}`;
  const orderSample = `${s.orderPrefix || "E"}/${initial.fy}/${s.nextOrderNo || "…"}`;

  const save = async () => {
    const f: Record<string, string> = {};
    if (!/^\d+$/.test(s.nextNo) || Number(s.nextNo) < 1) f.nextNo = "Enter a number, 1 or more";
    if (!/^\d+$/.test(s.nextOrderNo) || Number(s.nextOrderNo) < 1) f.nextOrderNo = "Enter a number, 1 or more";
    if (/[/\s]/.test(s.prefix)) f.prefix = "No spaces or /";
    if (Object.keys(f).length) return setErrors(f);
    setBusy(true);
    const r = await api<{ series: Series }>("/delivery/series", {
      method: "PUT",
      body: { prefix: s.prefix, nextNo: Number(s.nextNo), orderPrefix: s.orderPrefix, nextOrderNo: Number(s.nextOrderNo) },
    });
    setBusy(false);
    if (!r.ok) {
      if (r.error.fields) setErrors(r.error.fields);
      return toast.error(r.error.message);
    }
    toast.success(`Next delivery note: ${r.data.series.sample}`);
    setErrors({});
    router.refresh();
  };

  const box = (key: keyof typeof s, ph: string, numeric = false) => (
    <div>
      <input
        id={`series-${key}`}
        value={s[key]}
        inputMode={numeric ? "numeric" : undefined}
        placeholder={ph}
        onChange={(e) => { setS({ ...s, [key]: numeric ? e.target.value.replace(/\D/g, "") : e.target.value }); setErrors((x) => ({ ...x, [key]: "" })); }}
        className={`${input} ${errors[key] ? "border-rose-500" : "border-verdigris-300/15"}`}
      />
      <FieldError id={`series-${key}-err`} text={errors[key]} />
    </div>
  );

  return (
    <Card className="max-w-xl space-y-5 p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div><p className={label}>Note prefix</p>{box("prefix", "Leave empty for /26-27/…")}</div>
        <div><p className={label}>Next note number</p>{box("nextNo", "13888", true)}</div>
        <div><p className={label}>Order prefix</p>{box("orderPrefix", "E")}</div>
        <div><p className={label}>Next order number</p>{box("nextOrderNo", "13258", true)}</div>
      </div>
      <div className="rounded-xl border border-verdigris-300/10 bg-ink-900/40 p-4 text-sm text-verdigris-100">
        Next delivery note: <b className="font-mono text-verdigris-50" id="series-sample">{sample}</b>
        <br />
        Next order: <b className="font-mono text-verdigris-50">{orderSample}</b>
        <p className="mt-2 text-xs text-verdigris-200/55">Numbers start again at 1 on 1 April with the new financial year — set them again then if your series continues.</p>
      </div>
      <div className="flex justify-end">
        <button type="button" id="series-save" disabled={busy} onClick={() => void save()} className="rounded-xl bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 hover:bg-patina disabled:opacity-50">
          {busy ? "Saving…" : "Save numbering"}
        </button>
      </div>
    </Card>
  );
}
