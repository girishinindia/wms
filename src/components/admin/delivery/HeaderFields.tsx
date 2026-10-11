"use client";

import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api/client";
import type { Client, Header } from "@/lib/delivery/ops";

export const PAYMENT_MODES = ["Account", "Cash", "UPI", "Credit", "Cheque", "Bank transfer"];

export const input =
  "w-full rounded-xl border bg-ink-900/60 px-3.5 py-2.5 text-[15px] text-verdigris-50 placeholder:text-verdigris-200/35 focus:outline-none focus:ring-2 focus:ring-patina/25";
const ok = "border-verdigris-300/15";
const bad = "border-rose-500 bg-rose-500/5";
export const label = "mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-verdigris-300";

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

/**
 * Buyer, transport, billing and packing — shared by "new" and "edit".
 * `set` changes the field on screen; `commit` saves it (the create form
 * saves each field as it is left, the edit form saves everything at once).
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
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Client[]>([]);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [nc, setNc] = useState({ name: "", mobile: "", address: "", pincode: "", gstin: "" });
  const [ncErr, setNcErr] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const r = await api<{ clients: Client[] }>(`/delivery/clients?q=${encodeURIComponent(q)}`, { method: "GET" });
      if (r.ok) setResults(r.data.clients);
    }, 200);
  }, [q, open]);

  const addClient = async () => {
    setSaving(true);
    const r = await api<{ client: Client }>("/delivery/clients", { body: nc });
    setSaving(false);
    if (!r.ok) {
      setNcErr(r.error.fields ?? { name: r.error.message });
      return;
    }
    setAdding(false);
    setNc({ name: "", mobile: "", address: "", pincode: "", gstin: "" });
    setNcErr({});
    onPickClient(r.data.client);
  };

  const text = (key: keyof Header, ph: string, opts: { id: string; area?: boolean; max?: number } ) => {
    const v = (header[key] as string | null) ?? "";
    const cls = `${input} ${errors[key] ? bad : ok}`;
    const common = {
      id: opts.id,
      value: v,
      placeholder: ph,
      maxLength: opts.max ?? 200,
      "aria-invalid": !!errors[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key, e.target.value as never),
      onBlur: () => commit({ [key]: v } as Partial<Header>),
      className: cls,
    };
    return opts.area ? <textarea rows={3} {...common} /> : <input {...common} />;
  };

  return (
    <div className="space-y-6">
      {/* Buyer */}
      <section>
        <p className={label}>Buyer (bill to)</p>
        <div className="relative">
          <input
            id="dn-client-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 180)}
            placeholder={header.buyerName ? "Change buyer — search your clients" : "Search your clients by name or mobile"}
            className={`${input} ${errors.buyerName ? bad : ok}`}
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
        <FieldError id="err-buyerName" text={errors.buyerName} />

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
                <textarea id="nc-address" rows={2} className={`${input} ${ok}`} placeholder="Delivery address" value={nc.address} onChange={(e) => setNc({ ...nc, address: e.target.value })} />
              </div>
              <div>
                <input id="nc-pincode" inputMode="numeric" className={`${input} ${ncErr.pincode ? bad : ok}`} placeholder="Pincode" value={nc.pincode} onChange={(e) => setNc({ ...nc, pincode: e.target.value })} />
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

        {header.buyerName ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2" id="dn-buyer">
            <div>
              <label className={label} htmlFor="dn-buyerName">Name</label>
              {text("buyerName", "Buyer name", { id: "dn-buyerName", max: 120 })}
            </div>
            <div>
              <label className={label} htmlFor="dn-buyerMobile">Mobile</label>
              {text("buyerMobile", "Mobile", { id: "dn-buyerMobile", max: 40 })}
              <FieldError id="err-buyerMobile" text={errors.buyerMobile} />
            </div>
            <div className="sm:col-span-2">
              <label className={label} htmlFor="dn-buyerAddress">Delivery address</label>
              {text("buyerAddress", "Full delivery address with pincode", { id: "dn-buyerAddress", area: true, max: 600 })}
              <FieldError id="err-buyerAddress" text={errors.buyerAddress} />
            </div>
            <div>
              <label className={label} htmlFor="dn-buyerGstin">GSTIN</label>
              {text("buyerGstin", "Optional", { id: "dn-buyerGstin", max: 15 })}
            </div>
            <div>
              <label className={label} htmlFor="dn-destination">Destination</label>
              {text("destination", "City", { id: "dn-destination", max: 120 })}
            </div>
          </div>
        ) : null}
      </section>

      {/* Dispatch */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="dn-transportName">Transport</label>
          {text("transportName", "Shree Transport Co.", { id: "dn-transportName", max: 120 })}
          <FieldError id="err-transportName" text={errors.transportName} />
        </div>
        <div>
          <label className={label} htmlFor="dn-paymentMode">Payment mode</label>
          <select
            id="dn-paymentMode"
            value={header.paymentMode ?? ""}
            onChange={(e) => {
              set("paymentMode", e.target.value || null);
              commit({ paymentMode: e.target.value || null });
            }}
            className={`${input} ${errors.paymentMode ? bad : ok}`}
          >
            <option value="">Choose…</option>
            {PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <FieldError id="err-paymentMode" text={errors.paymentMode} />
        </div>
        <div>
          <p className={label}>Billing</p>
          <div className="flex flex-wrap items-center gap-2">
            <Chip id="dn-bill-with" on={header.billing === "WITH_BILL"} onClick={() => { set("billing", "WITH_BILL"); commit({ billing: "WITH_BILL" }); }}>With bill</Chip>
            <Chip id="dn-bill-without" on={header.billing === "WITHOUT_BILL"} onClick={() => { set("billing", "WITHOUT_BILL"); commit({ billing: "WITHOUT_BILL", billAmount: null }); set("billAmount", null); }}>Without bill</Chip>
            {header.billing === "WITH_BILL" ? (
              <input
                id="dn-billAmount"
                inputMode="decimal"
                value={header.billAmount ?? ""}
                placeholder="Bill amount"
                onChange={(e) => set("billAmount", e.target.value === "" ? null : Number(e.target.value.replace(/[^0-9.]/g, "")))}
                onBlur={() => commit({ billAmount: header.billAmount })}
                className={`${input} ${ok} w-36`}
              />
            ) : null}
          </div>
          <FieldError id="err-billing" text={errors.billing} />
        </div>
        <div>
          <p className={label}>Priority</p>
          <div className="flex gap-2">
            <Chip id="dn-pri-normal" on={header.priority === "NORMAL"} onClick={() => { set("priority", "NORMAL"); commit({ priority: "NORMAL" }); }}>Normal</Chip>
            <Chip id="dn-pri-urgent" on={header.priority === "URGENT"} onClick={() => { set("priority", "URGENT"); commit({ priority: "URGENT" }); }}>Urgent</Chip>
          </div>
        </div>
        <div>
          <p className={label}>Packing</p>
          <div className="flex flex-wrap items-center gap-2">
            {(["CARTON", "BUNDLE", "LOOSE"] as const).map((p) => (
              <Chip key={p} id={`dn-pack-${p.toLowerCase()}`} on={header.packing === p} onClick={() => { set("packing", p); commit({ packing: p }); }}>
                {p === "CARTON" ? "Cartons" : p === "BUNDLE" ? "Bundles" : "Loose"}
              </Chip>
            ))}
            {header.packing === "BUNDLE" ? (
              <input
                id="dn-bundles"
                inputMode="numeric"
                value={header.bundles ?? ""}
                placeholder="How many"
                onChange={(e) => set("bundles", e.target.value === "" ? null : Number(e.target.value.replace(/\D/g, "")))}
                onBlur={() => commit({ bundles: header.bundles })}
                className={`${input} ${ok} w-28`}
              />
            ) : null}
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="dn-instructions">Special instructions</label>
          {text("instructions", "Use strong cartons, fragile sticker on glass…", { id: "dn-instructions", area: true, max: 1000 })}
        </div>
      </section>
    </div>
  );
}
