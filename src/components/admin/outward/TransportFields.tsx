"use client";

import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api/client";

export type TransportValue = {
  transporterId: number | null;
  transportName: string;
  transporterMobile: string;
  transporterGstin: string;
  vehicleId: number | null;
  vehicleNo: string;
  vehicleType: string;
  driverId: number | null;
  driverName: string;
  driverMobile: string;
  transportMode: "ROAD" | "RAIL" | "AIR" | "COURIER" | "HAND";
  remarks: string;
};

type Options = {
  transporters: { id: number; name: string; gstin: string | null; mobile: string | null }[];
  vehicles: { id: number; registration: string; type: string | null }[];
  drivers: { id: number; name: string; mobile: string }[];
};

const input = "w-full rounded-xl border bg-ink-900/60 px-3 py-2.5 text-sm text-verdigris-50 placeholder:text-verdigris-200/35";
const ok = "border-verdigris-300/15";
const bad = "border-rose-500";
const label = "mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-verdigris-300";
const plate = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Transporter, vehicle and driver. Pick from the lists (they fill the rest in),
 * or type new ones — they are kept on this dispatch order.
 */
export default function TransportFields({ value: t, onChange, errors = {} }: { value: TransportValue; onChange: (v: TransportValue) => void; errors?: Record<string, string> }) {
  const [opts, setOpts] = useState<Options>({ transporters: [], vehicles: [], drivers: [] });
  const seq = useRef(0);
  const set = (patch: Partial<TransportValue>) => onChange({ ...t, ...patch });

  useEffect(() => {
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      const qs = new URLSearchParams();
      if (t.transporterId) qs.set("transporterId", String(t.transporterId));
      if (t.transportName.trim() && !t.transporterId) qs.set("q", t.transportName.trim());
      const r = await api<Options>(`/outward/transport?${qs.toString()}`, { method: "GET" });
      if (r.ok && mine === seq.current) setOpts(r.data);
    }, 200);
    return () => clearTimeout(timer);
  }, [t.transporterId, t.transportName]);

  const pickTransporter = (name: string) => {
    const hit = opts.transporters.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    if (hit) {
      set({ transporterId: hit.id, transportName: hit.name, transporterGstin: hit.gstin ?? t.transporterGstin, transporterMobile: hit.mobile ?? t.transporterMobile, vehicleId: null, driverId: null });
    } else {
      set({ transporterId: null, transportName: name });
    }
  };
  const pickVehicle = (no: string) => {
    const hit = opts.vehicles.find((v) => plate(v.registration) === plate(no));
    set(hit ? { vehicleId: hit.id, vehicleNo: hit.registration, vehicleType: hit.type ?? t.vehicleType } : { vehicleId: null, vehicleNo: no.toUpperCase() });
  };
  const pickDriver = (name: string) => {
    const hit = opts.drivers.find((d) => d.name.toLowerCase() === name.trim().toLowerCase());
    set(hit ? { driverId: hit.id, driverName: hit.name, driverMobile: hit.mobile } : { driverId: null, driverName: name });
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2" id="transport-fields">
      <div className="sm:col-span-2">
        <label className={label} htmlFor="t-transporter">Transporter</label>
        <input id="t-transporter" list="t-transporters" className={`${input} ${errors.transporterId || errors.transportName ? bad : ok}`} value={t.transportName}
          onChange={(e) => pickTransporter(e.target.value)} placeholder="Search the list, or type a new one" autoComplete="off" />
        <datalist id="t-transporters">{opts.transporters.map((x) => <option key={x.id} value={x.name}>{x.gstin ?? ""}</option>)}</datalist>
        {t.transporterId ? <p className="mt-1 text-[11px] text-emerald-300">From the transporter list — its vehicles and drivers are offered below.</p> : null}
      </div>
      <div>
        <label className={label} htmlFor="t-tmobile">Transporter mobile</label>
        <input id="t-tmobile" inputMode="tel" className={`${input} ${errors.transporterMobile ? bad : ok}`} value={t.transporterMobile} onChange={(e) => set({ transporterMobile: e.target.value })} placeholder="10 digits" />
        {errors.transporterMobile ? <p className="mt-1 text-xs text-rose-300">{errors.transporterMobile}</p> : null}
      </div>
      <div>
        <label className={label} htmlFor="t-gstin">GSTIN / TRANSIN</label>
        <input id="t-gstin" className={`${input} ${ok}`} value={t.transporterGstin} onChange={(e) => set({ transporterGstin: e.target.value.toUpperCase() })} placeholder="If available" />
      </div>
      <div>
        <label className={label} htmlFor="t-vehicle">Vehicle no.</label>
        <input id="t-vehicle" list="t-vehicles" className={`${input} ${errors.vehicleId || errors.vehicleNo ? bad : ok} font-mono uppercase`} value={t.vehicleNo}
          onChange={(e) => pickVehicle(e.target.value)} placeholder="GJ05AB1234" autoComplete="off" />
        <datalist id="t-vehicles">{opts.vehicles.map((v) => <option key={v.id} value={v.registration}>{v.type ?? ""}</option>)}</datalist>
      </div>
      <div>
        <label className={label} htmlFor="t-vtype">Vehicle type</label>
        <input id="t-vtype" className={`${input} ${ok}`} value={t.vehicleType} onChange={(e) => set({ vehicleType: e.target.value })} placeholder="14 ft truck, tempo…" />
      </div>
      <div>
        <label className={label} htmlFor="t-driver">Driver</label>
        <input id="t-driver" list="t-drivers" className={`${input} ${errors.driverId || errors.driverName ? bad : ok}`} value={t.driverName}
          onChange={(e) => pickDriver(e.target.value)} placeholder="Name" autoComplete="off" />
        <datalist id="t-drivers">{opts.drivers.map((d) => <option key={d.id} value={d.name}>{d.mobile}</option>)}</datalist>
      </div>
      <div>
        <label className={label} htmlFor="t-dmobile">Driver mobile</label>
        <input id="t-dmobile" inputMode="tel" className={`${input} ${errors.driverMobile ? bad : ok}`} value={t.driverMobile} onChange={(e) => set({ driverMobile: e.target.value })} placeholder="10 digits" />
        {errors.driverMobile ? <p className="mt-1 text-xs text-rose-300">{errors.driverMobile}</p> : null}
      </div>
      <div>
        <label className={label} htmlFor="t-mode">Mode</label>
        <select id="t-mode" className={`${input} ${ok}`} value={t.transportMode} onChange={(e) => set({ transportMode: e.target.value as TransportValue["transportMode"] })}>
          <option value="ROAD">Road</option>
          <option value="RAIL">Rail</option>
          <option value="AIR">Air</option>
          <option value="COURIER">Courier</option>
          <option value="HAND">By hand</option>
        </select>
      </div>
      <div>
        <label className={label} htmlFor="t-remarks">Remarks</label>
        <input id="t-remarks" className={`${input} ${ok}`} value={t.remarks} onChange={(e) => set({ remarks: e.target.value })} placeholder="Optional" />
      </div>
    </div>
  );
}
