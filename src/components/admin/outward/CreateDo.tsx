"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useToast } from "@/components/Toast";
import { Card } from "@/components/admin/ui";
import { api } from "@/lib/api/client";
import type { DoDetail, NewDoData } from "@/lib/outward/ops";

import TransportFields, { type TransportValue } from "./TransportFields";

const n = (v: number) => v.toLocaleString("en-IN");

/** Make a Dispatch Order: tick the packages going on this vehicle, say which vehicle and driver. */
export default function CreateDo({ data }: { data: NewDoData }) {
  const router = useRouter();
  const toast = useToast();
  const [picked, setPicked] = useState<Set<number>>(() => new Set(data.packages.map((p) => p.id)));
  const [t, setT] = useState<TransportValue>({
    transporterId: null,
    transportName: data.note.transportName ?? "",
    transporterMobile: data.note.transporterMobile ?? "",
    transporterGstin: data.note.transporterGstin ?? "",
    vehicleId: null,
    vehicleNo: "",
    vehicleType: "",
    driverId: null,
    driverName: "",
    driverMobile: "",
    transportMode: "ROAD",
    remarks: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const chosen = data.packages.filter((p) => picked.has(p.id));
  const cartons = chosen.reduce((a, p) => a + p.cartons, 0);
  const kg = chosen.reduce((a, p) => a + (p.weightKg ?? 0), 0);
  const all = picked.size === data.packages.length;
  const left = data.note.open - cartons;

  const toggle = (id: number) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => setErrors({}), [t]);

  const missing = useMemo(
    () => [!t.transportName.trim() && "transporter", !t.vehicleNo.trim() && "vehicle no.", !t.driverName.trim() && "driver", !/^[6-9]\d{9}$/.test(t.driverMobile.replace(/\D/g, "").slice(-10)) && "driver mobile"].filter(Boolean),
    [t],
  );

  const create = async () => {
    if (!chosen.length) return toast.error("Tick at least one package");
    setBusy(true);
    const r = await api<{ order: DoDetail }>("/outward", {
      body: {
        noteId: data.note.id,
        packageIds: chosen.map((p) => p.id),
        transporterId: t.transporterId,
        transportName: t.transportName || null,
        transporterMobile: t.transporterMobile || null,
        transporterGstin: t.transporterGstin || null,
        vehicleId: t.vehicleId,
        vehicleNo: t.vehicleNo || null,
        vehicleType: t.vehicleType || null,
        driverId: t.driverId,
        driverName: t.driverName || null,
        driverMobile: t.driverMobile || null,
        transportMode: t.transportMode,
        remarks: t.remarks || null,
      },
    });
    setBusy(false);
    if (!r.ok) {
      if (r.error.fields) setErrors(r.error.fields);
      return toast.error(r.error.message);
    }
    toast.success(`${r.data.order.doNo} made${r.data.order.status === "READY_FOR_OUTWARD" ? " — ready to load" : " — fill in the missing details"}.`);
    router.push(`/admin/outward/${r.data.order.id}`);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-5">
        <Card className="p-5" >
          <div id="newdo-note" className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">To</p>
              <p className="text-base font-semibold text-verdigris-50">{data.note.buyerName}</p>
              <p className="text-sm text-verdigris-200/70">{[data.note.buyerAddress, data.note.destination].filter(Boolean).join(" · ")}</p>
              <p className="mt-1 text-xs text-verdigris-200/55">
                <Link href={`/admin/delivery-notes/${data.note.id}`} className="font-mono hover:text-patina">{data.note.dnNo}</Link> · order {data.note.orderNo} · {data.note.importerName} · {data.note.warehouseName}
              </p>
            </div>
            {data.note.priority === "URGENT" ? <span className="rounded-full border border-rose-400/40 px-2.5 py-0.5 text-xs text-rose-200">Urgent</span> : null}
          </div>
          {data.otherDos.length ? (
            <p className="mt-3 text-xs text-verdigris-200/60">
              Already on: {data.otherDos.map((o) => <Link key={o.id} href={`/admin/outward/${o.id}`} className="mr-2 font-mono hover:text-patina">{o.doNo} ({o.status.toLowerCase().replace(/_/g, " ")})</Link>)}
            </p>
          ) : null}
        </Card>

        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Packages on this vehicle</p>
            <button
              type="button"
              id="newdo-all"
              onClick={() => setPicked(all ? new Set() : new Set(data.packages.map((p) => p.id)))}
              className="text-xs text-verdigris-300 hover:text-patina"
            >
              {all ? "Untick all" : "Tick all"}
            </button>
          </div>
          {data.packages.length === 0 ? (
            <p className="mt-3 text-sm text-amber-200">No verified package is waiting on this note.</p>
          ) : (
            <ul className="mt-3 divide-y divide-verdigris-300/10 rounded-xl border border-verdigris-300/10" id="newdo-packages">
              {data.packages.map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-start gap-3 p-3 hover:bg-patina/5">
                    <input type="checkbox" className="mt-1" checked={picked.has(p.id)} onChange={() => toggle(p.id)} data-package={p.code} />
                    <span className="min-w-0 flex-1">
                      <span className="font-mono text-sm text-verdigris-50">{p.code}</span>
                      <span className="ml-2 text-xs text-verdigris-200/60">{p.kind === "SINGLE" ? "single carton" : p.kind.toLowerCase()} · {n(p.cartons)} carton{p.cartons === 1 ? "" : "s"}{p.weightKg ? ` · ${p.weightKg} kg` : ""}</span>
                      <span className="block truncate text-xs text-verdigris-200/55">{p.items}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Transporter, vehicle and driver</p>
          <TransportFields value={t} onChange={setT} errors={errors} />
        </Card>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Card className="p-5" >
          <div id="newdo-summary">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">This dispatch order</p>
            <p className="mt-1 font-mono text-lg font-semibold text-verdigris-50">{data.nextNo}</p>
            <p className="text-xs text-verdigris-200/55">The number is given when it is made.</p>
            <p className="mt-3 text-sm text-verdigris-100">
              {n(chosen.length)} package{chosen.length === 1 ? "" : "s"} · {n(cartons)} carton{cartons === 1 ? "" : "s"}{kg ? ` · ${kg.toFixed(1)} kg` : ""}
            </p>
            {left > 0 ? (
              <p className="mt-1 text-xs text-amber-200" id="newdo-left">{n(left)} carton{left === 1 ? "" : "s"} of the note stay for another vehicle (or are still being packed).</p>
            ) : (
              <p className="mt-1 text-xs text-emerald-300">Everything on the note goes on this vehicle.</p>
            )}
            {missing.length ? (
              <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 p-2 text-xs text-amber-100" id="newdo-missing">
                Missing {missing.join(", ")} — you can make the DO now and add them before loading.
              </p>
            ) : null}
            <button
              type="button"
              id="newdo-create"
              disabled={busy || !chosen.length}
              onClick={() => void create()}
              className="mt-4 w-full rounded-xl bg-verdigris-400 px-4 py-2.5 text-sm font-semibold text-ink-900 hover:bg-patina disabled:opacity-50"
            >
              {busy ? "Making…" : "Make dispatch order"}
            </button>
          </div>
        </Card>
      </aside>
    </div>
  );
}
