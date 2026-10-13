import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import type { Actor } from "@/lib/auth/guard";
import { afterStep } from "@/lib/dispatch/ops";
import { alreadyText, cartonNoFromScan, scanWhen } from "@/lib/inward/carton-format";
import { InwardError, type Meta } from "@/lib/inward/ops";
import { storedCartons, type CartonPlace as StockPlace, type StoredCarton } from "@/lib/storage/cartons";
import { mayUse } from "@/lib/storage/locations";

/**
 * Storing cartons: scan a gala, then carton after carton. The gala stays
 * chosen until it is changed. A carton already in another gala is not
 * moved silently — the answer is MOVE_CONFIRM and the person decides.
 *
 * A carton picked for a delivery note that was then rejected or cancelled
 * waits on the put-back shelf: scanning it into any gala puts it back
 * (RESTORED — a re-storage, not a new inward). A carton in the packing
 * area for a live note is refused.
 *
 * Super admin, warehouse admin and storage manager: storage.goods.update.
 */

export type StoreInput = {
  code: string;
  clientScanId?: string | null;
  via?: "SCAN" | "MANUAL";
  device?: string | null;
  /** Re-sent with true after the person agreed to move it here. */
  move?: boolean;
};

export type StoreResultKind =
  | "STORED"
  | "MOVED"
  | "ALREADY_HERE"
  | "MOVE_CONFIRM"
  | "NOT_RECEIVED"
  | "ON_HOLD"
  | "OTHER_WAREHOUSE"
  | "IN_PACKING"
  | "UNKNOWN";

export type StoreResult = {
  clientScanId: string | null;
  code: string;
  cartonNo: string | null;
  result: StoreResultKind;
  message: string;
  /** A put-back carton of a rejected / cancelled delivery note (result is STORED). */
  restored?: { dnNo: string } | null;
  carton?: {
    id: number;
    inwardCode: string;
    importer: string;
    itemCode: string | null;
    description: string;
    piecesPerCarton: number;
    unitCode: string | null;
  };
  /** Where it is (ALREADY_HERE, MOVE_CONFIRM) or was (MOVED). */
  from?: { galaId: number; code: string; at: string | null; by: string | null } | null;
};

type GalaHit = { id: number; warehouse_id: number; code: string; is_active: boolean; floor_active: boolean; deleted: boolean };

async function galaIn(warehouseId: number, galaId: number): Promise<GalaHit> {
  const rows = await getDb().execute<GalaHit>(sql`
    select g.id, g.warehouse_id, g.code, g.is_active, f.is_active as floor_active,
           (g.deleted_at is not null or f.deleted_at is not null) as deleted
      from wms.warehouse_gala g join wms.warehouse_floor f on f.id = g.floor_id
     where g.id = ${galaId}
  `);
  const g = rows[0];
  if (!g || Number(g.warehouse_id) !== warehouseId) throw new InwardError("NOT_FOUND", "No such gala in this warehouse");
  if (g.deleted) throw new InwardError("CONFLICT", `${g.code} was deleted. Choose another gala.`);
  if (!g.is_active || !g.floor_active) throw new InwardError("CONFLICT", `${g.code} is switched off. Choose an active gala.`);
  return g;
}

export async function storeCartons(
  actor: Actor,
  warehouseId: number,
  galaId: number,
  scans: StoreInput[],
  meta: Meta,
): Promise<{ results: StoreResult[]; storedHere: number }> {
  if (!mayUse(actor, "storage.goods.update", warehouseId)) throw new InwardError("NOT_FOUND", "No such warehouse");
  const gala = await galaIn(warehouseId, galaId);
  const db = getDb();
  const by = actor.session.userId;
  const results: StoreResult[] = [];

  for (const s of scans) {
    const code = s.code.trim().slice(0, 500);
    const clientScanId = s.clientScanId?.slice(0, 80) ?? null;
    const via = s.via === "MANUAL" ? "MANUAL" : "SCAN";
    const cartonNo = cartonNoFromScan(code);

    // A resend after a dropped connection: answer what happened the first time.
    if (clientScanId) {
      const seen = await db.execute<{ action: string; carton_no: string }>(sql`
        select m.action, c.carton_no from wms.carton_movement m join wms.inward_carton c on c.id = m.carton_id
         where m.client_scan_id = ${clientScanId}
      `);
      if (seen[0]) {
        results.push({
          clientScanId,
          code,
          cartonNo: seen[0].carton_no,
          result: seen[0].action === "MOVED" ? "MOVED" : "STORED",
          message: `${seen[0].action === "MOVED" ? "Moved to" : seen[0].action === "RESTORED" ? "Put back in" : "Stored in"} ${gala.code}`,
        });
        continue;
      }
    }

    if (!cartonNo) {
      results.push({ clientScanId, code, cartonNo: null, result: "UNKNOWN", message: "That is not a carton sticker" });
      continue;
    }
    const rows = await db.execute<{
      id: number;
      status: string;
      gala_id: number | null;
      gala_code: string | null;
      stored_at: string | null;
      stored_by_name: string | null;
      warehouse_id: number;
      inward_code: string;
      importer: string;
      item_code: string | null;
      description: string;
      pieces_per_carton: number;
      unit_code: string | null;
      hold_reason: string | null;
      area: string | null;
      dn_id: number | null;
      dn_no: string | null;
      dn_status: string | null;
    }>(sql`
      select c.id, c.status, c.gala_id, g.code as gala_code, c.stored_at::text, c.area, c.dn_id, d.dn_no, d.status as dn_status,
             trim(u.first_name || ' ' || coalesce(u.last_name, '')) as stored_by_name,
             r.warehouse_id, r.code as inward_code, i.company_name as importer,
             li.item_code, li.description, li.pieces_per_carton, li.unit_code, c.hold_reason
        from wms.inward_carton c
        join wms.inward_request r on r.id = c.inward_request_id
        join wms.importer i on i.id = r.importer_id
        join wms.inward_request_item li on li.id = c.inward_request_item_id
        left join wms.warehouse_gala g on g.id = c.gala_id
        left join wms.users u on u.id = c.stored_by
        left join wms.delivery_note d on d.id = c.dn_id
       where c.carton_no = ${cartonNo}
    `);
    const c = rows[0];
    if (!c) {
      results.push({ clientScanId, code, cartonNo, result: "UNKNOWN", message: `${cartonNo} is not a carton in the system` });
      continue;
    }
    const carton = {
      id: Number(c.id),
      inwardCode: c.inward_code,
      importer: c.importer,
      itemCode: c.item_code,
      description: c.description,
      piecesPerCarton: Number(c.pieces_per_carton),
      unitCode: c.unit_code,
    };
    const where = c.gala_id
      ? { galaId: Number(c.gala_id), code: c.gala_code ?? "", at: c.stored_at, by: c.stored_by_name }
      : null;

    if (Number(c.warehouse_id) !== warehouseId) {
      results.push({ clientScanId, code, cartonNo, result: "OTHER_WAREHOUSE", message: "This carton belongs to another warehouse", carton });
      continue;
    }
    if (c.status === "HOLD") {
      results.push({
        clientScanId, code, cartonNo, result: "ON_HOLD", carton,
        message: `On hold${c.hold_reason ? `: ${c.hold_reason}` : ""} — take it in at the dock first`,
      });
      continue;
    }
    if (c.status === "DISPATCHED") {
      // Left on a vehicle: same answer code as "not here", plainer words.
      results.push({ clientScanId, code, cartonNo, result: "NOT_RECEIVED", carton, message: `Already dispatched${c.dn_no ? ` on delivery note ${c.dn_no}` : ""} — it has left the warehouse` });
      continue;
    }
    if (c.status !== "RECEIVED") {
      results.push({ clientScanId, code, cartonNo, result: "NOT_RECEIVED", carton, message: "Not received at the dock yet — scan it in first" });
      continue;
    }
    if (c.area === "PACKING") {
      results.push({
        clientScanId, code, cartonNo, result: "IN_PACKING", carton,
        message: `Picked for delivery note ${c.dn_no ?? ""} — it is in the packing area, not for storage`,
      });
      continue;
    }
    if (c.area === "RETURN") {
      // Put back from a rejected / cancelled delivery note: any gala will do.
      const back = await db.execute<{ id: number }>(sql`
        with back as (
          update wms.inward_carton
             set gala_id = ${gala.id}, stored_at = now(), stored_by = ${by}, area = null, dn_id = null, dn_line_id = null,
                 package_id = null, picked_at = null, picked_by = null, pick_from_gala_id = null, arrived_at = null, arrived_by = null,
                 updated_at = now()
           where id = ${carton.id} and area = 'RETURN'
          returning id
        )
        insert into wms.carton_movement (carton_id, from_gala_id, to_gala_id, action, via, client_scan_id, device, moved_by, from_area, delivery_note_id)
        select id, null, ${gala.id}, 'RESTORED', ${via}, ${clientScanId},
               ${s.device?.slice(0, 120) ?? meta.userAgent?.slice(0, 120) ?? null}, ${by}, 'RETURN', ${c.dn_id}
          from back
        on conflict (client_scan_id) do nothing
        returning id
      `);
      if (!back[0]) {
        results.push({ clientScanId, code, cartonNo, result: "ALREADY_HERE", carton, message: "Someone else just put this carton back — scan it again" });
        continue;
      }
      if (c.dn_id) await afterStep(Number(c.dn_id), "RETURNING", actor, meta);
      results.push({
        clientScanId, code, cartonNo, carton, result: "STORED", restored: { dnNo: c.dn_no ?? "" },
        message: `Put back in ${gala.code} (from ${c.dn_no ?? "a delivery note"})`,
      });
      continue;
    }
    if (where && where.galaId === Number(gala.id)) {
      results.push({
        clientScanId, code, cartonNo, result: "ALREADY_HERE", carton, from: where,
        message: alreadyText(`Already in ${gala.code} — stored`, where.by, where.at),
      });
      continue;
    }
    if (where && !s.move) {
      const stored = [where.by ? `by ${where.by}` : "", scanWhen(where.at) ? `at ${scanWhen(where.at)}` : ""].filter(Boolean).join(" ");
      results.push({
        clientScanId, code, cartonNo, result: "MOVE_CONFIRM", carton, from: where,
        message: `Already in ${where.code}${stored ? ` (stored ${stored})` : ""} — move it to ${gala.code}?`,
      });
      continue;
    }

    // One statement: the carton changes only if it is still where we saw
    // it, and the history row is written with it.
    const done = await db.execute<{ id: number }>(sql`
      with moved as (
        update wms.inward_carton
           set gala_id = ${gala.id}, stored_at = now(), stored_by = ${by}, updated_at = now()
         where id = ${carton.id} and status = 'RECEIVED'
           and ${where ? sql`gala_id = ${where.galaId}` : sql`gala_id is null`}
        returning id
      )
      insert into wms.carton_movement (carton_id, from_gala_id, to_gala_id, action, via, client_scan_id, device, moved_by)
      select id, ${where?.galaId ?? null}, ${gala.id}, ${where ? "MOVED" : "STORED"}, ${via}, ${clientScanId},
             ${s.device?.slice(0, 120) ?? meta.userAgent?.slice(0, 120) ?? null}, ${by}
        from moved
      on conflict (client_scan_id) do nothing
      returning id
    `);
    if (!done[0]) {
      // Someone else stored or moved it a moment ago.
      // Someone else stored or moved it a moment ago: say where it is now.
      const now = (await db.execute<{ code: string | null; at: string | null; by: string | null }>(sql`
        select g.code, c.stored_at::text as at, trim(u.first_name || ' ' || coalesce(u.last_name, '')) as by
          from wms.inward_carton c
          left join wms.warehouse_gala g on g.id = c.gala_id
          left join wms.users u on u.id = c.stored_by
         where c.id = ${carton.id}
      `))[0];
      results.push({
        clientScanId, code, cartonNo, result: "ALREADY_HERE", carton, from: where,
        message: now?.code
          ? alreadyText(`Just stored in ${now.code}`, now.by, now.at)
          : "Someone else is storing this carton right now — scan it again",
      });
      continue;
    }
    results.push({
      clientScanId, code, cartonNo, carton,
      result: where ? "MOVED" : "STORED",
      from: where,
      message: where ? `Moved from ${where.code} to ${gala.code}` : `Stored in ${gala.code}`,
    });
  }

  const count = await db.execute<{ n: string }>(sql`select count(*)::text as n from wms.inward_carton where gala_id = ${gala.id}`);
  return { results, storedHere: Number(count[0]?.n ?? 0) };
}

export type WaitingRow = { id: number; code: string; importer: string; received: number; stored: number; waiting: number };

/** Inwards of this warehouse with received cartons not yet in a gala. */
export async function waitingToStore(actor: Actor, warehouseId: number): Promise<WaitingRow[]> {
  if (!mayUse(actor, "storage.goods.update", warehouseId)) throw new InwardError("NOT_FOUND", "No such warehouse");
  const rows = await getDb().execute<{ id: number; code: string; importer: string; received: string; stored: string }>(sql`
    select r.id, r.code, i.company_name as importer,
           count(c.id) filter (where c.status = 'RECEIVED' and c.area is null)::text as received,
           count(c.id) filter (where c.status = 'RECEIVED' and c.area is null and c.gala_id is not null)::text as stored
      from wms.inward_request r
      join wms.importer i on i.id = r.importer_id
      join wms.inward_carton c on c.inward_request_id = r.id
     where r.warehouse_id = ${warehouseId} and r.deleted_at is null
     group by r.id, i.company_name
    having count(c.id) filter (where c.status = 'RECEIVED' and c.area is null and c.gala_id is null) > 0
     order by r.id
     limit 100
  `);
  return rows.map((r) => {
    const received = Number(r.received);
    const stored = Number(r.stored);
    return { id: Number(r.id), code: r.code, importer: r.importer, received, stored, waiting: received - stored };
  });
}

export type PutBackRow = { noteId: number; dnNo: string; status: string; importer: string; cartons: number; cartonNos: string[] };

/** Picked cartons of rejected / cancelled delivery notes, waiting to go back into a gala. */
export async function putBackList(actor: Actor, warehouseId: number): Promise<PutBackRow[]> {
  if (!mayUse(actor, "storage.goods.update", warehouseId)) throw new InwardError("NOT_FOUND", "No such warehouse");
  const rows = await getDb().execute<{ id: number; dn_no: string; status: string; importer: string; cartons: number; nos: string[] }>(sql`
    select d.id, d.dn_no, case when d.short_closed_at is not null then 'CLOSED_SHORT' else d.status end as status,
           i.company_name as importer, count(c.id)::int as cartons,
           (array_agg(c.carton_no order by c.carton_no))[1:60] as nos
      from wms.inward_carton c
      join wms.delivery_note d on d.id = c.dn_id
      join wms.importer i on i.id = d.importer_id
     where c.area = 'RETURN' and d.warehouse_id = ${warehouseId}
     group by d.id, i.company_name, d.short_closed_at
     order by d.id
  `);
  return rows.map((r) => ({
    noteId: Number(r.id), dnNo: r.dn_no, status: r.status, importer: r.importer, cartons: Number(r.cartons), cartonNos: (r.nos ?? []).map(String),
  }));
}

export type GalaContents = {
  gala: { id: number; code: string; name: string; floor: string; warehouse: string; warehouseId: number; isActive: boolean };
  cartons: number;
  items: { itemCode: string | null; description: string; importer: string; unitCode: string | null; cartons: number; pieces: number; kg: number }[];
  /** Newest first. Each carton says what it is: item, importer, pieces per carton, kg. */
  list: (Omit<StoredCarton, "storedAt"> & { storedAt: string | null })[];
  /** The way around: breadcrumb floors and galas, previous / next gala. */
  place: StockPlace;
  truncated: boolean;
};

/** What is in a gala: by item, and the cartons themselves (newest first). */
export async function galaContents(actor: Actor, galaId: number): Promise<GalaContents> {
  const r = await storedCartons(actor, { galaId });
  const g = r.place.gala!;
  return {
    gala: {
      id: g.id, code: g.code, name: g.name, floor: r.place.floor!.name, warehouse: r.place.warehouse.name,
      warehouseId: r.place.warehouse.id, isActive: g.isActive,
    },
    cartons: r.total,
    items: r.items,
    list: r.cartons,
    place: r.place,
    truncated: r.truncated,
  };
}

export type CartonPlace = { galaCode: string; floor: string; cartons: number; from: string; to: string };

/** Where an inward's cartons are: one row per gala, with the number range. */
export async function placesOf(inwardId: number): Promise<{ stored: number; places: CartonPlace[] }> {
  const rows = await getDb().execute<{ code: string; floor: string; cartons: string; first_no: string; last_no: string }>(sql`
    select g.code, f.name as floor, count(*)::text as cartons,
           (array_agg(c.carton_no order by c.seq))[1] as first_no,
           (array_agg(c.carton_no order by c.seq desc))[1] as last_no
      from wms.inward_carton c
      join wms.warehouse_gala g on g.id = c.gala_id
      join wms.warehouse_floor f on f.id = g.floor_id
     where c.inward_request_id = ${inwardId}
     group by g.code, f.name, f.floor_no, g.gala_no
     order by f.floor_no, g.gala_no
  `);
  const places = rows.map((r) => ({ galaCode: r.code, floor: r.floor, cartons: Number(r.cartons), from: r.first_no, to: r.last_no }));
  return { stored: places.reduce((n, p) => n + p.cartons, 0), places };
}

/** The last stores in a warehouse — the list under the scan box. */
export async function recentStores(actor: Actor, warehouseId: number) {
  if (!mayUse(actor, "storage.goods.update", warehouseId)) throw new InwardError("NOT_FOUND", "No such warehouse");
  const rows = await getDb().execute<{
    carton_no: string; item_code: string | null; description: string; gala: string; from_gala: string | null;
    action: string; at: string; by: string | null;
  }>(sql`
    select c.carton_no, li.item_code, li.description,
           g.code || case when g.deleted_at is not null then ' (deleted)' else '' end as gala,
           fg.code || case when fg.deleted_at is not null then ' (deleted)' else '' end as from_gala,
           m.action, m.moved_at::text as at,
           trim(u.first_name || ' ' || coalesce(u.last_name, '')) as by
      from wms.carton_movement m
      join wms.inward_carton c on c.id = m.carton_id
      join wms.inward_request_item li on li.id = c.inward_request_item_id
      join wms.warehouse_gala g on g.id = m.to_gala_id
      left join wms.warehouse_gala fg on fg.id = m.from_gala_id
      left join wms.users u on u.id = m.moved_by
     where g.warehouse_id = ${warehouseId}
     order by m.moved_at desc
     limit 50
  `);
  return rows.map((r) => ({
    cartonNo: r.carton_no, itemCode: r.item_code, description: r.description, gala: r.gala, fromGala: r.from_gala,
    action: r.action, at: r.at, by: r.by,
  }));
}
