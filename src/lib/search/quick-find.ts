import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { grantFor, importerIdOf, type Actor } from "@/lib/auth/guard";
import { dnScope, dnWhere, listNotes } from "@/lib/delivery/ops";
import { cartonNoFromScan } from "@/lib/inward/carton-format";
import { findStock } from "@/lib/storage/cartons";
import { galaFromScan } from "@/lib/storage/location-format";
import { mayUse, warehousesFor } from "@/lib/storage/locations";

/**
 * One box for everything (Ctrl+K on the web, the search icon in the app):
 * a delivery note number, a carton number, a gala code, an inward code, or
 * an item / importer. Each answer opens the right page. A person only gets
 * answers from what they may already see — the same grants as the pages.
 */

export type FindHit = {
  kind: "NOTE" | "CARTON" | "GALA" | "INWARD" | "ITEM" | "DISPATCH";
  title: string;
  subtitle: string;
  /** Same path on the portal and in the app. */
  href: string;
};

const INWARD = /^\s*INR-?(\d{1,8})\s*$/i;

/** May this person look at the warehouse side (storage or pick & pack) of this warehouse? */
const warehouseEyes = (actor: Actor, warehouseId: number) =>
  mayUse(actor, "storage.goods.update", warehouseId) ||
  (grantFor(actor, "package.read")?.scope !== "OWN" && mayUse(actor, "package.read", warehouseId));

export async function quickFind(actor: Actor, raw: string): Promise<FindHit[]> {
  const q = raw.trim().slice(0, 80);
  if (q.length < 2) return [];
  const db = getDb();
  const hits: FindHit[] = [];

  // A carton number: where it is right now.
  const no = cartonNoFromScan(q);
  if (no) {
    const c = (await db.execute<Record<string, unknown>>(sql`
      select c.carton_no, c.status, c.area, c.gala_id, g.code as gala, f.name as floor, d.id as dn_id, d.dn_no,
             c.dispatch_order_id, (select o.do_no from wms.dispatch_order o where o.id = c.dispatch_order_id) as do_no,
             r.id as inward_id, r.code as inward_code, r.warehouse_id, r.importer_id, li.item_code, li.description
        from wms.inward_carton c
        join wms.inward_request r on r.id = c.inward_request_id
        join wms.inward_request_item li on li.id = c.inward_request_item_id
        left join wms.warehouse_gala g on g.id = c.gala_id
        left join wms.warehouse_floor f on f.id = g.floor_id
        left join wms.delivery_note d on d.id = c.dn_id
       where c.carton_no = ${no}
    `))[0];
    if (c && warehouseEyes(actor, Number(c.warehouse_id))) {
      const item = [c.item_code, c.description].filter(Boolean).join(" · ");
      const storage = mayUse(actor, "storage.goods.update", Number(c.warehouse_id));
      if (c.status === "DISPATCHED") {
        hits.push({
          kind: "CARTON",
          title: String(c.carton_no),
          subtitle: `${item} — dispatched on ${c.do_no ?? "a dispatch order"} (${c.dn_no})`,
          href: `/admin/outward/${c.dispatch_order_id}`,
        });
      } else if (c.area === "PACKING" || c.area === "RETURN") {
        hits.push({
          kind: "CARTON",
          title: String(c.carton_no),
          subtitle: `${item} — ${c.area === "PACKING" ? `picked for ${c.dn_no}, in the packing area` : `waiting to be put back (from ${c.dn_no})`}`,
          href: `/admin/dispatch/${c.dn_id}`,
        });
      } else if (c.status === "RECEIVED" && c.gala_id) {
        hits.push({
          kind: "CARTON",
          title: String(c.carton_no),
          subtitle: `${item} — in ${c.gala} · ${c.floor}`,
          href: storage ? `/admin/locations/galas/${c.gala_id}` : `/admin/inward/${c.inward_id}`,
        });
      } else {
        hits.push({
          kind: "CARTON",
          title: String(c.carton_no),
          subtitle: `${item} — ${c.status === "RECEIVED" ? "at the dock, not stored yet" : c.status === "HOLD" ? "on hold at the dock" : "not received yet"}`,
          href: `/admin/inward/${c.inward_id}`,
        });
      }
    } else if (c && importerIdOf(actor) !== null && importerIdOf(actor) === Number(c.importer_id)) {
      // The importer's own carton (the importer, their agents): which delivery note it went on — never where it lies.
      const item = [c.item_code, c.description].filter(Boolean).join(" · ");
      const dnGrant = grantFor(actor, "dispatch.order.read");
      const note = c.dn_id && dnGrant ? (await listNotes(dnScope(actor, dnGrant), { q: no })).find((n) => n.id === Number(c.dn_id)) : undefined;
      if (note) {
        hits.push({
          kind: "CARTON",
          title: String(c.carton_no),
          subtitle: `${item} — ${c.status === "DISPATCHED" ? `dispatched on ${c.do_no ?? "a dispatch order"} · ` : "on "}delivery note ${note.dnNo} · ${note.statusLabel}`,
          href: c.status === "DISPATCHED" && c.dispatch_order_id ? `/admin/outward/${c.dispatch_order_id}` : `/admin/delivery-notes/${note.id}`,
        });
      } else if (!c.dn_id && grantFor(actor, "inward.request.read")) {
        hits.push({
          kind: "CARTON",
          title: String(c.carton_no),
          subtitle: `${item} — ${c.status === "RECEIVED" ? "in the warehouse, not on a delivery note" : c.status === "HOLD" ? "on hold at the dock" : "not received yet"}`,
          href: `/admin/inward/${c.inward_id}`,
        });
      }
    }
    return hits;
  }

  // An inward request code.
  const inward = INWARD.exec(q);
  const inwardGrant = grantFor(actor, "inward.request.read");
  if (inward && inwardGrant) {
    const code = `INR-${inward[1]!.padStart(6, "0")}`;
    const r = (await db.execute<{ id: number; code: string; importer_id: number; warehouse_id: number }>(sql`
      select id, code, importer_id, warehouse_id from wms.inward_request where code = ${code} and deleted_at is null
    `))[0];
    // Only a request this person may open: their own company's, or their warehouse's.
    const mine = r && (inwardGrant.scope === "OWN" ? Number(r.importer_id) === importerIdOf(actor) : mayUse(actor, "inward.request.read", Number(r.warehouse_id)));
    if (r && mine) hits.push({ kind: "INWARD", title: r.code, subtitle: "Inward request", href: `/admin/inward/${r.id}` });
  }

  // A gala code, in the warehouses this person stores into.
  const g = galaFromScan(q);
  const storeIn = warehousesFor(actor, "storage.goods.update");
  if (g && (storeIn === null || storeIn.length)) {
    const rows = await db.execute<Record<string, unknown>>(sql`
      select g.id, g.code, g.name, f.name as floor, w.name as warehouse, g.warehouse_id
        from wms.warehouse_gala g join wms.warehouse_floor f on f.id = g.floor_id join wms.warehouse w on w.id = g.warehouse_id
       where g.code = ${g.code} and g.deleted_at is null and f.deleted_at is null
         ${g.warehouseCode ? sql`and upper(w.code) = ${g.warehouseCode}` : sql``}
       order by w.name
    `);
    for (const r of rows) {
      if (!mayUse(actor, "storage.goods.update", Number(r.warehouse_id))) continue;
      hits.push({ kind: "GALA", title: `${r.code} · ${r.name}`, subtitle: `${r.floor} · ${r.warehouse}`, href: `/admin/locations/galas/${r.id}` });
    }
    if (hits.length) return hits;
  }

  // Dispatch orders (DO/2026-27/000126, or its number, a vehicle or an LR number).
  const doGrant = grantFor(actor, "outward.order.read");
  if (doGrant && q.length >= 3) {
    const like = `%${q.toLowerCase()}%`;
    const rows = await db.execute<Record<string, unknown>>(sql`
      select o.id, o.do_no, o.status, o.vehicle_no, o.buyer_name, n.dn_no
        from wms.dispatch_order o join wms.delivery_note n on n.id = o.note_id
       where ${dnWhere(dnScope(actor, doGrant))}
         and (lower(o.do_no) like ${like} or lower(coalesce(o.vehicle_no, '')) like ${like}
              or exists (select 1 from wms.dispatch_lr l where l.do_id = o.id and lower(l.lr_no) like ${like}))
       order by o.id desc limit 6
    `);
    for (const r of rows) {
      hits.push({
        kind: "DISPATCH",
        title: String(r.do_no),
        subtitle: `${r.dn_no} · ${r.buyer_name ?? ""}${r.vehicle_no ? ` · ${r.vehicle_no}` : ""} · ${String(r.status).toLowerCase().replace(/_/g, " ")}`,
        href: `/admin/outward/${r.id}`,
      });
    }
  }

  // Delivery notes this person may see.
  const dnGrant = grantFor(actor, "dispatch.order.read");
  if (dnGrant) {
    const notes = await listNotes(dnScope(actor, dnGrant), { q });
    for (const n of notes.slice(0, 6)) {
      hits.push({
        kind: "NOTE",
        title: n.dnNo,
        subtitle: `${n.buyerName} · ${n.warehouseName} · ${n.statusLabel} · ${n.cartons} cartons`,
        href: `/admin/delivery-notes/${n.id}`,
      });
    }
  }

  // An item or importer: which galas hold it.
  if (!inward && (storeIn === null || storeIn.length)) {
    const ids =
      storeIn ??
      (await db.execute<{ id: number }>(sql`select id from wms.warehouse where deleted_at is null order by id limit 5`)).map((w) => Number(w.id));
    for (const w of ids.slice(0, 5)) {
      const a = await findStock(actor, w, q);
      for (const p of a.places.slice(0, 8)) {
        hits.push({
          kind: "ITEM",
          title: [p.itemCode, p.description].filter(Boolean).join(" · "),
          subtitle: `${p.galaCode} · ${p.floor} · ${p.cartons} ctn · ${p.importer}`,
          href: `/admin/locations/galas/${p.galaId}`,
        });
      }
      if (hits.length >= 20) break;
    }
  }
  return hits.slice(0, 20);
}
