"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useToast } from "@/components/Toast";
import { Card } from "@/components/admin/ui";
import { api } from "@/lib/api/client";
import type { Client, Header, NoteDetail, StockRow } from "@/lib/delivery/ops";

import HeaderFields, { label } from "./HeaderFields";
import StockPicker, { lineKey, type Chosen } from "./StockPicker";

const n = (v: number) => v.toLocaleString("en-IN");

/**
 * Change a delivery note: buyer, dispatch details, and the items from its
 * own warehouse. Saved all at once. The importer's change is approval;
 * the sales agent's sends it back for approval (unless they are trusted).
 */
export default function DeliveryNoteEdit({ note, isImporter }: { note: NoteDetail; isImporter: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [header, setHeader] = useState<Header>(note.header);
  const [patch, setPatch] = useState<Partial<Header>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stock, setStock] = useState<StockRow[]>([]);
  const [busy, setBusy] = useState(false);
  const original = useMemo(() => {
    const m: Chosen = {};
    for (const l of note.lineItems) m[lineKey(note.warehouseId, l.key)] = { cartons: l.cartons, orderPieces: l.orderPieces };
    return m;
  }, [note]);
  const originalCartons = useMemo(() => Object.fromEntries(Object.entries(original).map(([k, v]) => [k, v.cartons])), [original]);
  const [chosen, setChosen] = useState<Chosen>(original);

  useEffect(() => {
    void (async () => {
      const r = await api<{ stock: StockRow[] }>("/delivery/stock", { method: "GET" });
      if (r.ok) {
        const here = r.data.stock.filter((s) => s.warehouseId === note.warehouseId);
        // Items on the note that no longer show in stock still need a row to change them.
        for (const l of note.lineItems) {
          if (!here.some((s) => s.key === l.key)) {
            here.push({
              warehouseId: note.warehouseId, warehouseCode: note.warehouseCode, warehouseName: note.warehouseName, key: l.key,
              itemId: null, itemCode: l.itemCode, description: l.description, piecesPerCarton: l.piecesPerCarton,
              unitCode: l.unitCode, kgPerCarton: null, thumbUrl: null, received: 0, held: 0, inNotes: 0, mine: 0, available: 0,
            });
          }
        }
        setStock(here);
      } else toast.error(r.error.message);
    })();
  }, [note, toast]);

  const pickClient = async (c: Client) => {
    const next = {
      clientId: c.id,
      buyerName: c.name,
      buyerMobile: c.mobile,
      buyerAddress: c.address,
      buyerCity: c.city,
      buyerCityId: c.cityId,
      buyerState: c.state,
      buyerPincode: c.pincode,
      buyerGstin: c.gstin,
    };
    setHeader((h) => ({ ...h, ...next }));
    setPatch((p) => ({ ...p, ...next }));
  };

  const lines = Object.entries(chosen).filter(([, v]) => v.cartons > 0);
  const totals = lines.reduce(
    (t, [k, v]) => {
      const row = stock.find((s) => lineKey(s.warehouseId, s.key) === k);
      return { cartons: t.cartons + v.cartons, pieces: t.pieces + v.cartons * (row?.piecesPerCarton ?? 0), ordered: t.ordered + v.orderPieces };
    },
    { cartons: 0, pieces: 0, ordered: 0 },
  );

  const save = async () => {
    setBusy(true);
    const body = {
      ...patch,
      lines: lines.map(([k, v]) => ({ key: k.slice(k.indexOf("|") + 1), cartons: v.cartons, orderPieces: v.orderPieces })),
    };
    const r = await api<{ note: NoteDetail }>(`/delivery-notes/${note.id}`, { method: "PUT", body });
    setBusy(false);
    if (!r.ok) {
      if (r.error.fields) setErrors(r.error.fields);
      return toast.error(r.error.message);
    }
    toast.success(r.data.note.status === "APPROVED" ? `${note.dnNo} saved and approved.` : `${note.dnNo} saved — waiting for approval again.`);
    router.push(`/admin/delivery-notes/${note.id}`);
    router.refresh();
  };

  return (
    <div className="space-y-5">
      <p className={`rounded-xl border px-4 py-3 text-sm ${isImporter ? "border-emerald-400/30 bg-emerald-500/5 text-emerald-100" : "border-amber-400/40 bg-amber-500/10 text-amber-100"}`} id="dn-edit-note">
        {isImporter
          ? "You are the importer — saving your change approves this delivery note."
          : "Saving a change sends this delivery note back for the importer's approval."}
      </p>
      <Card className="p-5 sm:p-6">
        <HeaderFields
          header={header}
          errors={errors}
          set={(k, v) => {
            setHeader((h) => ({ ...h, [k]: v }));
            setPatch((p) => ({ ...p, [k]: v }));
          }}
          commit={() => {}}
          onPickClient={(c) => void pickClient(c)}
        />
      </Card>
      <Card className="p-5 sm:p-6">
        <p className={label}>Items from {note.warehouseName}</p>
        <StockPicker
          stock={stock}
          chosen={chosen}
          extra={originalCartons}
          onSet={async (row, cartons, orderPieces) => {
            const k = lineKey(row.warehouseId, row.key);
            const can = row.available + (originalCartons[k] ?? 0);
            if (cartons > can) return { ok: false, message: `Only ${can} free` };
            if (orderPieces !== null && orderPieces > can * row.piecesPerCarton) {
              return { ok: false, message: `Only ${can} cartons (${can * row.piecesPerCarton} pcs) free` };
            }
            setChosen((c) => ({ ...c, [k]: { cartons, orderPieces: orderPieces ?? cartons * row.piecesPerCarton } }));
            return { ok: true };
          }}
        />
        <p className="mt-3 text-sm text-verdigris-100" id="dn-edit-total">
          {lines.length} item{lines.length === 1 ? "" : "s"} · ordered {n(totals.ordered)} pcs · {n(totals.cartons)} cartons · {n(totals.pieces)} pieces
        </p>
      </Card>
      <div className="flex justify-end gap-2">
        <Link href={`/admin/delivery-notes/${note.id}`} className="rounded-xl border border-verdigris-300/20 px-4 py-2.5 text-sm text-verdigris-100">
          Cancel
        </Link>
        <button type="button" id="dn-save" disabled={busy || lines.length === 0} onClick={() => void save()} className="rounded-xl bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 hover:bg-patina disabled:opacity-50">
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
