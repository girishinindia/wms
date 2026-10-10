import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { auditQuietly } from "@/lib/audit";
import type { Actor } from "@/lib/auth/guard";
import { InwardError, type Meta } from "@/lib/inward/ops";
import { floorCode, galaCode, galaFullId, galaQrText } from "@/lib/storage/location-format";

/**
 * Floors and galas — the only storage shape there is:
 *
 *   Warehouse › Floor (F1) › Gala (F1-G01)
 *
 * Super admin (every warehouse), warehouse admin and storage manager
 * (their own). Numbers are handed out here — next floor, next gala — and
 * never reused; a gala that is not used any more is switched off.
 */

/** Warehouses this actor may work in for `permission`, or null = all. */
export function warehousesFor(actor: Actor, permission: string): number[] | null {
  let ids: number[] = [];
  for (const p of actor.permissions) {
    if (p.permission !== permission) continue;
    if (p.scope === "ALL") return null;
    if (p.scope === "WAREHOUSE") ids = [...ids, ...p.warehouseIds];
  }
  return [...new Set(ids)];
}

export function mayUse(actor: Actor, permission: string, warehouseId: number): boolean {
  const ids = warehousesFor(actor, permission);
  return ids === null || ids.includes(warehouseId);
}

function need(actor: Actor, permission: string, warehouseId: number) {
  if (!mayUse(actor, permission, warehouseId)) throw new InwardError("NOT_FOUND", "No such warehouse");
}

export type StoreWarehouse = { id: number; code: string; name: string; floors: number; galas: number };

/** The warehouses the person can store into, with how far each is set up. */
export async function storageWarehouses(actor: Actor): Promise<StoreWarehouse[]> {
  const ids = warehousesFor(actor, "storage.goods.update");
  if (ids !== null && ids.length === 0) return [];
  const rows = await getDb().execute<{ id: number; code: string; name: string; floors: string; galas: string }>(sql`
    select w.id, w.code, w.name,
           (select count(*) from wms.warehouse_floor f where f.warehouse_id = w.id and f.is_active)::text as floors,
           (select count(*) from wms.warehouse_gala g where g.warehouse_id = w.id and g.is_active)::text as galas
      from wms.warehouse w
     where w.deleted_at is null
       ${ids === null ? sql`` : sql`and w.id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`}
     order by w.name
  `);
  return rows.map((r) => ({ id: Number(r.id), code: r.code, name: r.name, floors: Number(r.floors), galas: Number(r.galas) }));
}

export type GalaRow = {
  id: number;
  floorId: number;
  galaNo: number;
  code: string;
  fullId: string;
  name: string;
  isActive: boolean;
  cartons: number;
  qr: string;
};

export type FloorRow = {
  id: number;
  floorNo: number;
  code: string;
  name: string;
  isActive: boolean;
  cartons: number;
  galas: GalaRow[];
};

export type Layout = {
  warehouse: { id: number; code: string; name: string };
  floors: FloorRow[];
  totals: { floors: number; galas: number; stored: number; emptyGalas: number };
  can: { edit: boolean };
};

/** Every floor and gala of a warehouse, with how many cartons each holds. */
export async function layout(actor: Actor, warehouseId: number): Promise<Layout> {
  if (!mayUse(actor, "storage.goods.update", warehouseId) && !mayUse(actor, "warehouse.location.update", warehouseId)) {
    throw new InwardError("NOT_FOUND", "No such warehouse");
  }
  const db = getDb();
  const wh = await db.execute<{ id: number; code: string; name: string }>(sql`
    select id, code, name from wms.warehouse where id = ${warehouseId} and deleted_at is null
  `);
  if (!wh[0]) throw new InwardError("NOT_FOUND", "No such warehouse");
  const w = { id: Number(wh[0].id), code: wh[0].code, name: wh[0].name };

  const floors = await db.execute<{ id: number; floor_no: number; code: string; name: string; is_active: boolean }>(sql`
    select id, floor_no, code, name, is_active from wms.warehouse_floor where warehouse_id = ${warehouseId} order by floor_no
  `);
  const galas = await db.execute<{
    id: number;
    floor_id: number;
    floor_no: number;
    gala_no: number;
    code: string;
    name: string;
    is_active: boolean;
    cartons: string;
  }>(sql`
    select g.id, g.floor_id, f.floor_no, g.gala_no, g.code, g.name, g.is_active,
           (select count(*) from wms.inward_carton c where c.gala_id = g.id)::text as cartons
      from wms.warehouse_gala g join wms.warehouse_floor f on f.id = g.floor_id
     where g.warehouse_id = ${warehouseId}
     order by f.floor_no, g.gala_no
  `);
  const rows: FloorRow[] = floors.map((f) => ({
    id: Number(f.id),
    floorNo: Number(f.floor_no),
    code: f.code,
    name: f.name,
    isActive: Boolean(f.is_active),
    cartons: 0,
    galas: [],
  }));
  const byId = new Map(rows.map((f) => [f.id, f]));
  for (const g of galas) {
    const floor = byId.get(Number(g.floor_id));
    if (!floor) continue;
    const cartons = Number(g.cartons);
    floor.cartons += cartons;
    floor.galas.push({
      id: Number(g.id),
      floorId: floor.id,
      galaNo: Number(g.gala_no),
      code: g.code,
      fullId: galaFullId(w.code, g.code),
      name: g.name,
      isActive: Boolean(g.is_active) && floor.isActive,
      cartons,
      qr: galaQrText({ warehouseCode: w.code, warehouseName: w.name, floorNo: floor.floorNo, galaNo: Number(g.gala_no), code: g.code }),
    });
  }
  const all = rows.flatMap((f) => f.galas);
  return {
    warehouse: w,
    floors: rows,
    totals: {
      floors: rows.filter((f) => f.isActive).length,
      galas: all.filter((g) => g.isActive).length,
      stored: all.reduce((n, g) => n + g.cartons, 0),
      emptyGalas: all.filter((g) => g.isActive && g.cartons === 0).length,
    },
    can: { edit: mayUse(actor, "warehouse.location.update", warehouseId) && mayUse(actor, "warehouse.location.create", warehouseId) },
  };
}

function auditOf(actor: Actor, meta: Meta) {
  return {
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  };
}

/** The next floor: F1, F2… Two people adding at once collide on the
 *  unique index and the second simply takes the next number. */
export async function addFloor(actor: Actor, warehouseId: number, meta: Meta): Promise<Layout> {
  need(actor, "warehouse.location.create", warehouseId);
  const db = getDb();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = await db.execute<{ n: number }>(sql`
      select coalesce(max(floor_no), 0) + 1 as n from wms.warehouse_floor where warehouse_id = ${warehouseId}
    `);
    const n = Number(next[0]?.n ?? 1);
    if (n > 99) throw new InwardError("VALIDATION_FAILED", "A warehouse can have at most 99 floors");
    try {
      const rows = await db.execute<{ id: number }>(sql`
        insert into wms.warehouse_floor (warehouse_id, floor_no, code, name, created_by, updated_by)
        values (${warehouseId}, ${n}, ${floorCode(n)}, ${`Floor ${n}`}, ${actor.session.userId}, ${actor.session.userId})
        returning id
      `);
      await auditQuietly({
        action: "storage.floor.created",
        operation: "INSERT",
        entityType: "warehouse_floor",
        entityId: String(rows[0]!.id),
        entityLabel: floorCode(n),
        after: { warehouseId, floorNo: n },
        ...auditOf(actor, meta),
      });
      return layout(actor, warehouseId);
    } catch (error) {
      if (!isUnique(error)) throw error;
    }
  }
  throw new InwardError("CONFLICT", "Someone else is adding floors right now. Try again.");
}

/** `count` more galas on a floor: G01, G02… after the last one. */
export async function addGalas(actor: Actor, floorId: number, count: number, meta: Meta): Promise<Layout> {
  const db = getDb();
  const floors = await db.execute<{ warehouse_id: number; floor_no: number; is_active: boolean }>(sql`
    select warehouse_id, floor_no, is_active from wms.warehouse_floor where id = ${floorId}
  `);
  const floor = floors[0];
  if (!floor) throw new InwardError("NOT_FOUND", "No such floor");
  const warehouseId = Number(floor.warehouse_id);
  need(actor, "warehouse.location.create", warehouseId);
  if (!floor.is_active) throw new InwardError("CONFLICT", "Switch the floor on before adding galas to it");
  const n = Math.max(1, Math.min(50, Math.floor(count)));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const last = await db.execute<{ n: number }>(sql`
      select coalesce(max(gala_no), 0) as n from wms.warehouse_gala where floor_id = ${floorId}
    `);
    const from = Number(last[0]?.n ?? 0) + 1;
    if (from + n - 1 > 999) throw new InwardError("VALIDATION_FAILED", "A floor can have at most 999 galas");
    const rows = Array.from({ length: n }, (_, i) => from + i).map((g) => ({
      gala_no: g,
      code: galaCode(Number(floor.floor_no), g),
      name: `Gala ${g}`,
    }));
    try {
      await db.execute(sql`
        insert into wms.warehouse_gala (warehouse_id, floor_id, gala_no, code, name, created_by, updated_by)
        select ${warehouseId}, ${floorId}, x.gala_no, x.code, x.name, ${actor.session.userId}, ${actor.session.userId}
          from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(gala_no smallint, code text, name text)
      `);
      await auditQuietly({
        action: "storage.galas.created",
        operation: "INSERT",
        entityType: "warehouse_floor",
        entityId: String(floorId),
        entityLabel: floorCode(Number(floor.floor_no)),
        after: { warehouseId, galas: rows.map((r) => r.code) },
        ...auditOf(actor, meta),
      });
      return layout(actor, warehouseId);
    } catch (error) {
      if (!isUnique(error)) throw error;
    }
  }
  throw new InwardError("CONFLICT", "Someone else is adding galas right now. Try again.");
}

/** Switch a floor or a gala on or off. Off only when nothing is stored in it. */
export async function setActive(
  actor: Actor,
  kind: "floor" | "gala",
  id: number,
  active: boolean,
  meta: Meta,
): Promise<Layout> {
  const db = getDb();
  const rows =
    kind === "floor"
      ? await db.execute<{ warehouse_id: number; code: string; cartons: string }>(sql`
          select f.warehouse_id, f.code,
                 (select count(*) from wms.inward_carton c join wms.warehouse_gala g on g.id = c.gala_id
                   where g.floor_id = f.id)::text as cartons
            from wms.warehouse_floor f where f.id = ${id}
        `)
      : await db.execute<{ warehouse_id: number; code: string; cartons: string }>(sql`
          select g.warehouse_id, g.code,
                 (select count(*) from wms.inward_carton c where c.gala_id = g.id)::text as cartons
            from wms.warehouse_gala g where g.id = ${id}
        `);
  const row = rows[0];
  if (!row) throw new InwardError("NOT_FOUND", kind === "floor" ? "No such floor" : "No such gala");
  const warehouseId = Number(row.warehouse_id);
  need(actor, "warehouse.location.update", warehouseId);
  const stored = Number(row.cartons);
  if (!active && stored > 0) {
    throw new InwardError(
      "CONFLICT",
      `${row.code} still holds ${stored} carton${stored === 1 ? "" : "s"}. Move them to another gala first.`,
    );
  }
  if (kind === "floor") {
    await db.execute(sql`
      update wms.warehouse_floor set is_active = ${active}, updated_by = ${actor.session.userId}, updated_at = now() where id = ${id}
    `);
  } else {
    await db.execute(sql`
      update wms.warehouse_gala set is_active = ${active}, updated_by = ${actor.session.userId}, updated_at = now() where id = ${id}
    `);
  }
  await auditQuietly({
    action: `storage.${kind}.${active ? "activated" : "deactivated"}`,
    operation: "UPDATE",
    entityType: kind === "floor" ? "warehouse_floor" : "warehouse_gala",
    entityId: String(id),
    entityLabel: row.code,
    after: { isActive: active },
    ...auditOf(actor, meta),
  });
  return layout(actor, warehouseId);
}

const isUnique = (error: unknown): boolean => {
  const code =
    (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
  return code === "23505";
};
