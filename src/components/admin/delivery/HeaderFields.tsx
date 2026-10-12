"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api/client";
import type { GeoOptions } from "@/lib/admin/geo";
import type { Client, Header, TransporterPick } from "@/lib/delivery/ops";

export const PAYMENT_MODES = ["Account", "Cash", "UPI", "Credit", "Cheque", "Bank transfer"];
const PACKINGS: [Header["packing"], string][] = [
  ["CARTON", "Cartons"],
  ["BUNDLE", "Bundles"],
  ["LOOSE", "Loose"],
  ["PACKAGE", "Package"],
  ["OTHER", "Other"],
];
const HANDLINGS: [Header["handling"], string][] = [
  ["NORMAL", "Normal"],
  ["FRAGILE", "Fragile"],
  ["HANDLE_WITH_CARE", "Handle with care"],
];

export const input =
  "w-full rounded-xl border bg-ink-900/60 px-3.5 py-2.5 text-[15px] text-verdigris-50 placeholder:text-verdigris-200/35 focus:outline-none focus:ring-2 focus:ring-patina/25";
const ok = "border-verdigris-300/15";
const bad = "border-rose-500 bg-rose-500/5";
export const label = "mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-verdigris-300";
const req = <span className="text-rose-300"> *</span>;

/** Today in India, yyyy-mm-dd — the latest order date allowed. */
export function todayIst(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

export function FieldError({ id, text }: { id: string; text?: string }) {
  return text ? (
    <p id={id} role="alert" className="mt-1 text-xs font-medium text-rose-300">
      {text}
    </p>
  ) : null;
}

function Chip({ on, children, onClick, id }: { on: boolean; children: React.ReactNode; onClick: () => void; id?: string }) {
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-sm ${
        on ? "border-patina bg-patina/15 text-patina" : "border-verdigris-300/15 text-verdigris-200/75 hover:border-verdigris-300/40"
      }`}
    >
      {children}
    </button>
  );
}

let geoCache: Promise<GeoOptions | null> | null = null;
/** States and cities from the master — once per page. */
export function useGeo(): GeoOptions | null {
  const [geo, setGeo] = useState<GeoOptions | null>(null);
  useEffect(() => {
    geoCache ??= api<GeoOptions>("/geo", { method: "GET" }).then((r) => (r.ok ? r.data : null));
    void geoCache.then(setGeo);
  }, []);
  return geo;
}

/**
 * Every field of the delivery note above the items — shared by "new" and
 * "edit". `set` changes a field on screen; `commit` saves it (the new
 * note saves each field as it is left, the edit form saves all at once).
 */
export default function HeaderFields({
  header,
  errors,
  set,
  commit,
  onPickClient,
}: {
  header: Header;
  errors: Record<string, string>;
  set: <K extends keyof Header>(key: K, value: Header[K]) => void;
  commit: (patch: Partial<Header>) => void;
  onPickClient: (c: Client) => void;
}) {
  const geo = useGeo();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Client[]>([]);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [nc, setNc] = useState({ name: "", mobile: "", address: "", stateId: "", cityId: "", pincode: "", gstin: "" });
  const [ncErr, setNcErr] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [tOpen, setTOpen] = useState(false);
  const [transporters, setTransporters] = useState<TransporterPick[]>([]);
  const [billText, setBillText] = useState(header.billAmount == null ? "" : String(header.billAmount));
  useEffect(() => {
    // Changed from outside (Without bill clears it): show the new value.
    setBillText((t) => ((t === "" ? null : Number(t)) === header.billAmount ? t : header.billAmount == null ? "" : String(header.billAmount)));
  }, [header.billAmount]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stateName = useMemo(() => new Map((geo?.states ?? []).map((s) => [s.id, s.name])), [geo]);
  const cityByName = (name: string) => {
    const n = name.trim().toLowerCase();
    return n ? (geo?.cities ?? []).find((c) => c.name.toLowerCase() === n) ?? null : null;
  };

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const r = await api<{ clients: Client[] }>(`/delivery/clients?q=${encodeURIComponent(q)}`, { method: "GET" });
      if (r.ok) setResults(r.data.clients);
    }, 200);
  }, [q, open]);

  const tName = header.transportName ?? "";
  useEffect(() => {
    if (!tOpen) return;
    if (tTimer.current) clearTimeout(tTimer.current);
    tTimer.current = setTimeout(async () => {
      const r = await api<{ transporters: TransporterPick[] }>(`/delivery/transporters?q=${encodeURIComponent(tName)}`, { method: "GET" });
      if (r.ok) setTransporters(r.data.transporters);
    }, 200);
  }, [tName, tOpen]);

  const addClient = async () => {
    setSaving(true);
    // State first, then a city of that state — both from the master list the super admin keeps.
    if (!nc.stateId) {
      setSaving(false);
      setNcErr({ stateId: "Choose the state" });
      return;
    }
    if (!nc.cityId) {
      setSaving(false);
      setNcErr({ cityId: "Choose the city" });
      return;
    }
    const city = (geo?.cities ?? []).find((c) => String(c.id) === nc.cityId) ?? null;
    const r = await api<{ client: Client }>("/delivery/clients", {
      body: { name: nc.name, mobile: nc.mobile, address: nc.address, pincode: nc.pincode, gstin: nc.gstin, cityId: city?.id ?? null },
    });
    setSaving(false);
    if (!r.ok) {
      setNcErr(r.error.fields ?? { name: r.error.message });
      return;
    }
    setAdding(false);
    setNc({ name: "", mobile: "", address: "", stateId: "", cityId: "", pincode: "", gstin: "" });
    setNcErr({});
    onPickClient(r.data.client);
  };

  /** Several fields at once: on screen, then saved together. */
  const setMany = (patch: Partial<Header>) => {
    for (const [k, v] of Object.entries(patch)) set(k as keyof Header, v as never);
    commit(patch);
  };

  const text = (key: keyof Header, ph: string, opts: { id: string; area?: boolean; max?: number; mode?: "tel" | "numeric" | "text"; upper?: boolean }) => {
    const v = (header[key] as string | null) ?? "";
    const cls = `${input} ${errors[key] ? bad : ok}`;
    const common = {
      id: opts.id,
      value: v,
      placeholder: ph,
      maxLength: opts.max ?? 200,
      inputMode: opts.mode,
      "aria-invalid": !!errors[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        set(key, (opts.upper ? e.target.value.toUpperCase() : e.target.value) as never),
      onBlur: () => commit({ [key]: v || null } as Partial<Header>),
      className: cls,
    };
    return opts.area ? <textarea rows={2} {...common} /> : <input {...common} />;
  };
  const field = (key: keyof Header, title: string, required: boolean, control: React.ReactNode, wide = false) => (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label className={label} htmlFor={`dn-${key}`}>
        {title}
        {required ? req : null}
      </label>
      {control}
      <FieldError id={`err-${key}`} text={errors[key]} />
    </div>
  );

  return (
    <div className="space-y-7">
      {/* Order */}
      <section className="grid gap-4 sm:grid-cols-2">
        {field(
          "orderDate",
          "Order date",
          true,
          <input
            id="dn-orderDate"
            type="date"
            max={todayIst()}
            value={header.orderDate ?? ""}
            onChange={(e) => setMany({ orderDate: e.target.value || null })}
            className={`${input} ${errors.orderDate ? bad : ok}`}
          />,
        )}
      </section>

      {/* Buyer */}
      <section>
        <p className={label}>Buyer (bill to){req}</p>
        <div className="relative">
          <input
            id="dn-client-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 180)}
            placeholder={header.buyerName ? "Change buyer — search your clients" : "Search your clients by name or mobile"}
            className={`${input} ${errors.buyerName && !header.buyerName ? bad : ok}`}
          />
          {open ? (
            <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-verdigris-300/15 bg-ink-850 p-1 card-shadow">
              {results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onPickClient(c);
                    setQ("");
                    setOpen(false);
                  }}
                  className="block w-full rounded-lg px-3 py-2 text-left hover:bg-verdigris-400/10"
                >
                  <span className="text-sm text-verdigris-50">{c.name}</span>
                  <span className="ml-2 text-xs text-verdigris-200/55">{[c.mobile, c.city].filter(Boolean).join(" · ")}</span>
                </button>
              ))}
              {results.length === 0 ? <p className="px-3 py-2 text-sm text-verdigris-200/55">No client found.</p> : null}
              <button
                type="button"
                id="dn-client-add"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setAdding(true);
                  setNc((x) => ({ ...x, name: q }));
                  setOpen(false);
                }}
                className="mt-1 block w-full rounded-lg border-t border-verdigris-300/10 px-3 py-2 text-left text-sm font-medium text-patina hover:bg-verdigris-400/10"
              >
                + Add a new buyer{q ? ` "${q}"` : ""}
              </button>
            </div>
          ) : null}
        </div>
        {!header.buyerName ? <FieldError id="err-buyerName" text={errors.buyerName} /> : null}

        {adding ? (
          <div className="mt-3 space-y-3 rounded-xl border border-patina/30 bg-patina/5 p-4" id="dn-client-form">
            <p className="text-sm font-medium text-verdigris-50">New buyer — saved to your client list</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <input id="nc-name" className={`${input} ${ncErr.name ? bad : ok}`} placeholder="Buyer name" value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} />
                <FieldError id="nc-name-err" text={ncErr.name} />
              </div>
              <div>
                <input id="nc-mobile" inputMode="tel" className={`${input} ${ncErr.mobile ? bad : ok}`} placeholder="Mobile (10 digits)" value={nc.mobile} onChange={(e) => setNc({ ...nc, mobile: e.target.value })} />
                <FieldError id="nc-mobile-err" text={ncErr.mobile} />
              </div>
              <div className="sm:col-span-2">
                <textarea id="nc-address" rows={2} className={`${input} ${ok}`} placeholder="Delivery address (street, area)" value={nc.address} onChange={(e) => setNc({ ...nc, address: e.target.value })} />
              </div>
              <div>
                <select
                  id="nc-state"
                  aria-label="State"
                  className={`${input} ${ncErr.stateId ? bad : ok}`}
                  value={nc.stateId}
                  onChange={(e) => {
                    setNc({ ...nc, stateId: e.target.value, cityId: "" });
                    setNcErr((x) => ({ ...x, stateId: "", cityId: "" }));
                  }}
                >
                  <option value="">State…</option>
                  {(geo?.states ?? []).map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
                </select>
                <FieldError id="nc-state-err" text={ncErr.stateId} />
              </div>
              <div>
                <select
                  id="nc-city"
                  aria-label="City"
                  disabled={!nc.stateId}
                  className={`${input} ${ncErr.cityId ? bad : ok} disabled:opacity-60`}
                  value={nc.cityId}
                  onChange={(e) => {
                    setNc({ ...nc, cityId: e.target.value });
                    setNcErr((x) => ({ ...x, cityId: "" }));
                  }}
                >
                  <option value="">{nc.stateId ? "City…" : "Choose the state first"}</option>
                  {(geo?.cities ?? [])
                    .filter((c) => String(c.stateId) === nc.stateId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
                <FieldError id="nc-city-err" text={ncErr.cityId} />
                {nc.stateId && !(geo?.cities ?? []).some((c) => String(c.stateId) === nc.stateId) ? (
                  <p className="mt-1 text-xs text-amber-200" id="nc-city-none">No city of this state is in the list yet — ask the super admin to add it.</p>
                ) : nc.stateId ? (
                  <p className="mt-1 text-[11px] text-verdigris-200/50">City not in the list? The super admin adds it under Master → Cities.</p>
                ) : null}
              </div>
              <div>
                <input id="nc-pincode" inputMode="numeric" maxLength={6} className={`${input} ${ncErr.pincode ? bad : ok}`} placeholder="PIN code" value={nc.pincode} onChange={(e) => setNc({ ...nc, pincode: e.target.value.replace(/\D/g, "") })} />
                <FieldError id="nc-pincode-err" text={ncErr.pincode} />
              </div>
              <div>
                <input id="nc-gstin" className={`${input} ${ncErr.gstin ? bad : ok}`} placeholder="GSTIN (optional)" value={nc.gstin} onChange={(e) => setNc({ ...nc, gstin: e.target.value.toUpperCase() })} />
                <FieldError id="nc-gstin-err" text={ncErr.gstin} />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" id="nc-save" disabled={saving} onClick={() => void addClient()} className="rounded-xl bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-patina disabled:opacity-50">
                {saving ? "Saving…" : "Save buyer"}
              </button>
              <button type="button" onClick={() => setAdding(false)} className="rounded-xl border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100">
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <datalist id="dn-cities">
          {(geo?.cities ?? []).map((c) => (
            <option key={c.id} value={c.name}>
              {stateName.get(c.stateId) ?? ""}
            </option>
          ))}
        </datalist>

        {header.buyerName || header.clientId ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2" id="dn-buyer">
            {field("buyerName", "Name", true, text("buyerName", "Buyer name", { id: "dn-buyerName", max: 120 }))}
            {field("buyerMobile", "Mobile", true, text("buyerMobile", "10-digit mobile", { id: "dn-buyerMobile", max: 20, mode: "tel" }))}
            {field("buyerAddress", "Delivery address", true, text("buyerAddress", "Street, area, landmark", { id: "dn-buyerAddress", area: true, max: 600 }), true)}
            {field(
              "buyerCity",
              "City",
              true,
              <input
                id="dn-buyerCity"
                list="dn-cities"
                value={header.buyerCity ?? ""}
                placeholder="City"
                maxLength={80}
                onChange={(e) => {
                  const v = e.target.value;
                  const c = cityByName(v);
                  set("buyerCity", v);
                  set("buyerCityId", c?.id ?? null);
                  if (c) set("buyerState", stateName.get(c.stateId) ?? header.buyerState);
                }}
                onBlur={() => {
                  const c = cityByName(header.buyerCity ?? "");
                  commit({
                    buyerCity: header.buyerCity?.trim() || null,
                    buyerCityId: c?.id ?? null,
                    ...(c ? { buyerState: stateName.get(c.stateId) ?? header.buyerState } : {}),
                  });
                }}
                className={`${input} ${errors.buyerCity ? bad : ok}`}
              />,
            )}
            {field(
              "buyerState",
              "State",
              true,
              <select
                id="dn-buyerState"
                value={header.buyerState ?? ""}
                onChange={(e) => setMany({ buyerState: e.target.value || null })}
                className={`${input} ${errors.buyerState ? bad : ok}`}
              >
                <option value="">Choose…</option>
                {header.buyerState && !(geo?.states ?? []).some((s) => s.name === header.buyerState) ? (
                  <option value={header.buyerState}>{header.buyerState}</option>
                ) : null}
                {(geo?.states ?? []).map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "buyerPincode",
              "PIN code",
              true,
              <input
                id="dn-buyerPincode"
                inputMode="numeric"
                maxLength={6}
                value={header.buyerPincode ?? ""}
                placeholder="6 digits"
                onChange={(e) => set("buyerPincode", e.target.value.replace(/\D/g, ""))}
                onBlur={() => commit({ buyerPincode: header.buyerPincode || null })}
                className={`${input} ${errors.buyerPincode ? bad : ok}`}
              />,
            )}
            {field("buyerGstin", "GSTIN", false, text("buyerGstin", "Optional", { id: "dn-buyerGstin", max: 15, upper: true }))}
          </div>
        ) : null}
      </section>

      {/* Payment and bill */}
      <section className="grid gap-4 sm:grid-cols-2">
        {field(
          "paymentMode",
          "Mode of payment",
          true,
          <select
            id="dn-paymentMode"
            value={header.paymentMode ?? ""}
            onChange={(e) => setMany({ paymentMode: e.target.value || null })}
            className={`${input} ${errors.paymentMode ? bad : ok}`}
          >
            <option value="">Choose…</option>
            {header.paymentMode && !PAYMENT_MODES.includes(header.paymentMode) ? <option value={header.paymentMode}>{header.paymentMode}</option> : null}
            {PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>,
        )}
        <div>
          <p className={label}>Billing{req}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Chip id="dn-bill-with" on={header.billing === "WITH_BILL"} onClick={() => setMany({ billing: "WITH_BILL" })}>With bill</Chip>
            <Chip id="dn-bill-without" on={header.billing === "WITHOUT_BILL"} onClick={() => setMany({ billing: "WITHOUT_BILL", billAmount: null })}>
              Without bill
            </Chip>
          </div>
          <FieldError id="err-billing" text={errors.billing} />
        </div>
        {header.billing === "WITH_BILL"
          ? field(
              "billAmount",
              "Bill amount (₹)",
              true,
              <input
                id="dn-billAmount"
                inputMode="decimal"
                value={billText}
                placeholder="19380"
                onChange={(e) => {
                  const t = e.target.value.replace(/[^0-9.]/g, "");
                  setBillText(t);
                  set("billAmount", t === "" || Number.isNaN(Number(t)) ? null : Number(t));
                }}
                onBlur={() => commit({ billAmount: header.billAmount })}
                className={`${input} ${errors.billAmount ? bad : ok}`}
              />,
            )
          : null}
      </section>

      {/* Transporter */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="relative sm:col-span-2">
          <label className={label} htmlFor="dn-transportName">
            Transporter name{req}
          </label>
          <input
            id="dn-transportName"
            value={tName}
            placeholder="Search the transporters list, or type a new one"
            maxLength={120}
            autoComplete="off"
            onFocus={() => setTOpen(true)}
            onBlur={() => {
              setTimeout(() => setTOpen(false), 180);
              commit({ transportName: tName.trim() || null, transporterId: header.transporterId });
            }}
            onChange={(e) => {
              set("transportName", e.target.value);
              set("transporterId", null);
            }}
            className={`${input} ${errors.transportName ? bad : ok}`}
          />
          {tOpen && transporters.length ? (
            <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-verdigris-300/15 bg-ink-850 p-1 card-shadow" id="dn-transporters">
              {transporters.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setMany({ transporterId: t.id, transportName: t.name, transporterMobile: t.mobile, transporterGstin: t.gstin });
                    setTOpen(false);
                  }}
                  className="block w-full rounded-lg px-3 py-2 text-left hover:bg-verdigris-400/10"
                >
                  <span className="text-sm text-verdigris-50">{t.name}</span>
                  <span className="ml-2 text-xs text-verdigris-200/55">{[t.code, t.mobile].filter(Boolean).join(" · ")}</span>
                </button>
              ))}
            </div>
          ) : null}
          <FieldError id="err-transportName" text={errors.transportName} />
        </div>
        {field("transporterMobile", "Transporter mobile", true, text("transporterMobile", "10-digit mobile", { id: "dn-transporterMobile", max: 20, mode: "tel" }))}
        {field("transporterGstin", "Transporter GSTIN / ID", false, text("transporterGstin", "If available", { id: "dn-transporterGstin", max: 20, upper: true }))}
      </section>

      {/* Packing and handling */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <p className={label}>Packing type{req}</p>
          <div className="flex flex-wrap items-center gap-2">
            {PACKINGS.map(([p, name]) => (
              <Chip key={p} id={`dn-pack-${p.toLowerCase()}`} on={header.packing === p} onClick={() => setMany({ packing: p })}>
                {name}
              </Chip>
            ))}
          </div>
        </div>
        {header.packing === "BUNDLE"
          ? field(
              "bundles",
              "Number of bundles",
              true,
              <input
                id="dn-bundles"
                inputMode="numeric"
                value={header.bundles ?? ""}
                placeholder="How many"
                onChange={(e) => set("bundles", e.target.value === "" ? null : Number(e.target.value.replace(/\D/g, "")))}
                onBlur={() => commit({ bundles: header.bundles })}
                className={`${input} ${errors.bundles ? bad : ok}`}
              />,
            )
          : null}
        {header.packing === "OTHER" ? field("packingOther", "How is it packed?", true, text("packingOther", "Gunny bags, crates…", { id: "dn-packingOther", max: 80 })) : null}
        <div>
          <p className={label}>Priority</p>
          <div className="flex gap-2">
            <Chip id="dn-pri-normal" on={header.priority === "NORMAL"} onClick={() => setMany({ priority: "NORMAL" })}>Normal</Chip>
            <Chip id="dn-pri-urgent" on={header.priority === "URGENT"} onClick={() => setMany({ priority: "URGENT" })}>Urgent</Chip>
          </div>
        </div>
        <div>
          <p className={label}>Handling</p>
          <div className="flex flex-wrap gap-2">
            {HANDLINGS.map(([h, name]) => (
              <Chip key={h} id={`dn-handling-${h.toLowerCase()}`} on={header.handling === h} onClick={() => setMany({ handling: h })}>
                {name}
              </Chip>
            ))}
          </div>
        </div>
      </section>

      {/* Instructions */}
      <section className="grid gap-4 sm:grid-cols-2">
        {field("instructions", "Special packing instructions", false, text("instructions", "Strong cartons, fragile sticker on glass…", { id: "dn-instructions", area: true, max: 1000 }))}
        {field("deliveryInstructions", "Delivery instructions", false, text("deliveryInstructions", "Call before delivery, unload at back gate…", { id: "dn-deliveryInstructions", area: true, max: 1000 }))}
        {field("remarks", "Remarks / other instructions", false, text("remarks", "Anything else", { id: "dn-remarks", area: true, max: 1000 }), true)}
      </section>
    </div>
  );
}
