import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db";
import type { Actor } from "@/lib/auth/guard";
import { cartonNoFromScan } from "@/lib/inward/carton-format";
import { InwardError } from "@/lib/inward/ops";
import { galaFromScan } from "@/lib/storage/location-format";
import { mayUse } from "@/lib/storage/locations";

/**
 * Stored cartons, read three ways — one gala, one floor, or a whole
 * warehouse — and a find box that answers "where is it?" for a gala code,
 * a carton number, an item or an importer.
 *
 * Every carton row carries what a person needs to recognise it without
 * opening anything: item code and description, importer, pieces per carton
 * with the unit, kg, inward, gala and floor, when and by whom it was stored.
 *
 * Super admin, warehouse admin and storage manager: storage.goods.update.
 */

export type StoredCarton = {
  id: number;
  cartonNo: string;
  itemCode: string | null;
  description: string;
  importerId: number;
  importer: string;
  piecesPerCarton: number;
  unitCode: string | null;
  kgPerCarton: number;
  inwardId: number;
  inwardCode: string;
  galaId: number;
  galaCode: string;
  floorId: number;
  floorName: string;
  storedAt: string | null;
  by: string | null;
};

export type ItemTotal = { itemCode: string | null; description: string; importer: string; unitCode: string | null; cartons: number; pieces: number; kg: number };

export type NavGala = { id: number; code: string; name: string; cartons: number; isActive: boolean };
export type NavFloor = { id: number; code: string; name: string; cartons: number; galas: NavGala[] };

/** Where the list is from, and the floors and galas around it — for the breadcrumb and previous / next. */
export type CartonPlace = {
  kind: "GALA" | "FLOOR" | "WAREHOUSE";
  warehouse: { id: number; code: string; name: string };
  floor: { id: number; code: string; name: string } | null;
  gala: { id: number; code: string; name: string; isActive: boolean } | null;
  prev: { id: number; code: string } | null;
  next: { id: number; code: string } | null;
  floors: NavFloor[];
};

export type CartonList = {
  place: CartonPlace;
  cartons: StoredCarton[];
  items: ItemTotal[];
  /** Cartons in the place; `cartons` holds at most LIMIT of them. */
  total: number;
  truncated: boolean;
};

export const LIMIT = 5000;

const ROW = sql`
  select c.id, c.carton_no, li.item_code, li.description, r.importer_id, i.company_name as importer,
         li.pieces_per_carton, li.unit_code, coalesce(li.kg_per_carton, 0)::float8 as kg_per_carton,
         r.id as inward_id, r.code as inward_code, g.id as gala_id, g.code as gala_code, f.id as floor_id, f.name as floor_name,
         c.stored_at::text as stored_at, trim(u.first_name || ' ' || coalesce(u.last_name, '')) as by
    from wms.inward_carton c
    join wms.warehouse_gala g on g.id = c.gala_id
    join wms.warehouse_floor f on f.id = g.floor_id
    join wms.inward_request r on r.id = c.inward_request_id
    join wms.importer i on i.id = r.importer_id
    join wms.inward_request_item li on li.id = c.inward_request_item_id
    left join wms.users u on u.id = c.stored_by`;

function row(r: Record<string, unknown>): StoredCarton {
  return {
    id: Number(r.id),
    cartonNo: String(r.carton_no),
    itemCode: (r.item_code as string | null) ?? null,
    description: String(r.description ?? ""),
    importerId: Number(r.importer_id),
    importer: String(r.importer ?? ""),
    piecesPerCarton: Number(r.pieces_per_carton ?? 0),
    unitCode: (r.unit_code as string | null) ?? null,
    kgPerCarton: Number(r.kg_per_carton ?? 0),
    inwardId: Number(r.inward_id),
    inwardCode: String(r.inward_code),
    galaId: Number(r.gala_id),
    galaCode: String(r.gala_code),
    floorId: Number(r.floor_id),
    floorName: String(r.floor_name),
    storedAt: (r.stored_at as string | null) ?? null,
    by: (r.by as string | null) || null,
  };
}

/** A stored carton: received, in a gala, not picked for a delivery note. */
const STORED = sql`c.status = 'RECEIVED' and c.gala_id is not null and c.area is null`;

async function navOf(warehouseId: number): Promise<NavFloor[]> {
  const rows = await getDb().execute<Record<string, unknown>>(sql`
    select f.id as floor_id, f.code as floor_code, f.name as floor_name, f.floor_no,
           g.id, g.code, g.name, g.gala_no, (g.is_active and f.is_active) as is_active,
           (select count(*) from wms.inward_carton c where c.gala_id = g.id and ${STORED})::int as cartons
      from wms.warehouse_floor f
      left join wms.warehouse_gala g on g.floor_id = f.id and g.deleted_at is null
     where f.warehouse_id = ${warehouseId} and f.deleted_at is null
     order by f.floor_no, g.gala_no
  `);
  const floors: NavFloor[] = [];
  for (const r of rows) {
    let f = floors.find((x) => x.id === Number(r.floor_id));
    if (!f) {
      f = { id: Number(r.floor_id), code: String(r.floor_code), name: String(r.floor_name), cartons: 0, galas: [] };
      floors.push(f);
    }
    if (r.id !== null && r.id !== undefined) {
      const n = Number(r.cartons);
      f.galas.push({ id: Number(r.id), code: String(r.code), name: String(r.name), cartons: n, isActive: Boolean(r.is_active) });
      f.cartons += n;
    }
  }
  return floors;
}

async function warehouseOf(id: number) {
  const w = (await getDb().execute<{ id: number; code: string; name: string }>(sql`
    select id, code, name from wms.warehouse where id = ${id}
  `))[0];
  if (!w) throw new InwardError("NOT_FOUND", "No such warehouse");
  return { id: Number(w.id), code: w.code, name: w.name };
}

export type CartonScope = { galaId: number } | { floorId: number } | { warehouseId: number };

/** The cartons of one gala, floor or warehouse, with item totals and the way around. */
export async function storedCartons(actor: Actor, scope: CartonScope, q: string | null = null): Promise<CartonList> {
  const db = getDb();
  let warehouseId: number;
  let floor: CartonPlace["floor"] = null;
  let gala: CartonPlace["gala"] = null;
  let where: SQL;
  if ("galaId" in scope) {
    const g = (await db.execute<Record<string, unknown>>(sql`
      select g.id, g.code, g.name, (g.is_active and f.is_active) as is_active, g.warehouse_id, f.id as floor_id, f.code as floor_code, f.name as floor_name
        from wms.warehouse_gala g join wms.warehouse_floor f on f.id = g.floor_id
       where g.id = ${scope.galaId} and g.deleted_at is null and f.deleted_at is null
    `))[0];
    if (!g) throw new InwardError("NOT_FOUND", "No such gala");
    warehouseId = Number(g.warehouse_id);
    floor = { id: Number(g.floor_id), code: String(g.floor_code), name: String(g.floor_name) };
    gala = { id: Number(g.id), code: String(g.code), name: String(g.name), isActive: Boolean(g.is_active) };
    where = sql`c.gala_id = ${gala.id}`;
  } else if ("floorId" in scope) {
    const f = (await db.execute<Record<string, unknown>>(sql`
      select id, code, name, warehouse_id from wms.warehouse_floor where id = ${scope.floorId} and deleted_at is null
    `))[0];
    if (!f) throw new InwardError("NOT_FOUND", "No such floor");
    warehouseId = Number(f.warehouse_id);
    floor = { id: Number(f.id), code: String(f.code), name: String(f.name) };
    where = sql`f.id = ${floor.id}`;
  } else {
    warehouseId = scope.warehouseId;
    where = sql`g.warehouse_id = ${warehouseId}`;
  }
  if (!mayUse(actor, "storage.goods.update", warehouseId)) throw new InwardError("NOT_FOUND", "No such place");

  const parts: SQL[] = [where, STORED, sql`g.deleted_at is null`];
  const text = q?.trim().toLowerCase();
  if (text) {
    const like = `%${text}%`;
    const no = cartonNoFromScan(text);
    parts.push(sql`(${no ? sql`c.carton_no = ${no} or ` : sql``}lower(c.carton_no) like ${like} or lower(coalesce(li.item_code, '')) like ${like}
                    or lower(li.description) like ${like} or lower(i.company_name) like ${like} or lower(r.code) like ${like})`);
  }
  const cond = sql.join(parts, sql` and `);
  const [rows, totals, floors, warehouse] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`${ROW} where ${cond} order by c.stored_at desc nulls last, c.carton_no limit ${LIMIT}`),
    db.execute<Record<string, unknown>>(sql`
      select li.item_code, li.description, i.company_name as importer, li.unit_code, count(*)::int as cartons,
             sum(li.pieces_per_carton)::int as pieces, coalesce(sum(li.kg_per_carton), 0)::float8 as kg
        from wms.inward_carton c
        join wms.warehouse_gala g on g.id = c.gala_id
        join wms.warehouse_floor f on f.id = g.floor_id
        join wms.inward_request r on r.id = c.inward_request_id
        join wms.importer i on i.id = r.importer_id
        join wms.inward_request_item li on li.id = c.inward_request_item_id
       where ${cond}
       group by li.item_code, li.description, i.company_name, li.unit_code
       order by i.company_name, li.item_code nulls last, li.description
    `),
    navOf(warehouseId),
    warehouseOf(warehouseId),
  ]);
  const items = totals.map((t) => ({
    itemCode: (t.item_code as string | null) ?? null,
    description: String(t.description ?? ""),
    importer: String(t.importer ?? ""),
    unitCode: (t.unit_code as string | null) ?? null,
    cartons: Number(t.cartons),
    pieces: Number(t.pieces),
    kg: Number(t.kg),
  }));
  const total = items.reduce((n, i) => n + i.cartons, 0);

  // Previous / next: galas in floor and number order (a floor: floors in order).
  let prev: CartonPlace["prev"] = null;
  let next: CartonPlace["next"] = null;
  if (gala) {
    const all = floors.flatMap((f) => f.galas);
    const at = all.findIndex((g) => g.id === gala!.id);
    if (at > 0) prev = { id: all[at - 1]!.id, code: all[at - 1]!.code };
    if (at >= 0 && at < all.length - 1) next = { id: all[at + 1]!.id, code: all[at + 1]!.code };
  } else if (floor) {
    const at = floors.findIndex((f) => f.id === floor!.id);
    if (at > 0) prev = { id: floors[at - 1]!.id, code: floors[at - 1]!.code };
    if (at >= 0 && at < floors.length - 1) next = { id: floors[at + 1]!.id, code: floors[at + 1]!.code };
  }
  return {
    place: { kind: gala ? "GALA" : floor ? "FLOOR" : "WAREHOUSE", warehouse, floor, gala, prev, next, floors },
    cartons: rows.map(row),
    items,
    total,
    truncated: total > rows.length,
  };
}

// ── Find ──────────────────────────────────────────────────────────

export type FindAnswer = {
  q: string;
  /** A gala code typed or scanned. */
  galas: { id: number; code: string; name: string; floor: string; cartons: number }[];
  /** A carton number: where it is now. */
  carton: { cartonNo: string; where: string; galaId: number | null; galaCode: string | null; dnId: number | null; dnNo: string | null } | null;
  /** An item or importer: every gala holding it, with how many. */
  places: { galaId: number; galaCode: string; floor: string; itemCode: string | null; description: string; importer: string; unitCode: string | null; cartons: number; pieces: number }[];
};

export async function findStock(actor: Actor, warehouseId: number, q: string): Promise<FindAnswer> {
  if (!mayUse(actor, "storage.goods.update", warehouseId)) throw new InwardError("NOT_FOUND", "No such warehouse");
  const text = q.trim().slice(0, 120);
  const out: FindAnswer = { q: text, galas: [], carton: null, places: [] };
  if (!text) return out;
  const db = getDb();

  const g = galaFromScan(text);
  const galaLike = g ? g.code : text.toUpperCase();
  const galas = await db.execute<Record<string, unknown>>(sql`
    select g.id, g.code, g.name, f.name as floor,
           (select count(*) from wms.inward_carton c where c.gala_id = g.id and ${STORED})::int as cartons
      from wms.warehouse_gala g join wms.warehouse_floor f on f.id = g.floor_id
     where g.warehouse_id = ${warehouseId} and g.deleted_at is null and f.deleted_at is null
       and (g.code = ${galaLike} or (${!g} and (upper(g.code) like ${`${galaLike}%`} or lower(g.name) like ${`%${text.toLowerCase()}%`})))
     order by f.floor_no, g.gala_no
     limit 30
  `);
  out.galas = galas.map((r) => ({ id: Number(r.id), code: String(r.code), name: String(r.name), floor: String(r.floor), cartons: Number(r.cartons) }));
  if (g) return out;

  const no = cartonNoFromScan(text);
  if (no) {
    const c = (await db.execute<Record<string, unknown>>(sql`
      select c.carton_no, c.status, c.area, c.gala_id, g.code as gala_code, f.name as floor, d.id as dn_id, d.dn_no, r.warehouse_id
        from wms.inward_carton c
        join wms.inward_request r on r.id = c.inward_request_id
        left join wms.warehouse_gala g on g.id = c.gala_id
        left join wms.warehouse_floor f on f.id = g.floor_id
        left join wms.delivery_note d on d.id = c.dn_id
       where c.carton_no = ${no}
    `))[0];
    if (c && Number(c.warehouse_id) === warehouseId) {
      const where =
        c.area === "PACKING"
          ? `Picked for delivery note ${c.dn_no ?? ""} — in the packing area`
          : c.area === "RETURN"
            ? `Waiting to be put back (from ${c.dn_no ?? "a delivery note"})`
            : c.status !== "RECEIVED"
              ? c.status === "HOLD"
                ? "On hold at the dock"
                : "Not received yet"
              : c.gala_code
                ? `In ${c.gala_code} · ${c.floor}`
                : "Received — at the dock, not stored yet";
      out.carton = {
        cartonNo: String(c.carton_no),
        where,
        galaId: c.area ? null : ((c.gala_id as number | null) ?? null),
        galaCode: c.area ? null : ((c.gala_code as string | null) ?? null),
        dnId: c.dn_id === null || c.dn_id === undefined ? null : Number(c.dn_id),
        dnNo: (c.dn_no as string | null) ?? null,
      };
    } else if (c) {
      out.carton = { cartonNo: String(c.carton_no), where: "In another warehouse", galaId: null, galaCode: null, dnId: null, dnNo: null };
    }
    return out;
  }

  const like = `%${text.toLowerCase()}%`;
  const places = await db.execute<Record<string, unknown>>(sql`
    select g.id as gala_id, g.code as gala_code, f.name as floor, li.item_code, li.description, i.company_name as importer, li.unit_code,
           count(*)::int as cartons, sum(li.pieces_per_carton)::int as pieces
      from wms.inward_carton c
      join wms.warehouse_gala g on g.id = c.gala_id
      join wms.warehouse_floor f on f.id = g.floor_id
      join wms.inward_request r on r.id = c.inward_request_id
      join wms.importer i on i.id = r.importer_id
      join wms.inward_request_item li on li.id = c.inward_request_item_id
     where g.warehouse_id = ${warehouseId} and ${STORED} and g.deleted_at is null
       and (lower(coalesce(li.item_code, '')) like ${like} or lower(li.description) like ${like} or lower(i.company_name) like ${like})
     group by g.id, g.code, f.name, f.floor_no, g.gala_no, li.item_code, li.description, i.company_name, li.unit_code
     order by li.item_code nulls last, li.description, f.floor_no, g.gala_no
     limit 200
  `);
  out.places = places.map((r) => ({
    galaId: Number(r.gala_id),
    galaCode: String(r.gala_code),
    floor: String(r.floor),
    itemCode: (r.item_code as string | null) ?? null,
    description: String(r.description ?? ""),
    importer: String(r.importer ?? ""),
    unitCode: (r.unit_code as string | null) ?? null,
    cartons: Number(r.cartons),
    pieces: Number(r.pieces),
  }));
  return out;
}
