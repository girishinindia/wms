import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { auditQuietly } from "@/lib/audit";
import { grantFor, type Actor } from "@/lib/auth/guard";
import { cartonNoFromScan } from "@/lib/inward/carton-format";
import { InwardError, type Meta } from "@/lib/inward/ops";
import { announce } from "@/lib/notify/announce";
import { warehousesFor } from "@/lib/storage/locations";

/**
 * A delivery note in the warehouse: assign staff, pick every carton by
 * scanning it at its gala, confirm it at the packing area, pack cartons
 * into packages / bundles that get their own QR, verify each package, and
 * the note is READY FOR DISPATCH (once the importer has approved it).
 *
 *   package.read     see the work            SA · WA · Package · Storage · Outward
 *   package.update   pick / arrive / pack    SA · WA · Package · Storage (assigned)
 *   package.create   make packages           SA · WA · Package · Storage (assigned)
 *   package.approve  assign, verify, hold    SA · WA · Package · Outward
 *   package.delete   reopen / cancel a package   SA · WA
 *
 * Every scan runs in one database function (sql/41) that locks the note
 * and the carton: a carton is picked once, a line never over-picked.
 */

export const WORK_LABEL: Record<string, string> = {
  NEW: "New",
  ASSIGNED: "Assigned",
  PARTIALLY_PICKED: "Picking",
  PICKED: "Picked",
  PACKAGING_IN_PROGRESS: "Packing",
  PARTIALLY_PACKAGED: "Partly packed",
  PACKAGED: "Packed",
  VERIFICATION_PENDING: "Verifying",
  READY_FOR_DISPATCH: "Ready for dispatch",
  RETURNING: "Put back to storage",
  CANCELLED: "Closed",
  ON_HOLD: "On hold",
};

const PICKERS = ["PACKAGE_MANAGER", "STORAGE_MANAGER", "WAREHOUSE_ADMIN"];

type Scope = number[] | null;

function scopeFor(actor: Actor, permission: string): Scope {
  const ids = warehousesFor(actor, permission);
  if (ids !== null && ids.length === 0) throw new InwardError("FORBIDDEN", "You do not have permission to do that.");
  return ids;
}
const inScope = (scope: Scope, warehouseId: number) => scope === null || scope.includes(warehouseId);
const may = (actor: Actor, permission: string, warehouseId: number) => {
  const ids = warehousesFor(actor, permission);
  return ids === null || ids.includes(warehouseId);
};

/** "1 carton", "14 cartons" — the notification texts carry the noun. */
export const count = (k: number, noun: string) => `${k.toLocaleString("en-IN")} ${noun}${k === 1 ? "" : "s"}`;

function who(actor: Actor): string {
  return `${actor.session.firstName} ${actor.session.lastName}`.trim();
}

// ── The queue ─────────────────────────────────────────────────────

export type WorkRow = {
  id: number;
  dnNo: string;
  dnDate: string;
  status: string;
  workStatus: string;
  workLabel: string;
  onHold: boolean;
  importerName: string;
  warehouseId: number;
  warehouseName: string;
  buyerName: string;
  buyerCity: string | null;
  priority: string;
  handling: string;
  required: number;
  picked: number;
  packed: number;
  packages: number;
  returning: number;
  assignees: string[];
  mine: boolean;
  createdAt: string;
};

const WORK_SELECT = sql`
  select n.id, n.importer_id, n.dn_no, n.dn_date::text as dn_date, n.status, n.work_status, n.on_hold, i.company_name as importer_name,
         n.warehouse_id, w.name as warehouse_name, n.buyer_name, n.buyer_city, n.priority, n.handling, n.created_at::text as created_at,
         coalesce((select sum(l.cartons) from wms.delivery_line l where l.delivery_note_id = n.id), 0)::int as required,
         (select count(*) from wms.inward_carton c where c.dn_id = n.id and c.area = 'PACKING')::int as picked,
         (select count(*) from wms.inward_carton c join wms.delivery_package p on p.id = c.package_id
           where c.dn_id = n.id and c.area = 'PACKING' and p.status <> 'CANCELLED')::int as packed,
         (select count(*) from wms.delivery_package p where p.note_id = n.id and p.status <> 'CANCELLED')::int as packages,
         (select count(*) from wms.inward_carton c where c.dn_id = n.id and c.area = 'RETURN')::int as returning,
         coalesce((select array_agg(trim(u.first_name || ' ' || coalesce(u.last_name, '')) order by a.assigned_at)
                     from wms.delivery_note_assignee a join wms.users u on u.id = a.user_id
                    where a.note_id = n.id and a.removed_at is null), '{}') as assignees,
         coalesce((select array_agg(a.user_id) from wms.delivery_note_assignee a where a.note_id = n.id and a.removed_at is null), '{}') as assignee_ids
    from wms.delivery_note n
    join wms.importer i on i.id = n.importer_id
    join wms.warehouse w on w.id = n.warehouse_id`;

function workRow(r: Record<string, unknown>, me: number): WorkRow {
  const onHold = Boolean(r.on_hold);
  const ws = String(r.work_status);
  const ids = ((r.assignee_ids as unknown[]) ?? []).map(Number);
  return {
    id: Number(r.id),
    dnNo: String(r.dn_no),
    dnDate: String(r.dn_date),
    status: String(r.status),
    workStatus: onHold ? "ON_HOLD" : ws,
    workLabel: onHold ? WORK_LABEL.ON_HOLD! : (WORK_LABEL[ws] ?? ws),
    onHold,
    importerName: String(r.importer_name),
    warehouseId: Number(r.warehouse_id),
    warehouseName: String(r.warehouse_name),
    buyerName: String(r.buyer_name),
    buyerCity: (r.buyer_city as string | null) ?? null,
    priority: String(r.priority),
    handling: String(r.handling ?? "NORMAL"),
    required: Number(r.required),
    picked: Number(r.picked),
    packed: Number(r.packed),
    packages: Number(r.packages),
    returning: Number(r.returning),
    assignees: ((r.assignees as unknown[]) ?? []).map(String),
    mine: ids.includes(me),
    createdAt: String(r.created_at),
  };
}

/** The delivery notes the warehouse is working on (or must put back). */
export async function workQueue(actor: Actor, filter: { view?: string | null; q?: string | null } = {}): Promise<WorkRow[]> {
  const scope = scopeFor(actor, "package.read");
  const parts = [
    scope === null ? sql`true` : sql`n.warehouse_id in (${sql.join(scope.map((w) => sql`${w}`), sql`, `)})`,
    sql`(n.status in ('PENDING','APPROVED') or n.work_status = 'RETURNING')`,
  ];
  const view = filter.view ?? "OPEN";
  if (view === "OPEN") parts.push(sql`n.work_status not in ('READY_FOR_DISPATCH')`);
  if (view === "MINE") {
    parts.push(sql`exists (select 1 from wms.delivery_note_assignee a where a.note_id = n.id and a.removed_at is null and a.user_id = ${actor.session.userId})`);
  }
  if (view === "READY") parts.push(sql`n.work_status = 'READY_FOR_DISPATCH'`);
  if (view === "PUTBACK") parts.push(sql`n.work_status = 'RETURNING'`);
  const q = filter.q?.trim().toLowerCase();
  if (q) {
    const like = `%${q}%`;
    // A carton number finds the note it was picked for.
    parts.push(sql`(lower(n.dn_no) like ${like} or lower(n.buyer_name) like ${like} or lower(i.company_name) like ${like}
                    or lower(coalesce(n.buyer_city, '')) like ${like}
                    or exists (select 1 from wms.inward_carton c where c.dn_id = n.id and lower(c.carton_no) like ${like}))`);
  }
  const rows = await getDb().execute<Record<string, unknown>>(sql`
    ${WORK_SELECT}
     where ${sql.join(parts, sql` and `)}
     order by case n.priority when 'URGENT' then 0 else 1 end, n.created_at
     limit 300
  `);
  return rows.map((r) => workRow(r, actor.session.userId));
}

// ── One note ──────────────────────────────────────────────────────

export type PickLocation = { place: string; floor: string | null; kind: "GALA" | "DOCK" | "RETURN"; cartons: number; cartonNos: string[] };
export type WorkLine = {
  id: number;
  key: string;
  itemCode: string | null;
  description: string;
  piecesPerCarton: number;
  unitCode: string | null;
  orderPieces: number;
  required: number;
  picked: number;
  arrived: number;
  packed: number;
  locations: PickLocation[];
  /** Which free cartons to take for what is still to pick: oldest stock first, by place. */
  suggested: PickStop[];
};
/** One place to go to, and the cartons to take there. */
export type PickStop = { kind: "GALA" | "DOCK" | "RETURN"; galaId: number | null; place: string; floor: string | null; cartonNos: string[] };
/** The walk: every stop in floor → gala order (put-back shelf, then the dock, last), with what to take for each item. */
export type RouteStop = PickStop & { items: { lineId: number; item: string; cartonNos: string[] }[] };
export type WorkCarton = {
  id: number;
  cartonNo: string;
  lineKey: string;
  description: string;
  fromGala: string | null;
  pickedBy: string | null;
  pickedAt: string | null;
  arrived: boolean;
  packageId: number | null;
  packageCode: string | null;
  area: string;
};
export type WorkPackage = {
  id: number;
  code: string;
  no: number;
  kind: string;
  status: string;
  cartons: number;
  cartonNos: string[];
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  createdBy: string | null;
  createdAt: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
};
export type WorkScan = { step: string; code: string; result: string; message: string | null; by: string | null; at: string };
export type WorkDetail = WorkRow & {
  importerId: number;
  orderNo: string;
  buyerMobile: string | null;
  buyerAddress: string | null;
  buyerState: string | null;
  buyerPincode: string | null;
  transportName: string | null;
  transporterMobile: string | null;
  packing: string;
  packingOther: string | null;
  bundles: number | null;
  instructions: string | null;
  deliveryInstructions: string | null;
  remarks: string | null;
  holdReason: string | null;
  arrived: number;
  lines: WorkLine[];
  cartons: WorkCarton[];
  packageList: WorkPackage[];
  assigneeList: { id: number; name: string }[];
  assignable: { id: number; name: string; roles: string }[];
  scans: WorkScan[];
  /** The suggested pick route for what is still to pick. */
  route: RouteStop[];
  can: { assign: boolean; pick: boolean; pack: boolean; verify: boolean; hold: boolean; manage: boolean };
};

const placeName = (kind: string, gala: unknown) => (kind === "GALA" ? String(gala) : kind === "DOCK" ? "At dock (not stored)" : "Put-back shelf");

/**
 * Which cartons to pick next for a note: for each item, the oldest free
 * cartons (received first) up to what is still to pick — then grouped into
 * stops in walking order: floor by floor, gala by gala, the put-back shelf,
 * the dock. Only a suggestion: any right carton scanned counts, and the
 * route is worked out again after every scan.
 */
export async function pickPlan(noteId: number): Promise<{ byLine: Map<number, PickStop[]>; route: RouteStop[] }> {
  const rows = await getDb().execute<Record<string, unknown>>(sql`
    with n as (select importer_id, warehouse_id from wms.delivery_note where id = ${noteId}),
    need as (
      select l.id as line_id, l.stock_key, coalesce(l.item_code || ' · ', '') || l.description as item,
             l.cartons - (select count(*) from wms.inward_carton c where c.dn_line_id = l.id and c.dn_id = ${noteId} and c.area = 'PACKING') as remaining
        from wms.delivery_line l where l.delivery_note_id = ${noteId}
    ),
    free as (
      select c.carton_no, wms.stock_key(li.item_id, li.description, li.pieces_per_carton) as stock_key,
             case when c.area = 'RETURN' then 'RETURN' when c.gala_id is null then 'DOCK' else 'GALA' end as kind,
             c.gala_id, g.code as gala, f.name as floor, f.floor_no, g.gala_no,
             row_number() over (partition by wms.stock_key(li.item_id, li.description, li.pieces_per_carton)
                                order by c.received_at nulls last, c.inward_request_id, c.seq) as rn
        from wms.inward_carton c
        join wms.inward_request r on r.id = c.inward_request_id
        join wms.inward_request_item li on li.id = c.inward_request_item_id
        left join wms.warehouse_gala g on g.id = c.gala_id
        left join wms.warehouse_floor f on f.id = g.floor_id
       where r.importer_id = (select importer_id from n) and r.warehouse_id = (select warehouse_id from n)
         and c.status = 'RECEIVED' and (c.area is null or c.area = 'RETURN')
         and wms.stock_key(li.item_id, li.description, li.pieces_per_carton) in (select stock_key from need where remaining > 0)
    )
    select need.line_id, need.item, free.carton_no, free.kind, free.gala_id, free.gala, free.floor, free.floor_no, free.gala_no
      from need join free on free.stock_key = need.stock_key and free.rn <= need.remaining
     order by case free.kind when 'GALA' then 0 when 'RETURN' then 1 else 2 end, free.floor_no nulls last, free.gala_no nulls last, free.carton_no
  `);
  const byLine = new Map<number, PickStop[]>();
  const route: RouteStop[] = [];
  for (const r of rows) {
    const kind = String(r.kind) as PickStop["kind"];
    const galaId = r.gala_id === null || r.gala_id === undefined ? null : Number(r.gala_id);
    const place = placeName(kind, r.gala);
    const floor = (r.floor as string | null) ?? null;
    const no = String(r.carton_no);
    const lineId = Number(r.line_id);
    const stops = byLine.get(lineId) ?? [];
    let s = stops.find((x) => x.kind === kind && x.galaId === galaId);
    if (!s) {
      s = { kind, galaId, place, floor, cartonNos: [] };
      stops.push(s);
      byLine.set(lineId, stops);
    }
    s.cartonNos.push(no);
    let stop = route.find((x) => x.kind === kind && x.galaId === galaId);
    if (!stop) {
      stop = { kind, galaId, place, floor, cartonNos: [], items: [] };
      route.push(stop);
    }
    stop.cartonNos.push(no);
    let it = stop.items.find((x) => x.lineId === lineId);
    if (!it) {
      it = { lineId, item: String(r.item), cartonNos: [] };
      stop.items.push(it);
    }
    it.cartonNos.push(no);
  }
  return { byLine, route };
}

export type NoteWhere = {
  lines: {
    lineId: number;
    key: string;
    item: string;
    required: number;
    picked: number;
    /** Suggested cartons for what is still to pick, by place. */
    suggested: PickStop[];
    /** Already picked, and where each came from. */
    pickedFrom: { cartonNo: string; place: string; floor: string | null }[];
    /** Free cartons of the item not in the suggestion (choice for the picker). */
    otherFree: number;
  }[];
  route: RouteStop[];
};

/** For the delivery note page: where each item's cartons are (warehouse staff and super admin). */
export async function whereOf(noteId: number): Promise<NoteWhere> {
  const db = getDb();
  const [lines, picked, free, plan] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      select l.id, l.stock_key, coalesce(l.item_code || ' · ', '') || l.description as item, l.cartons,
             (select count(*) from wms.inward_carton c where c.dn_line_id = l.id and c.dn_id = ${noteId} and c.area = 'PACKING')::int as picked
        from wms.delivery_line l where l.delivery_note_id = ${noteId} order by l.id
    `),
    db.execute<Record<string, unknown>>(sql`
      select c.dn_line_id, c.carton_no, g.code as gala, f.name as floor, c.pick_from_gala_id
        from wms.inward_carton c
        left join wms.warehouse_gala g on g.id = c.pick_from_gala_id
        left join wms.warehouse_floor f on f.id = g.floor_id
       where c.dn_id = ${noteId} and c.area = 'PACKING'
       order by c.carton_no
    `),
    db.execute<Record<string, unknown>>(sql`
      select wms.stock_key(li.item_id, li.description, li.pieces_per_carton) as stock_key, count(*)::int as n
        from wms.inward_carton c
        join wms.inward_request r on r.id = c.inward_request_id
        join wms.inward_request_item li on li.id = c.inward_request_item_id
        join wms.delivery_note d on d.id = ${noteId}
       where r.importer_id = d.importer_id and r.warehouse_id = d.warehouse_id
         and c.status = 'RECEIVED' and (c.area is null or c.area = 'RETURN')
         and wms.stock_key(li.item_id, li.description, li.pieces_per_carton) in (select stock_key from wms.delivery_line where delivery_note_id = ${noteId})
       group by 1
    `),
    pickPlan(noteId),
  ]);
  return {
    lines: lines.map((l) => {
      const suggested = plan.byLine.get(Number(l.id)) ?? [];
      const taking = suggested.reduce((n, s) => n + s.cartonNos.length, 0);
      return {
        lineId: Number(l.id),
        key: String(l.stock_key),
        item: String(l.item),
        required: Number(l.cartons),
        picked: Number(l.picked),
        suggested,
        pickedFrom: picked
          .filter((c) => Number(c.dn_line_id) === Number(l.id))
          .map((c) => ({ cartonNo: String(c.carton_no), place: c.gala ? String(c.gala) : "the dock", floor: (c.floor as string | null) ?? null })),
        otherFree: Math.max(0, Number(free.find((f) => f.stock_key === l.stock_key)?.n ?? 0) - taking),
      };
    }),
    route: plan.route,
  };
}

async function noteRow(id: number): Promise<{ warehouse_id: number; importer_id: number; status: string; work_status: string; on_hold: boolean; dn_no: string; created_by: number } | null> {
  const rows = await getDb().execute<{ warehouse_id: number; importer_id: number; status: string; work_status: string; on_hold: boolean; dn_no: string; created_by: number }>(sql`
    select warehouse_id, importer_id, status, work_status, on_hold, dn_no, created_by from wms.delivery_note where id = ${id}
  `);
  return rows[0] ?? null;
}

async function isAssignee(noteId: number, userId: number): Promise<boolean> {
  const rows = await getDb().execute<{ n: number }>(sql`
    select 1 as n from wms.delivery_note_assignee where note_id = ${noteId} and user_id = ${userId} and removed_at is null
  `);
  return rows.length > 0;
}

/** What this person may do on this note's work. */
async function rights(actor: Actor, noteId: number, warehouseId: number) {
  const supervise = may(actor, "package.approve", warehouseId);
  const assigned = await isAssignee(noteId, actor.session.userId);
  const hands = (assigned || supervise) && may(actor, "package.update", warehouseId);
  return {
    assign: supervise,
    pick: hands,
    pack: hands && may(actor, "package.create", warehouseId),
    verify: supervise,
    hold: supervise,
    manage: may(actor, "package.delete", warehouseId),
  };
}

async function visible(actor: Actor, id: number) {
  const n = await noteRow(id);
  if (!n || !inScope(scopeFor(actor, "package.read"), Number(n.warehouse_id))) throw new InwardError("NOT_FOUND", "No such delivery note");
  return n;
}

export async function workDetail(actor: Actor, id: number): Promise<WorkDetail> {
  const n0 = await visible(actor, id);
  const db = getDb();
  const rows = await db.execute<Record<string, unknown>>(sql`
    ${WORK_SELECT}
     where n.id = ${id}
  `);
  const base = workRow(rows[0]!, actor.session.userId);
  const extra = (await db.execute<Record<string, unknown>>(sql`
    select n.importer_id, n.order_no, n.buyer_mobile, n.buyer_address, n.buyer_state, n.buyer_pincode, n.transport_name,
           n.transporter_mobile, n.packing, n.packing_other, n.bundles, n.instructions, n.delivery_instructions, n.remarks, n.hold_reason,
           (select count(*) from wms.inward_carton c where c.dn_id = n.id and c.area = 'PACKING' and c.arrived_at is not null)::int as arrived
      from wms.delivery_note n where n.id = ${id}
  `))[0]!;

  const lines = await db.execute<Record<string, unknown>>(sql`
    select l.id, l.stock_key, l.item_code, l.description, l.pieces_per_carton, l.unit_code, l.cartons,
           coalesce(l.order_pieces, l.cartons * l.pieces_per_carton) as order_pieces,
           (select count(*) from wms.inward_carton c where c.dn_line_id = l.id and c.dn_id = ${id} and c.area = 'PACKING')::int as picked,
           (select count(*) from wms.inward_carton c where c.dn_line_id = l.id and c.dn_id = ${id} and c.area = 'PACKING' and c.arrived_at is not null)::int as arrived,
           (select count(*) from wms.inward_carton c join wms.delivery_package p on p.id = c.package_id
             where c.dn_line_id = l.id and c.dn_id = ${id} and c.area = 'PACKING' and p.status <> 'CANCELLED')::int as packed
      from wms.delivery_line l where l.delivery_note_id = ${id} order by l.id
  `);
  // Where the free cartons of each item are: galas first (by floor), then the dock, then the put-back shelf.
  const locs = await db.execute<Record<string, unknown>>(sql`
    select wms.stock_key(li.item_id, li.description, li.pieces_per_carton) as stock_key,
           case when c.area = 'RETURN' then 'RETURN' when c.gala_id is null then 'DOCK' else 'GALA' end as kind,
           g.code as gala, f.name as floor, f.floor_no, g.gala_no, count(*)::int as cartons,
           (array_agg(c.carton_no order by c.received_at, c.seq))[1:40] as nos
      from wms.inward_carton c
      join wms.inward_request r on r.id = c.inward_request_id
      join wms.inward_request_item li on li.id = c.inward_request_item_id
      left join wms.warehouse_gala g on g.id = c.gala_id
      left join wms.warehouse_floor f on f.id = g.floor_id
     where r.importer_id = ${Number(n0.importer_id)} and r.warehouse_id = ${Number(n0.warehouse_id)}
       and c.status = 'RECEIVED' and c.area is distinct from 'PACKING'
       and wms.stock_key(li.item_id, li.description, li.pieces_per_carton) in (select stock_key from wms.delivery_line where delivery_note_id = ${id})
     group by 1, 2, g.code, f.name, f.floor_no, g.gala_no
     order by 1, case when g.code is null then 1 else 0 end, f.floor_no, g.gala_no
  `);
  const plan = await pickPlan(id);
  const cartons = await db.execute<Record<string, unknown>>(sql`
    select c.id, c.carton_no, l.stock_key, l.description, g.code as from_gala, c.area,
           trim(u.first_name || ' ' || coalesce(u.last_name, '')) as picked_by, c.picked_at::text as picked_at,
           c.arrived_at is not null as arrived, p.id as package_id, case when p.status <> 'CANCELLED' then p.code end as package_code
      from wms.inward_carton c
      left join wms.delivery_line l on l.id = c.dn_line_id
      left join wms.warehouse_gala g on g.id = c.pick_from_gala_id
      left join wms.users u on u.id = c.picked_by
      left join wms.delivery_package p on p.id = c.package_id
     where c.dn_id = ${id} and c.area in ('PACKING','RETURN')
     order by c.picked_at desc nulls last, c.id desc
  `);
  const packages = await db.execute<Record<string, unknown>>(sql`
    select p.id, p.code, p.package_no, p.kind, p.status, p.weight_kg, p.length_cm, p.width_cm, p.height_cm,
           p.created_at::text as created_at, p.verified_at::text as verified_at,
           trim(uc.first_name || ' ' || coalesce(uc.last_name, '')) as created_by,
           trim(uv.first_name || ' ' || coalesce(uv.last_name, '')) as verified_by,
           (select count(*) from wms.inward_carton c where c.package_id = p.id)::int as cartons,
           coalesce((select array_agg(c.carton_no order by c.carton_no) from wms.inward_carton c where c.package_id = p.id), '{}') as nos
      from wms.delivery_package p
      left join wms.users uc on uc.id = p.created_by
      left join wms.users uv on uv.id = p.verified_by
     where p.note_id = ${id}
     order by p.package_no
  `);
  const assignees = await db.execute<{ id: number; name: string }>(sql`
    select u.id, trim(u.first_name || ' ' || coalesce(u.last_name, '')) as name
      from wms.delivery_note_assignee a join wms.users u on u.id = a.user_id
     where a.note_id = ${id} and a.removed_at is null order by a.assigned_at
  `);
  const can = await rights(actor, id, Number(n0.warehouse_id));
  const assignable = can.assign ? await assignableUsers(Number(n0.warehouse_id)) : [];
  const scans = await db.execute<Record<string, unknown>>(sql`
    select s.step, s.code, s.result, s.message, s.scanned_at::text as at, trim(u.first_name || ' ' || coalesce(u.last_name, '')) as by
      from wms.delivery_scan s left join wms.users u on u.id = s.scanned_by
     where s.note_id = ${id} order by s.scanned_at desc, s.id desc limit 40
  `);
  const live = n0.status === "PENDING" || n0.status === "APPROVED";
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    ...base,
    importerId: Number(extra.importer_id),
    orderNo: String(extra.order_no),
    buyerMobile: (extra.buyer_mobile as string | null) ?? null,
    buyerAddress: (extra.buyer_address as string | null) ?? null,
    buyerState: (extra.buyer_state as string | null) ?? null,
    buyerPincode: (extra.buyer_pincode as string | null) ?? null,
    transportName: (extra.transport_name as string | null) ?? null,
    transporterMobile: (extra.transporter_mobile as string | null) ?? null,
    packing: String(extra.packing),
    packingOther: (extra.packing_other as string | null) ?? null,
    bundles: num(extra.bundles),
    instructions: (extra.instructions as string | null) ?? null,
    deliveryInstructions: (extra.delivery_instructions as string | null) ?? null,
    remarks: (extra.remarks as string | null) ?? null,
    holdReason: (extra.hold_reason as string | null) ?? null,
    arrived: Number(extra.arrived),
    lines: lines.map((l) => ({
      id: Number(l.id),
      key: String(l.stock_key),
      itemCode: (l.item_code as string | null) ?? null,
      description: String(l.description),
      piecesPerCarton: Number(l.pieces_per_carton),
      unitCode: (l.unit_code as string | null) ?? null,
      orderPieces: Number(l.order_pieces),
      required: Number(l.cartons),
      picked: Number(l.picked),
      arrived: Number(l.arrived),
      packed: Number(l.packed),
      locations: locs
        .filter((x) => x.stock_key === l.stock_key)
        .map((x) => ({
          kind: String(x.kind) as PickLocation["kind"],
          place: x.kind === "GALA" ? String(x.gala) : x.kind === "DOCK" ? "At dock (not stored)" : "Put-back shelf",
          floor: (x.floor as string | null) ?? null,
          cartons: Number(x.cartons),
          cartonNos: ((x.nos as unknown[]) ?? []).map(String),
        })),
      suggested: plan.byLine.get(Number(l.id)) ?? [],
    })),
    route: plan.route,
    cartons: cartons.map((c) => ({
      id: Number(c.id),
      cartonNo: String(c.carton_no),
      lineKey: String(c.stock_key ?? ""),
      description: String(c.description ?? ""),
      fromGala: (c.from_gala as string | null) ?? null,
      pickedBy: (c.picked_by as string | null) || null,
      pickedAt: (c.picked_at as string | null) ?? null,
      arrived: Boolean(c.arrived),
      packageId: num(c.package_id),
      packageCode: (c.package_code as string | null) ?? null,
      area: String(c.area),
    })),
    packageList: packages.map((p) => ({
      id: Number(p.id),
      code: String(p.code),
      no: Number(p.package_no),
      kind: String(p.kind),
      status: String(p.status),
      cartons: Number(p.cartons),
      cartonNos: ((p.nos as unknown[]) ?? []).map(String),
      weightKg: num(p.weight_kg),
      lengthCm: num(p.length_cm),
      widthCm: num(p.width_cm),
      heightCm: num(p.height_cm),
      createdBy: (p.created_by as string | null) || null,
      createdAt: String(p.created_at),
      verifiedBy: (p.verified_by as string | null) || null,
      verifiedAt: (p.verified_at as string | null) ?? null,
    })),
    assigneeList: assignees.map((a) => ({ id: Number(a.id), name: a.name })),
    assignable,
    scans: scans.map((s) => ({
      step: String(s.step),
      code: String(s.code),
      result: String(s.result),
      message: (s.message as string | null) ?? null,
      by: (s.by as string | null) || null,
      at: String(s.at),
    })),
    can: {
      assign: can.assign && live,
      pick: can.pick && live && !base.onHold,
      pack: can.pack && live && !base.onHold,
      verify: can.verify && live && !base.onHold,
      hold: can.hold && live,
      manage: can.manage && live,
    },
  };
}

export async function assignableUsers(warehouseId: number): Promise<{ id: number; name: string; roles: string }[]> {
  const rows = await getDb().execute<{ id: number; name: string; roles: string }>(sql`
    select u.id, trim(u.first_name || ' ' || coalesce(u.last_name, '')) as name,
           string_agg(distinct a.role::text, ',') as roles
      from wms.user_role_assignment a join wms.users u on u.id = a.user_id
     where a.revoked_at is null and a.warehouse_id = ${warehouseId}
       and a.role::text in (${sql.join(PICKERS.map((r) => sql`${r}`), sql`, `)})
       and u.deleted_at is null and u.status = 'ACTIVE'
     group by u.id
     order by 2
  `);
  return rows.map((r) => ({ id: Number(r.id), name: r.name, roles: r.roles }));
}

// ── Notifications on each step ────────────────────────────────────

async function tellWork(eventKey: string, noteId: number, actor: Actor, meta: Meta, extra: Record<string, string> = {}, subjectUserId?: number) {
  try {
    const r = (await getDb().execute<Record<string, unknown>>(sql`
      ${WORK_SELECT} where n.id = ${noteId}
    `))[0];
    if (!r) return;
    const n = workRow(r, 0);
    const createdBy = (await getDb().execute<{ created_by: number }>(sql`select created_by from wms.delivery_note where id = ${noteId}`))[0];
    const subject = subjectUserId ?? (Number(createdBy?.created_by ?? 0) || null);
    await announce({
      eventKey,
      values: {
        id: String(noteId),
        dn: n.dnNo,
        buyer: n.buyerName,
        warehouse: n.warehouseName,
        cartons: count(n.required, "carton"),
        packages: count(n.packages, "package"),
        returning: count(n.returning, "carton"),
        what: "",
        why: n.status === "CANCELLED" ? "cancelled" : "rejected",
        reason: "",
        by: who(actor),
        ...extra,
      },
      dedupeSuffix: `dn-work:${noteId}:${eventKey}:${subjectUserId ?? 0}:${Date.now()}`,
      actorUserId: actor.session.userId,
      subjectUserId: subject,
      skipActor: true,
      entityType: "delivery_note",
      entityId: String(noteId),
      importerId: Number(r.importer_id ?? 0) || undefined,
      warehouseId: n.warehouseId,
      correlationId: meta.requestId,
    });
  } catch (error) {
    console.error("[dispatch] notify failed", eventKey, error);
  }
}

async function assigneeIds(noteId: number): Promise<number[]> {
  const rows = await getDb().execute<{ user_id: number }>(sql`
    select user_id from wms.delivery_note_assignee where note_id = ${noteId} and removed_at is null
  `);
  return rows.map((r) => Number(r.user_id));
}

/** After any step: if the work status moved, tell whoever the new step is for. */
export async function afterStep(noteId: number, before: string, actor: Actor, meta: Meta): Promise<string> {
  const now = String((await getDb().execute<{ s: string }>(sql`select wms.dn_work_refresh(${noteId}) as s`))[0]?.s ?? before);
  if (now === before) return now;
  if (now === "PICKED") {
    await tellWork("delivery.picked", noteId, actor, meta);
    for (const u of await assigneeIds(noteId)) {
      await tellWork("delivery.staff", noteId, actor, meta, { what: "all cartons picked — pack them" }, u);
    }
  } else if (now === "PACKAGED") {
    await tellWork("delivery.packed", noteId, actor, meta);
  } else if (now === "READY_FOR_DISPATCH") {
    await tellWork("delivery.ready", noteId, actor, meta);
  } else if (now === "CANCELLED" && before === "RETURNING") {
    await tellWork("delivery.putback_done", noteId, actor, meta);
  }
  return now;
}

// ── Assign and hold ───────────────────────────────────────────────

export async function assign(actor: Actor, id: number, userIds: number[], meta: Meta): Promise<WorkDetail> {
  const n = await visible(actor, id);
  const can = await rights(actor, id, Number(n.warehouse_id));
  if (!can.assign) throw new InwardError("FORBIDDEN", "Only the warehouse admin, package or outward manager assigns staff.");
  if (n.status !== "PENDING" && n.status !== "APPROVED") throw new InwardError("CONFLICT", `This delivery note is ${n.status.toLowerCase()}`);
  const allowed = new Set((await assignableUsers(Number(n.warehouse_id))).map((u) => u.id));
  const wanted = [...new Set(userIds)];
  const bad = wanted.filter((u) => !allowed.has(u));
  if (bad.length) throw new InwardError("VALIDATION_FAILED", "Choose package or storage managers of this warehouse");
  const db = getDb();
  const current = await assigneeIds(id);
  const added = wanted.filter((u) => !current.includes(u));
  const removed = current.filter((u) => !wanted.includes(u));
  if (removed.length) {
    await db.execute(sql`
      update wms.delivery_note_assignee set removed_at = now(), removed_by = ${actor.session.userId}
       where note_id = ${id} and removed_at is null and user_id in (${sql.join(removed.map((u) => sql`${u}`), sql`, `)})
    `);
  }
  for (const u of added) {
    await db.execute(sql`
      insert into wms.delivery_note_assignee (note_id, user_id, assigned_by) values (${id}, ${u}, ${actor.session.userId})
      on conflict do nothing
    `);
  }
  await afterStep(id, String(n.work_status), actor, meta);
  for (const u of added) await tellWork("delivery.assigned", id, actor, meta, {}, u);
  if (added.length && current.length === 0) {
    await tellWork("delivery.progress", id, actor, meta, { what: "warehouse staff assigned" });
  }
  await auditQuietly({
    action: "delivery.work.assigned",
    operation: "UPDATE",
    entityType: "delivery_note",
    entityId: String(id),
    entityLabel: String(n.dn_no),
    before: { assignees: current },
    after: { assignees: wanted },
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: who(actor),
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
  return workDetail(actor, id);
}

export async function setHold(actor: Actor, id: number, on: boolean, reason: string | null, meta: Meta): Promise<WorkDetail> {
  const n = await visible(actor, id);
  const can = await rights(actor, id, Number(n.warehouse_id));
  if (!can.hold) throw new InwardError("FORBIDDEN", "You cannot put this delivery note on hold.");
  const why = reason?.trim().slice(0, 300) || null;
  if (on && !why) throw new InwardError("VALIDATION_FAILED", "Say why it is on hold", { reason: "Say why it is on hold" });
  await getDb().execute(sql`
    update wms.delivery_note
       set on_hold = ${on}, hold_reason = ${on ? why : null}, hold_by = ${on ? actor.session.userId : null},
           hold_at = ${on ? sql`now()` : null}, updated_at = now()
     where id = ${id}
  `);
  const what = on ? "is on hold" : "is back in work";
  await tellWork("delivery.hold", id, actor, meta, { what, reason: why ?? "Work can go on." });
  for (const u of await assigneeIds(id)) {
    await tellWork("delivery.staff", id, actor, meta, { what: on ? `on hold — ${why}` : "work can go on again" }, u);
  }
  return workDetail(actor, id);
}

// ── Scans ─────────────────────────────────────────────────────────

export type ScanInput = { code: string; clientScanId?: string | null; via?: "SCAN" | "MANUAL"; device?: string | null };
export type ScanAnswer = {
  result: "OK" | "DUPLICATE" | "REJECTED";
  message: string;
  workStatus: string;
  /** After a pick scan: where to go next (null when everything is picked). */
  next?: RouteStop | null;
};

async function cartonIdOf(code: string): Promise<number | null> {
  const no = cartonNoFromScan(code);
  if (!no) return null;
  const rows = await getDb().execute<{ id: number }>(sql`select id from wms.inward_carton where carton_no = ${no}`);
  return rows[0] ? Number(rows[0].id) : null;
}

const PACKAGE_CODE = /\bPK-?(\d{6})\b/i;

/** A package label (PK-000123), or for a single carton its own sticker. */
async function packageIdOf(code: string): Promise<number | null> {
  const m = PACKAGE_CODE.exec(code);
  if (m) {
    const rows = await getDb().execute<{ id: number }>(sql`select id from wms.delivery_package where code = ${`PK-${m[1]}`}`);
    return rows[0] ? Number(rows[0].id) : null;
  }
  const carton = await cartonIdOf(code);
  if (!carton) return null;
  const rows = await getDb().execute<{ id: number }>(sql`
    select p.id from wms.inward_carton c join wms.delivery_package p on p.id = c.package_id
     where c.id = ${carton} and p.kind = 'SINGLE' and p.status <> 'CANCELLED'
  `);
  return rows[0] ? Number(rows[0].id) : null;
}

export async function scan(actor: Actor, id: number, step: "PICK" | "ARRIVE" | "VERIFY", input: ScanInput, meta: Meta): Promise<ScanAnswer> {
  const n = await visible(actor, id);
  const can = await rights(actor, id, Number(n.warehouse_id));
  if (step === "VERIFY" ? !can.verify : !can.pick) {
    throw new InwardError("FORBIDDEN", step === "VERIFY" ? "Verifying is for the warehouse admin, package or outward manager." : "This delivery note is not assigned to you.");
  }
  const code = input.code.trim().slice(0, 500);
  const via = input.via === "MANUAL" ? "MANUAL" : "SCAN";
  const client = input.clientScanId?.slice(0, 80) ?? null;
  const device = input.device?.slice(0, 120) ?? meta.userAgent?.slice(0, 120) ?? null;
  const target = step === "VERIFY" ? await packageIdOf(code) : await cartonIdOf(code);
  // A carton on the put-back shelf of a rejected / cancelled note may be
  // picked for this one: remember that note, it may now be fully cleared.
  const shelf =
    step === "PICK" && target
      ? (await getDb().execute<{ dn_id: number; work_status: string }>(sql`
          select c.dn_id, d.work_status from wms.inward_carton c join wms.delivery_note d on d.id = c.dn_id
           where c.id = ${target} and c.area = 'RETURN' and c.dn_id <> ${id}
        `))[0]
      : undefined;
  const fn = step === "PICK" ? sql`wms.dn_pick` : step === "ARRIVE" ? sql`wms.dn_arrive` : sql`wms.dn_verify`;
  const r = (await getDb().execute<{ r: { result: ScanAnswer["result"]; message: string } }>(sql`
    select ${fn}(${id}, ${target}::bigint, ${code}, ${actor.session.userId}, ${via}, ${client}, ${device}) as r
  `))[0]!.r;
  const workStatus = await afterStep(id, String(n.work_status), actor, meta);
  // Its last returned carton just left the shelf: the old note is done — tell the admins.
  if (shelf && r.result === "OK") await afterStep(Number(shelf.dn_id), String(shelf.work_status), actor, meta);
  if (step !== "PICK") return { result: r.result, message: r.message, workStatus };
  // Picking: say where to go next — and after a wrong carton, where the right ones are.
  const next = (await pickPlan(id)).route[0] ?? null;
  const message =
    r.result === "REJECTED" && next && /^(Not on this delivery note|All \d+ cartons of)/.test(r.message)
      ? `${r.message}. This note needs ${next.items[0]!.item} — ${
          next.kind === "GALA" ? `in ${next.place}${next.floor ? ` (${next.floor})` : ""}` : next.kind === "DOCK" ? "at the dock (not stored yet)" : "on the put-back shelf"
        }`
      : r.message;
  return { result: r.result, message, workStatus, next };
}

// ── Packages ──────────────────────────────────────────────────────

async function packageRow(pid: number) {
  const rows = await getDb().execute<{ id: number; note_id: number; status: string; code: string; kind: string }>(sql`
    select id, note_id, status, code, kind from wms.delivery_package where id = ${pid}
  `);
  const p = rows[0];
  if (!p) throw new InwardError("NOT_FOUND", "No such package");
  return p;
}

export type PackageInput = { kind?: "PACKAGE" | "BUNDLE"; weightKg?: number | null; lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null };

export async function createPackage(actor: Actor, id: number, input: PackageInput, meta: Meta): Promise<WorkDetail> {
  const n = await visible(actor, id);
  const can = await rights(actor, id, Number(n.warehouse_id));
  if (!can.pack || (n.status !== "PENDING" && n.status !== "APPROVED") || n.on_hold) {
    throw new InwardError("FORBIDDEN", n.on_hold ? "On hold — packing is paused" : "You cannot pack this delivery note.");
  }
  await getDb().execute(sql`
    insert into wms.delivery_package (note_id, package_no, kind, weight_kg, length_cm, width_cm, height_cm, created_by)
    select ${id}, coalesce(max(package_no), 0) + 1, ${input.kind === "BUNDLE" ? "BUNDLE" : "PACKAGE"},
           ${input.weightKg ?? null}, ${input.lengthCm ?? null}, ${input.widthCm ?? null}, ${input.heightCm ?? null}, ${actor.session.userId}
      from wms.delivery_package where note_id = ${id}
  `);
  await afterStep(id, String(n.work_status), actor, meta);
  return workDetail(actor, id);
}

/** Scan a carton into (or, with remove, out of) an open package. */
export async function packScan(actor: Actor, pid: number, input: ScanInput & { remove?: boolean }, meta: Meta): Promise<ScanAnswer> {
  const p = await packageRow(pid);
  const n = await visible(actor, Number(p.note_id));
  const can = await rights(actor, Number(p.note_id), Number(n.warehouse_id));
  if (!can.pack) throw new InwardError("FORBIDDEN", "This delivery note is not assigned to you.");
  if (n.on_hold) throw new InwardError("CONFLICT", "On hold — packing is paused");
  const code = input.code.trim().slice(0, 500);
  const r = (await getDb().execute<{ r: { result: ScanAnswer["result"]; message: string } }>(sql`
    select wms.dn_pack(${pid}, ${await cartonIdOf(code)}::bigint, ${code}, ${actor.session.userId},
                       ${input.via === "MANUAL" ? "MANUAL" : "SCAN"}, ${input.clientScanId?.slice(0, 80) ?? null},
                       ${input.device?.slice(0, 120) ?? meta.userAgent?.slice(0, 120) ?? null}, ${Boolean(input.remove)}) as r
  `))[0]!.r;
  const workStatus = await afterStep(Number(p.note_id), String(n.work_status), actor, meta);
  return { result: r.result, message: r.message, workStatus };
}

export async function packageAction(
  actor: Actor,
  pid: number,
  action: "CLOSE" | "REOPEN" | "CANCEL" | "UPDATE" | "PRINTED",
  input: PackageInput & { reason?: string | null },
  meta: Meta,
): Promise<WorkDetail> {
  const p = await packageRow(pid);
  const noteId = Number(p.note_id);
  const n = await visible(actor, noteId);
  const can = await rights(actor, noteId, Number(n.warehouse_id));
  const db = getDb();
  if (action === "PRINTED") {
    await db.execute(sql`update wms.delivery_package set print_count = print_count + 1 where id = ${pid}`);
    return workDetail(actor, noteId);
  }
  if (action === "REOPEN" || action === "CANCEL") {
    if (!can.manage) throw new InwardError("FORBIDDEN", "Only the warehouse admin reopens or cancels a package.");
    if (p.status === "CANCELLED") throw new InwardError("CONFLICT", `${p.code} is already cancelled`);
    if (action === "REOPEN") {
      if (p.kind === "SINGLE") throw new InwardError("CONFLICT", "A single carton is not reopened — cancel it instead");
      await db.execute(sql`
        update wms.delivery_package set status = 'OPEN', reopened_by = ${actor.session.userId}, reopened_at = now(),
               verified_by = null, verified_at = null, closed_by = null, closed_at = null
         where id = ${pid}
      `);
    } else {
      const why = input.reason?.trim().slice(0, 300) || null;
      if (!why) throw new InwardError("VALIDATION_FAILED", "Say why it is cancelled", { reason: "Say why it is cancelled" });
      await db.execute(sql`
        with p as (
          update wms.delivery_package set status = 'CANCELLED', cancelled_by = ${actor.session.userId}, cancelled_at = now(),
                 cancel_reason = ${why}
           where id = ${pid} returning id
        )
        update wms.inward_carton set package_id = null, updated_at = now() where package_id in (select id from p)
      `);
    }
  } else {
    if (!can.pack) throw new InwardError("FORBIDDEN", "This delivery note is not assigned to you.");
    if (p.status !== "OPEN") throw new InwardError("CONFLICT", `${p.code} is ${p.status.toLowerCase()} — reopen it to change it`);
    if (action === "CLOSE") {
      const inIt = Number((await db.execute<{ n: number }>(sql`select count(*)::int as n from wms.inward_carton where package_id = ${pid}`))[0]?.n ?? 0);
      if (inIt === 0) throw new InwardError("VALIDATION_FAILED", "Scan at least one carton into the package first");
    }
    await db.execute(sql`
      update wms.delivery_package
         set weight_kg = ${input.weightKg === undefined ? sql`weight_kg` : input.weightKg},
             length_cm = ${input.lengthCm === undefined ? sql`length_cm` : input.lengthCm},
             width_cm = ${input.widthCm === undefined ? sql`width_cm` : input.widthCm},
             height_cm = ${input.heightCm === undefined ? sql`height_cm` : input.heightCm},
             kind = ${input.kind ?? sql`kind`},
             status = ${action === "CLOSE" ? "CLOSED" : sql`status`},
             closed_by = ${action === "CLOSE" ? actor.session.userId : sql`closed_by`},
             closed_at = ${action === "CLOSE" ? sql`now()` : sql`closed_at`}
       where id = ${pid}
    `);
  }
  await afterStep(noteId, String(n.work_status), actor, meta);
  if (action === "CANCEL" || action === "REOPEN") {
    await auditQuietly({
      action: `delivery.package.${action.toLowerCase()}`,
      operation: "UPDATE",
      entityType: "delivery_package",
      entityId: String(pid),
      entityLabel: p.code,
      after: { reason: input.reason ?? null },
      actorUserId: actor.session.userId,
      actorEmail: actor.session.email,
      actorName: who(actor),
      ip: meta.ip,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    });
  }
  return workDetail(actor, noteId);
}

/** Every picked carton not in a package goes as a single carton (its own sticker is its label). */
export async function packSingles(actor: Actor, id: number, meta: Meta): Promise<WorkDetail> {
  const n = await visible(actor, id);
  const can = await rights(actor, id, Number(n.warehouse_id));
  if (!can.pack || n.on_hold) throw new InwardError("FORBIDDEN", "You cannot pack this delivery note.");
  const db = getDb();
  const loose = await db.execute<{ id: number }>(sql`
    select c.id from wms.inward_carton c left join wms.delivery_package p on p.id = c.package_id
     where c.dn_id = ${id} and c.area = 'PACKING' and (c.package_id is null or p.status = 'CANCELLED')
     order by c.carton_no
  `);
  if (loose.length === 0) throw new InwardError("CONFLICT", "Every picked carton is already in a package");
  for (const c of loose) {
    await db.execute(sql`
      with p as (
        insert into wms.delivery_package (note_id, package_no, kind, status, created_by, closed_by, closed_at)
        select ${id}, coalesce(max(package_no), 0) + 1, 'SINGLE', 'CLOSED', ${actor.session.userId}, ${actor.session.userId}, now()
          from wms.delivery_package where note_id = ${id}
        returning id
      )
      update wms.inward_carton set package_id = (select id from p), arrived_at = coalesce(arrived_at, now()),
             arrived_by = coalesce(arrived_by, ${actor.session.userId}), updated_at = now()
       where id = ${Number(c.id)}
    `);
  }
  await afterStep(id, String(n.work_status), actor, meta);
  return workDetail(actor, id);
}

// ── Rejected / cancelled notes ────────────────────────────────────

/** Picked cartons of a closed note go to "put back"; tell storage. Returns how many. */
export async function releaseNote(actor: Actor, noteId: number, reason: string, meta: Meta): Promise<number> {
  const r = await getDb().execute<{ n: number }>(sql`select wms.dn_release(${noteId}, ${actor.session.userId}, ${reason}) as n`);
  const back = Number(r[0]?.n ?? 0);
  if (back > 0) await tellWork("delivery.putback", noteId, actor, meta, { returning: count(back, "carton") });
  return back;
}

/** The note's work after an approval: verified and now approved → ready. */
export async function refreshAfterApproval(actor: Actor, noteId: number, meta: Meta): Promise<void> {
  const n = await noteRow(noteId);
  if (n) await afterStep(noteId, String(n.work_status), actor, meta);
}

/** Has picking started? (Items are then locked.) */
export async function pickingStarted(noteId: number): Promise<boolean> {
  const rows = await getDb().execute<{ n: number }>(sql`
    select count(*)::int as n from wms.inward_carton where dn_id = ${noteId} and area = 'PACKING'
  `);
  return Number(rows[0]?.n ?? 0) > 0;
}

/** For the delivery note page: the warehouse progress in one line. */
export async function progressOf(
  noteId: number,
): Promise<{ workStatus: string; onHold: boolean; workLabel: string; required: number; picked: number; packed: number; packages: number; returning: number } | null> {
  const r = (await getDb().execute<Record<string, unknown>>(sql`${WORK_SELECT} where n.id = ${noteId}`))[0];
  if (!r) return null;
  const w = workRow(r, 0);
  // workStatus is the stored step (never ON_HOLD) so callers can compare it after a change.
  return { workStatus: String(r.work_status), onHold: w.onHold, workLabel: w.workLabel, required: w.required, picked: w.picked, packed: w.packed, packages: w.packages, returning: w.returning };
}

/** Grants that open the work screens (nav and pages). */
export function canSeeWork(actor: Actor): boolean {
  const g = grantFor(actor, "package.read");
  return g !== null && g.scope !== "OWN";
}
