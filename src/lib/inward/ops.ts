import "server-only";

import { randomBytes } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db";
import { auditQuietly } from "@/lib/audit";
import { importerIdOf, type Actor, type Grant } from "@/lib/auth/guard";
import { announce } from "@/lib/notify/announce";
import { configured, deleteObject, publicUrl, putObject } from "@/lib/storage/bunny";
import { actorWarehouseIds } from "@/lib/users/authority";
import type { InwardSaveInput, ItemSaveInput, ProposeInput } from "@/lib/validation/api-inward";

/**
 * Inward requests — the importer telling the warehouse what is coming.
 *
 * Two sides, two scopes, one table:
 *
 *   importer side   IMPORTER / SALES_AGENT, grant at OWN — their company's
 *                   requests. They create, edit while it is theirs, submit,
 *                   cancel.
 *   warehouse side  INWARD_MANAGER / WAREHOUSE_ADMIN, grant at WAREHOUSE —
 *                   requests addressed to their sites. They acknowledge,
 *                   send back, progress, complete.
 *   platform        SUPER_ADMIN at ALL — both.
 *
 * Nothing here trusts an importer id or a warehouse id from a body as
 * an authorisation: the importer id comes from the actor's role binding
 * and the warehouse id is checked against the actor's own assignments.
 *
 * The state machine lives in `TRANSITIONS` and nowhere else. Each route
 * asks `can()` the same question the detail payload answers, so a
 * button the app shows is a request the server will accept.
 */

export type Meta = { requestId: string; ip: string | null; userAgent: string | null };

export class InwardError extends Error {
  constructor(
    readonly kind: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION_FAILED" | "CONFLICT" | "INTERNAL",
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "InwardError";
  }
}

export type InwardStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "NEEDS_CHANGES"
  | "ACKNOWLEDGED"
  | "IN_PROCESS"
  | "COMPLETED"
  | "CANCELLED";

export const STATUS_LABEL: Record<InwardStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  NEEDS_CHANGES: "Needs changes",
  ACKNOWLEDGED: "Acknowledged",
  IN_PROCESS: "In process",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** Which statuses count as "open" on a list filter. */
export const OPEN_STATUSES: InwardStatus[] = ["DRAFT", "SUBMITTED", "NEEDS_CHANGES", "ACKNOWLEDGED", "IN_PROCESS"];

// ── Scope ─────────────────────────────────────────────────────────

export type InwardScope =
  | { side: "all"; importerId: number | null; warehouseId: number | null }
  | { side: "importer"; importerId: number }
  | { side: "warehouse"; warehouseIds: number[] };

/**
 * What the caller may see, from the grant and the actor — never from
 * the request. `requested` narrows an ALL grant only.
 */
export function scopeFor(
  actor: Actor,
  grant: Grant,
  requested: { importerId?: number | null; warehouseId?: number | null } = {},
): InwardScope {
  if (grant.scope === "ALL") {
    return {
      side: "all",
      importerId: requested.importerId ?? null,
      warehouseId: requested.warehouseId ?? null,
    };
  }
  if (grant.scope === "WAREHOUSE") {
    return { side: "warehouse", warehouseIds: actorWarehouseIds(actor) };
  }
  const importerId = importerIdOf(actor);
  if (importerId === null) {
    throw new InwardError("FORBIDDEN", "You are not linked to an importer");
  }
  return { side: "importer", importerId };
}

function scopeWhere(scope: InwardScope): SQL {
  switch (scope.side) {
    case "importer":
      return sql`r.importer_id = ${scope.importerId}`;
    case "warehouse":
      if (scope.warehouseIds.length === 0) return sql`false`;
      return sql`r.warehouse_id in (${sql.join(
        scope.warehouseIds.map((w) => sql`${w}`),
        sql`, `,
      )})`;
    case "all": {
      const parts: SQL[] = [sql`true`];
      if (scope.importerId !== null) parts.push(sql`r.importer_id = ${scope.importerId}`);
      if (scope.warehouseId !== null) parts.push(sql`r.warehouse_id = ${scope.warehouseId}`);
      return sql.join(parts, sql` and `);
    }
  }
}

// ── The state machine ─────────────────────────────────────────────

export type InwardAction =
  | "EDIT"
  | "SUBMIT"
  | "CANCEL"
  | "ACKNOWLEDGE"
  | "NEEDS_CHANGES"
  | "IN_PROCESS"
  | "COMPLETE";

/** From which statuses each action is allowed, and by which side. */
const TRANSITIONS: Record<InwardAction, { from: InwardStatus[]; side: "importer" | "warehouse" }> = {
  EDIT: { from: ["DRAFT", "NEEDS_CHANGES"], side: "importer" },
  SUBMIT: { from: ["DRAFT", "NEEDS_CHANGES"], side: "importer" },
  CANCEL: { from: ["DRAFT", "SUBMITTED", "NEEDS_CHANGES"], side: "importer" },
  ACKNOWLEDGE: { from: ["SUBMITTED"], side: "warehouse" },
  NEEDS_CHANGES: { from: ["SUBMITTED", "ACKNOWLEDGED"], side: "warehouse" },
  IN_PROCESS: { from: ["ACKNOWLEDGED"], side: "warehouse" },
  COMPLETE: { from: ["ACKNOWLEDGED", "IN_PROCESS"], side: "warehouse" },
};

export type Can = Record<Lowercase<InwardAction>, boolean>;

/**
 * Whether this actor may do this to this row — status AND standing.
 *
 * The importer side is anyone with `inward.request.update` (or
 * `.delete` for cancel) whose scope covers the row's importer; the
 * warehouse side is `inward.request.approve` covering the row's
 * warehouse. ALL covers both sides.
 */
export function canDo(actor: Actor, row: { status: InwardStatus; importerId: number; warehouseId: number }): Can {
  const covers = (permission: string, side: "importer" | "warehouse"): boolean => {
    const grant = actor.permissions.find((p) => p.permission === permission);
    if (!grant) return false;
    if (grant.scope === "ALL") return true;
    if (side === "importer") {
      return grant.scope === "OWN" && importerIdOf(actor) === row.importerId;
    }
    return grant.scope === "WAREHOUSE" && grant.warehouseIds.includes(row.warehouseId);
  };
  const allowed = (action: InwardAction, permission: string): boolean => {
    const t = TRANSITIONS[action];
    return t.from.includes(row.status) && covers(permission, t.side);
  };
  return {
    edit: allowed("EDIT", "inward.request.update"),
    submit: allowed("SUBMIT", "inward.request.update"),
    cancel: allowed("CANCEL", "inward.request.delete"),
    acknowledge: allowed("ACKNOWLEDGE", "inward.request.approve"),
    needs_changes: allowed("NEEDS_CHANGES", "inward.request.approve"),
    in_process: allowed("IN_PROCESS", "inward.request.approve"),
    complete: allowed("COMPLETE", "inward.request.approve"),
  };
}

// ── Shapes ────────────────────────────────────────────────────────

type HeaderRow = {
  id: number;
  code: string;
  status: InwardStatus;
  importer_id: number;
  importer_code: string;
  importer_name: string;
  warehouse_id: number;
  warehouse_code: string;
  warehouse_name: string;
  container_number: string | null;
  container_type_id: number | null;
  container_type_code: string | null;
  container_type_name: string | null;
  port_id: number | null;
  port_code: string | null;
  port_name: string | null;
  expected_arrival: string | null;
  remarks: string | null;
  transporter_id: number | null;
  transporter_name: string | null;
  transporter_mobile: string | null;
  transporter_status: string | null;
  vehicle_id: number | null;
  vehicle_registration: string | null;
  vehicle_type_name: string | null;
  vehicle_capacity_kg: string | null;
  driver_id: number | null;
  driver_name: string | null;
  driver_mobile: string | null;
  driver_licence: string | null;
  needs_changes_note: string | null;
  submitted_at: string | null;
  submitted_by_name: string | null;
  acknowledged_at: string | null;
  acknowledged_by_name: string | null;
  completed_at: string | null;
  completed_by_name: string | null;
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  last_status_at: string | null;
  created_at: string;
  created_by_name: string | null;
  updated_at: string;
  cartons: string;
  pieces: string;
  kg: string;
  lines: string;
  documents: string;
};

const HEADER_SELECT = sql`
  select r.id, r.code, r.status, r.importer_id, i.code as importer_code, i.company_name as importer_name,
         r.warehouse_id, w.code as warehouse_code, w.name as warehouse_name,
         r.container_number, r.container_type_id, ct.code as container_type_code, ct.name as container_type_name,
         r.port_id, p.code as port_code, p.name as port_name,
         to_char(r.expected_arrival, 'YYYY-MM-DD') as expected_arrival, r.remarks,
         r.transporter_id, t.name as transporter_name, t.contact_mobile::text as transporter_mobile,
         t.status::text as transporter_status,
         r.vehicle_id, v.registration_number::text as vehicle_registration, vt.name as vehicle_type_name,
         v.capacity_kg::text as vehicle_capacity_kg,
         r.driver_id, d.name as driver_name, d.mobile::text as driver_mobile, d.licence_number as driver_licence,
         r.needs_changes_note,
         r.submitted_at::text, trim(su.first_name || ' ' || coalesce(su.last_name, '')) as submitted_by_name,
         r.acknowledged_at::text, trim(au.first_name || ' ' || coalesce(au.last_name, '')) as acknowledged_by_name,
         r.completed_at::text, trim(cu.first_name || ' ' || coalesce(cu.last_name, '')) as completed_by_name,
         r.cancelled_at::text, trim(xu.first_name || ' ' || coalesce(xu.last_name, '')) as cancelled_by_name,
         r.last_status_at::text,
         r.created_at::text, trim(cr.first_name || ' ' || coalesce(cr.last_name, '')) as created_by_name,
         r.updated_at::text,
         coalesce(agg.cartons, 0)::text as cartons, coalesce(agg.pieces, 0)::text as pieces,
         coalesce(agg.kg, 0)::text as kg, coalesce(agg.lines, 0)::text as lines,
         (select count(*) from wms.inward_request_document dd where dd.inward_request_id = r.id)::text as documents
    from wms.inward_request r
    join wms.importer i on i.id = r.importer_id
    join wms.warehouse w on w.id = r.warehouse_id
    left join wms.container_type ct on ct.id = r.container_type_id
    left join wms.port p on p.id = r.port_id
    left join wms.transporter t on t.id = r.transporter_id
    left join wms.vehicle v on v.id = r.vehicle_id
    left join wms.vehicle_type vt on vt.id = v.vehicle_type_id
    left join wms.driver d on d.id = r.driver_id
    left join wms.users su on su.id = r.submitted_by
    left join wms.users au on au.id = r.acknowledged_by
    left join wms.users cu on cu.id = r.completed_by
    left join wms.users xu on xu.id = r.cancelled_by
    left join wms.users cr on cr.id = r.created_by
    left join lateral (
      select sum(li.carton_qty) as cartons, sum(li.total_pieces) as pieces,
             sum(li.total_kg) as kg, count(*) as lines
        from wms.inward_request_item li where li.inward_request_id = r.id
    ) agg on true
`;

function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export type InwardSummary = ReturnType<typeof toSummary>;

function toSummary(r: HeaderRow) {
  return {
    id: Number(r.id),
    code: r.code,
    status: r.status,
    statusLabel: STATUS_LABEL[r.status],
    importer: { id: Number(r.importer_id), code: r.importer_code, name: r.importer_name },
    warehouse: { id: Number(r.warehouse_id), code: r.warehouse_code, name: r.warehouse_name },
    containerNumber: r.container_number,
    containerType:
      r.container_type_id === null
        ? null
        : { id: Number(r.container_type_id), code: r.container_type_code ?? "", name: r.container_type_name ?? "" },
    port: r.port_id === null ? null : { id: Number(r.port_id), code: r.port_code ?? "", name: r.port_name ?? "" },
    expectedArrival: r.expected_arrival,
    remarks: r.remarks,
    transporter:
      r.transporter_id === null
        ? null
        : {
            id: Number(r.transporter_id),
            name: r.transporter_name ?? "",
            mobile: r.transporter_mobile,
            status: r.transporter_status,
          },
    vehicle:
      r.vehicle_id === null
        ? null
        : {
            id: Number(r.vehicle_id),
            registrationNumber: r.vehicle_registration ?? "",
            typeName: r.vehicle_type_name,
            capacityKg: r.vehicle_capacity_kg === null ? null : num(r.vehicle_capacity_kg),
          },
    driver:
      r.driver_id === null
        ? null
        : {
            id: Number(r.driver_id),
            name: r.driver_name ?? "",
            mobile: r.driver_mobile,
            licenceNumber: r.driver_licence,
          },
    totals: { cartons: num(r.cartons), pieces: num(r.pieces), kg: num(r.kg), lines: num(r.lines) },
    documents: num(r.documents),
    needsChangesNote: r.needs_changes_note,
    submittedAt: r.submitted_at,
    acknowledgedAt: r.acknowledged_at,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
    lastStatusAt: r.last_status_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export type InwardLine = {
  id: number;
  itemId: number | null;
  itemCode: string | null;
  description: string;
  imageUrl: string | null;
  cartonQty: number;
  piecesPerCarton: number;
  unitId: number | null;
  unitCode: string | null;
  kgPerCarton: number;
  totalPieces: number;
  totalKg: number;
};

export type InwardDocument = {
  id: number;
  url: string;
  contentType: string;
  bytes: number;
  originalName: string | null;
  createdAt: string;
};

async function linesOf(requestId: number): Promise<InwardLine[]> {
  const rows = await getDb().execute<Record<string, string | null>>(sql`
    select id, item_id, item_code, description, image_url, carton_qty, pieces_per_carton,
           measurement_unit_id, unit_code, kg_per_carton::text as kg_per_carton,
           total_pieces, total_kg::text as total_kg
      from wms.inward_request_item
     where inward_request_id = ${requestId}
     order by sort_order, id
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    itemId: r.item_id === null ? null : Number(r.item_id),
    itemCode: r.item_code,
    description: r.description ?? "",
    imageUrl: r.image_url,
    cartonQty: num(r.carton_qty),
    piecesPerCarton: num(r.pieces_per_carton),
    unitId: r.measurement_unit_id === null ? null : Number(r.measurement_unit_id),
    unitCode: r.unit_code,
    kgPerCarton: num(r.kg_per_carton),
    totalPieces: num(r.total_pieces),
    totalKg: num(r.total_kg),
  }));
}

async function documentsOf(requestId: number): Promise<InwardDocument[]> {
  const rows = await getDb().execute<Record<string, string | null>>(sql`
    select id, url, content_type, bytes, original_name, created_at::text as created_at
      from wms.inward_request_document
     where inward_request_id = ${requestId}
     order by id
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    url: r.url ?? "",
    contentType: r.content_type ?? "",
    bytes: num(r.bytes),
    originalName: r.original_name,
    createdAt: r.created_at ?? "",
  }));
}

// ── Reads ─────────────────────────────────────────────────────────

export type ListFilter = {
  status?: InwardStatus | "OPEN";
  q?: string;
  limit: number;
  offset: number;
};

export async function listRequests(scope: InwardScope, filter: ListFilter) {
  const where: SQL[] = [sql`r.deleted_at is null`, scopeWhere(scope)];
  if (filter.status === "OPEN") {
    where.push(sql`r.status in (${sql.join(OPEN_STATUSES.map((s) => sql`${s}`), sql`, `)})`);
  } else if (filter.status) {
    where.push(sql`r.status = ${filter.status}`);
  }
  // The dock side never needs to see somebody's half-typed draft.
  if (scope.side === "warehouse") where.push(sql`r.status <> 'DRAFT'`);
  if (filter.q) {
    const like = `%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(
      sql`(r.code ilike ${like} or r.container_number ilike ${like} or i.company_name ilike ${like} or w.name ilike ${like})`,
    );
  }
  const rows = await getDb().execute<HeaderRow>(sql`
    ${HEADER_SELECT}
    where ${sql.join(where, sql` and `)}
    order by case r.status when 'SUBMITTED' then 0 when 'NEEDS_CHANGES' then 1 when 'DRAFT' then 2
                           when 'ACKNOWLEDGED' then 3 when 'IN_PROCESS' then 4 else 9 end,
             coalesce(r.expected_arrival, date '2999-12-31'), r.updated_at desc
    limit ${filter.limit} offset ${filter.offset}
  `);
  return rows.map(toSummary);
}

async function headerOf(id: number): Promise<HeaderRow | null> {
  const rows = await getDb().execute<HeaderRow>(sql`
    ${HEADER_SELECT}
    where r.id = ${id} and r.deleted_at is null
  `);
  return rows[0] ?? null;
}

/** The row, or NOT_FOUND. A row outside the scope is also NOT_FOUND —
 *  "exists but not yours" is a map of other people's business. */
async function visibleHeader(scope: InwardScope, id: number): Promise<HeaderRow> {
  const row = await headerOf(id);
  if (!row) throw new InwardError("NOT_FOUND", "No such inward request");
  const inScope =
    scope.side === "all"
      ? (scope.importerId === null || scope.importerId === Number(row.importer_id)) &&
        (scope.warehouseId === null || scope.warehouseId === Number(row.warehouse_id))
      : scope.side === "importer"
        ? Number(row.importer_id) === scope.importerId
        : scope.warehouseIds.includes(Number(row.warehouse_id)) && row.status !== "DRAFT";
  if (!inScope) throw new InwardError("NOT_FOUND", "No such inward request");
  return row;
}

export async function getRequest(actor: Actor, scope: InwardScope, id: number) {
  const row = await visibleHeader(scope, id);
  const [items, documents] = await Promise.all([linesOf(id), documentsOf(id)]);
  const summary = toSummary(row);
  return {
    ...summary,
    items,
    documents,
    people: {
      createdBy: row.created_by_name,
      submittedBy: row.submitted_by_name,
      acknowledgedBy: row.acknowledged_by_name,
      completedBy: row.completed_by_name,
      cancelledBy: row.cancelled_by_name,
    },
    can: canDo(actor, {
      status: row.status,
      importerId: Number(row.importer_id),
      warehouseId: Number(row.warehouse_id),
    }),
  };
}

// ── Lookups: everything the form needs, in one call ───────────────

export async function lookupsFor(importerId: number) {
  const db = getDb();
  const [warehouses, containerTypes, ports, units, transporters, vehicles, drivers, items, last] =
    await Promise.all([
      db.execute<Record<string, string>>(sql`
        select w.id, w.code, w.name, c.name as city
          from wms.warehouse w left join wms.city c on c.id = w.city_id
         where w.deleted_at is null and w.is_active
         order by w.name
      `),
      db.execute<Record<string, string>>(sql`
        select id, code, name, is_high_cube from wms.container_type
         where deleted_at is null and is_active order by sort_order, name
      `),
      db.execute<Record<string, string>>(sql`
        select p.id, p.code, p.name, s.name as state from wms.port p
          left join wms.state s on s.id = p.state_id
         where p.deleted_at is null and p.is_active order by p.sort_order, p.name
      `),
      db.execute<Record<string, string>>(sql`
        select id, code, name from wms.measurement_unit
         where deleted_at is null and is_active order by sort_order, name
      `),
      // The register, plus whatever this importer proposed that is
      // still waiting. Nobody else's pending rows.
      db.execute<Record<string, string | null>>(sql`
        select t.id, t.code, t.name, t.contact_mobile::text as mobile, t.status::text as status,
               t.proposed_by_importer_id,
               coalesce((select array_agg(wt.warehouse_id) from wms.warehouse_transporter wt
                          where wt.transporter_id = t.id and wt.deleted_at is null), '{}')::text as warehouse_ids
          from wms.transporter t
         where t.deleted_at is null and not t.blacklisted
           and (t.status = 'ACTIVE' or (t.status = 'PENDING' and t.proposed_by_importer_id = ${importerId}))
         order by t.name
      `),
      db.execute<Record<string, string | null>>(sql`
        select v.id, v.transporter_id, v.registration_number::text as registration_number,
               vt.name as type_name, v.capacity_kg::text as capacity_kg, v.status::text as status,
               v.proposed_by_importer_id
          from wms.vehicle v join wms.vehicle_type vt on vt.id = v.vehicle_type_id
         where v.deleted_at is null
           and (v.status = 'ACTIVE' or (v.status = 'PENDING' and v.proposed_by_importer_id = ${importerId}))
         order by v.registration_number
      `),
      db.execute<Record<string, string | null>>(sql`
        select d.id, d.transporter_id, d.name, d.mobile::text as mobile, d.licence_number,
               d.status::text as status, d.proposed_by_importer_id
          from wms.driver d
         where d.deleted_at is null
           and (d.status = 'ACTIVE' or (d.status = 'PENDING' and d.proposed_by_importer_id = ${importerId}))
         order by d.name
      `),
      db.execute<Record<string, string | null>>(sql`
        select it.id, it.code, it.description, it.image_url, it.measurement_unit_id, mu.code as unit_code,
               it.pieces_per_carton, it.kg_per_carton::text as kg_per_carton, it.hsn_code, it.is_active
          from wms.item it left join wms.measurement_unit mu on mu.id = it.measurement_unit_id
         where it.importer_id = ${importerId} and it.deleted_at is null and it.is_active
         order by it.description
      `),
      db.execute<Record<string, string | null>>(sql`
        select warehouse_id, container_type_id, port_id, transporter_id, vehicle_id, driver_id
          from wms.inward_request
         where importer_id = ${importerId} and deleted_at is null and status <> 'CANCELLED'
         order by coalesce(submitted_at, created_at) desc
         limit 1
      `),
    ]);

  const vehicleTypes = await db.execute<Record<string, string>>(sql`
    select id, code, name from wms.vehicle_type where deleted_at is null and is_active order by name
  `);

  const idOr = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
  type Loose = Record<string, string | null>;
  const byTransporter = (rows: Loose[]): Map<number, Loose[]> => {
    const map = new Map<number, Loose[]>();
    for (const r of rows) {
      const k = Number(r.transporter_id);
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return map;
  };
  const vByT = byTransporter([...vehicles]);
  const dByT = byTransporter([...drivers]);

  return {
    warehouses: warehouses.map((w) => ({ id: Number(w.id), code: w.code, name: w.name, city: w.city ?? null })),
    containerTypes: containerTypes.map((c) => ({
      id: Number(c.id),
      code: c.code,
      name: c.name,
      isHighCube: Boolean(c.is_high_cube),
    })),
    ports: ports.map((p) => ({ id: Number(p.id), code: p.code, name: p.name, state: p.state ?? null })),
    units: units.map((u) => ({ id: Number(u.id), code: u.code, name: u.name })),
    vehicleTypes: vehicleTypes.map((v) => ({ id: Number(v.id), code: v.code, name: v.name })),
    transporters: transporters.map((t) => ({
      id: Number(t.id),
      code: t.code,
      name: t.name,
      mobile: t.mobile,
      status: t.status,
      pending: t.status === "PENDING",
      warehouseIds: (t.warehouse_ids ?? "{}")
        .replace(/[{}]/g, "")
        .split(",")
        .filter(Boolean)
        .map(Number),
      vehicles: (vByT.get(Number(t.id)) ?? []).map((v) => ({
        id: Number(v.id),
        registrationNumber: v.registration_number ?? "",
        typeName: v.type_name,
        capacityKg: v.capacity_kg === null ? null : Number(v.capacity_kg),
        pending: v.status === "PENDING",
      })),
      drivers: (dByT.get(Number(t.id)) ?? []).map((d) => ({
        id: Number(d.id),
        name: d.name ?? "",
        mobile: d.mobile,
        licenceNumber: d.licence_number,
        pending: d.status === "PENDING",
      })),
    })),
    items: items.map((it) => ({
      id: Number(it.id),
      code: it.code ?? "",
      description: it.description ?? "",
      imageUrl: it.image_url,
      unitId: idOr(it.measurement_unit_id),
      unitCode: it.unit_code,
      piecesPerCarton: it.pieces_per_carton === null ? null : Number(it.pieces_per_carton),
      kgPerCarton: it.kg_per_carton === null ? null : Number(it.kg_per_carton),
      hsnCode: it.hsn_code,
    })),
    last:
      last[0] === undefined
        ? null
        : {
            warehouseId: idOr(last[0].warehouse_id),
            containerTypeId: idOr(last[0].container_type_id),
            portId: idOr(last[0].port_id),
            transporterId: idOr(last[0].transporter_id),
            vehicleId: idOr(last[0].vehicle_id),
            driverId: idOr(last[0].driver_id),
          },
  };
}

// ── Writes: the importer side ─────────────────────────────────────

/**
 * Everything a save or a submit must agree with the register about.
 *
 * Checked on every save, not only on submit: a draft that names a
 * vehicle another transporter owns is wrong now, and the person
 * typing it is the one who can fix it.
 */
async function checkReferences(input: InwardSaveInput, importerId: number): Promise<Record<string, string>> {
  const db = getDb();
  const fields: Record<string, string> = {};

  const wh = await db.execute<{ ok: boolean }>(sql`
    select exists(select 1 from wms.warehouse where id = ${input.warehouseId} and deleted_at is null and is_active) as ok
  `);
  if (!wh[0]?.ok) fields.warehouseId = "Choose a warehouse";

  if (input.transporterId) {
    const t = await db.execute<{ ok: boolean }>(sql`
      select exists(select 1 from wms.transporter where id = ${input.transporterId} and deleted_at is null
                      and not blacklisted
                      and (status = 'ACTIVE' or (status = 'PENDING' and proposed_by_importer_id = ${importerId}))) as ok
    `);
    if (!t[0]?.ok) fields.transporterId = "That transporter is not available";
  }
  if (input.vehicleId) {
    const v = await db.execute<{ transporter_id: number; ok: boolean }>(sql`
      select transporter_id,
             (status = 'ACTIVE' or (status = 'PENDING' and proposed_by_importer_id = ${importerId})) as ok
        from wms.vehicle where id = ${input.vehicleId} and deleted_at is null
    `);
    if (!v[0]?.ok) fields.vehicleId = "That vehicle is not available";
    else if (input.transporterId && Number(v[0].transporter_id) !== input.transporterId) {
      fields.vehicleId = "That vehicle belongs to a different transporter";
    }
  }
  if (input.driverId) {
    const d = await db.execute<{ transporter_id: number; ok: boolean }>(sql`
      select transporter_id,
             (status = 'ACTIVE' or (status = 'PENDING' and proposed_by_importer_id = ${importerId})) as ok
        from wms.driver where id = ${input.driverId} and deleted_at is null
    `);
    if (!d[0]?.ok) fields.driverId = "That driver is not available";
    else if (input.transporterId && Number(d[0].transporter_id) !== input.transporterId) {
      fields.driverId = "That driver works for a different transporter";
    }
  }
  if (input.containerTypeId) {
    const c = await db.execute<{ ok: boolean }>(sql`
      select exists(select 1 from wms.container_type where id = ${input.containerTypeId} and deleted_at is null and is_active) as ok
    `);
    if (!c[0]?.ok) fields.containerTypeId = "Choose a container type";
  }
  if (input.portId) {
    const p = await db.execute<{ ok: boolean }>(sql`
      select exists(select 1 from wms.port where id = ${input.portId} and deleted_at is null and is_active) as ok
    `);
    if (!p[0]?.ok) fields.portId = "Choose a port";
  }
  // Lines may name this importer's items only.
  const itemIds = [...new Set(input.items.map((l) => l.itemId).filter((v): v is number => !!v))];
  if (itemIds.length) {
    const owned = await db.execute<{ id: number }>(sql`
      select id from wms.item where importer_id = ${importerId} and deleted_at is null
         and id in (${sql.join(itemIds.map((i) => sql`${i}`), sql`, `)})
    `);
    const ok = new Set(owned.map((r) => Number(r.id)));
    input.items.forEach((l, idx) => {
      if (l.itemId && !ok.has(l.itemId)) fields[`items.${idx}.itemId`] = "That item is not in your catalogue";
    });
  }
  return fields;
}

/** The dock-facing fields that must be present before a submit. */
export function submitRequirements(input: {
  containerNumber: string | null;
  containerTypeId: number | null;
  portId: number | null;
  expectedArrival: string | null;
  transporterId: number | null;
  vehicleId: number | null;
  driverId: number | null;
  lines: number;
}): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!input.containerNumber) fields.containerNumber = "Container number is required";
  if (!input.containerTypeId) fields.containerTypeId = "Choose the container size";
  if (!input.portId) fields.portId = "Choose the port";
  if (!input.expectedArrival) fields.expectedArrival = "When is it expected?";
  if (!input.transporterId) fields.transporterId = "Choose a transporter";
  if (!input.vehicleId) fields.vehicleId = "Choose a vehicle";
  if (!input.driverId) fields.driverId = "Choose a driver";
  if (input.lines === 0) fields.items = "Add at least one item";
  return fields;
}

async function writeLines(requestId: number, lines: InwardSaveInput["items"]): Promise<void> {
  const db = getDb();
  // Snapshot the catalogue rows the lines point at, in one read.
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter((v): v is number => !!v))];
  const snap = new Map<number, { code: string; image: string | null }>();
  if (itemIds.length) {
    const rows = await db.execute<{ id: number; code: string; image_url: string | null }>(sql`
      select id, code, image_url from wms.item where id in (${sql.join(itemIds.map((i) => sql`${i}`), sql`, `)})
    `);
    for (const r of rows) snap.set(Number(r.id), { code: r.code, image: r.image_url });
  }
  const unitIds = [...new Set(lines.map((l) => l.unitId).filter((v): v is number => !!v))];
  const units = new Map<number, string>();
  if (unitIds.length) {
    const rows = await db.execute<{ id: number; code: string }>(sql`
      select id, code from wms.measurement_unit where id in (${sql.join(unitIds.map((i) => sql`${i}`), sql`, `)})
    `);
    for (const r of rows) units.set(Number(r.id), r.code);
  }
  const payload = lines.map((l, idx) => ({
    item_id: l.itemId ?? null,
    item_code: l.itemId ? (snap.get(l.itemId)?.code ?? null) : null,
    description: l.description,
    image_url: l.imageUrl ?? (l.itemId ? (snap.get(l.itemId)?.image ?? null) : null),
    carton_qty: l.cartonQty,
    pieces_per_carton: l.piecesPerCarton,
    measurement_unit_id: l.unitId ?? null,
    unit_code: l.unitId ? (units.get(l.unitId) ?? null) : null,
    kg_per_carton: l.kgPerCarton,
    sort_order: idx,
  }));
  // One statement, so a failure half-way leaves the old lines, not none.
  await db.execute(sql`
    with gone as (
      delete from wms.inward_request_item where inward_request_id = ${requestId}
    ),
    put as (
      insert into wms.inward_request_item
        (inward_request_id, item_id, item_code, description, image_url, carton_qty,
         pieces_per_carton, measurement_unit_id, unit_code, kg_per_carton, sort_order)
      select ${requestId}, x.item_id, x.item_code, x.description, x.image_url, x.carton_qty,
             x.pieces_per_carton, x.measurement_unit_id, x.unit_code, x.kg_per_carton, x.sort_order
        from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb)
          as x(item_id bigint, item_code text, description text, image_url text, carton_qty integer,
               pieces_per_carton integer, measurement_unit_id bigint, unit_code text,
               kg_per_carton numeric, sort_order smallint)
      returning id
    )
    select count(*) from put
  `);
}

export async function createRequest(
  actor: Actor,
  importerId: number,
  input: InwardSaveInput,
  meta: Meta,
): Promise<number> {
  const fields = await checkReferences(input, importerId);
  if (Object.keys(fields).length) {
    throw new InwardError("VALIDATION_FAILED", "Please check the highlighted fields", fields);
  }
  const rows = await getDb().execute<{ id: number; code: string }>(sql`
    insert into wms.inward_request
      (importer_id, warehouse_id, container_number, container_type_id, port_id, expected_arrival,
       remarks, transporter_id, vehicle_id, driver_id, created_by, updated_by)
    values (${importerId}, ${input.warehouseId}, ${input.containerNumber ?? null},
            ${input.containerTypeId ?? null}, ${input.portId ?? null},
            ${input.expectedArrival ?? null}, ${input.remarks ?? null},
            ${input.transporterId ?? null}, ${input.vehicleId ?? null}, ${input.driverId ?? null},
            ${actor.session.userId}, ${actor.session.userId})
    returning id, code
  `);
  const id = Number(rows[0]!.id);
  await writeLines(id, input.items);
  await auditQuietly({
    action: "inward.request.created",
    operation: "INSERT",
    entityType: "inward_request",
    entityId: String(id),
    entityLabel: rows[0]!.code,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    after: { warehouseId: input.warehouseId, lines: input.items.length },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
  return id;
}

export async function updateRequest(
  actor: Actor,
  scope: InwardScope,
  id: number,
  input: InwardSaveInput,
  meta: Meta,
): Promise<void> {
  const row = await visibleHeader(scope, id);
  const can = canDo(actor, { status: row.status, importerId: Number(row.importer_id), warehouseId: Number(row.warehouse_id) });
  if (!can.edit) {
    throw new InwardError("CONFLICT", `A ${STATUS_LABEL[row.status].toLowerCase()} request cannot be edited`);
  }
  const fields = await checkReferences(input, Number(row.importer_id));
  if (Object.keys(fields).length) {
    throw new InwardError("VALIDATION_FAILED", "Please check the highlighted fields", fields);
  }
  await getDb().execute(sql`
    update wms.inward_request
       set warehouse_id = ${input.warehouseId},
           container_number = ${input.containerNumber ?? null},
           container_type_id = ${input.containerTypeId ?? null},
           port_id = ${input.portId ?? null},
           expected_arrival = ${input.expectedArrival ?? null},
           remarks = ${input.remarks ?? null},
           transporter_id = ${input.transporterId ?? null},
           vehicle_id = ${input.vehicleId ?? null},
           driver_id = ${input.driverId ?? null},
           updated_by = ${actor.session.userId}
     where id = ${id}
  `);
  await writeLines(id, input.items);
  await auditQuietly({
    action: "inward.request.updated",
    operation: "UPDATE",
    entityType: "inward_request",
    entityId: String(id),
    entityLabel: row.code,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    after: { warehouseId: input.warehouseId, lines: input.items.length },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
}

function valuesFor(row: HeaderRow, extra: Record<string, string> = {}): Record<string, string> {
  return {
    id: String(row.id),
    code: row.code,
    company: row.importer_name,
    warehouse: row.warehouse_name,
    container: row.container_number ?? "—",
    eta: row.expected_arrival ?? "—",
    cartons: String(num(row.cartons)),
    kg: String(num(row.kg)),
    ...extra,
  };
}

async function tell(
  eventKey: string,
  row: HeaderRow,
  actor: Actor,
  meta: Meta,
  extra: Record<string, string> = {},
): Promise<void> {
  try {
    await announce({
      eventKey,
      values: valuesFor(row, extra),
      dedupeSuffix: `inward_request:${row.id}:${row.status}:${Date.now()}`,
      actorUserId: actor.session.userId,
      entityType: "inward_request",
      entityId: String(row.id),
      importerId: Number(row.importer_id),
      warehouseId: Number(row.warehouse_id),
      correlationId: meta.requestId,
    });
  } catch (error) {
    console.error("[inward] announce failed", { requestId: meta.requestId, eventKey, error: String(error) });
  }
}

export async function submitRequest(actor: Actor, scope: InwardScope, id: number, meta: Meta) {
  const row = await visibleHeader(scope, id);
  const can = canDo(actor, { status: row.status, importerId: Number(row.importer_id), warehouseId: Number(row.warehouse_id) });
  if (!can.submit) {
    throw new InwardError("CONFLICT", `A ${STATUS_LABEL[row.status].toLowerCase()} request cannot be submitted`);
  }
  const missing = submitRequirements({
    containerNumber: row.container_number,
    containerTypeId: row.container_type_id === null ? null : Number(row.container_type_id),
    portId: row.port_id === null ? null : Number(row.port_id),
    expectedArrival: row.expected_arrival,
    transporterId: row.transporter_id === null ? null : Number(row.transporter_id),
    vehicleId: row.vehicle_id === null ? null : Number(row.vehicle_id),
    driverId: row.driver_id === null ? null : Number(row.driver_id),
    lines: num(row.lines),
  });
  if (Object.keys(missing).length) {
    throw new InwardError("VALIDATION_FAILED", "A few things are missing before the warehouse can be told", missing);
  }
  await getDb().execute(sql`
    update wms.inward_request
       set status = 'SUBMITTED', submitted_by = ${actor.session.userId}, submitted_at = now(),
           needs_changes_note = null, last_status_by = ${actor.session.userId}, last_status_at = now(),
           updated_by = ${actor.session.userId}
     where id = ${id}
  `);
  await auditQuietly({
    action: "inward.request.submitted",
    operation: "UPDATE",
    entityType: "inward_request",
    entityId: String(id),
    entityLabel: row.code,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    before: { status: row.status },
    after: { status: "SUBMITTED" },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
  const fresh = (await headerOf(id))!;
  await tell("inward.request_submitted", fresh, actor, meta);
  return getRequest(actor, scope, id);
}

export async function cancelRequest(actor: Actor, scope: InwardScope, id: number, meta: Meta) {
  const row = await visibleHeader(scope, id);
  const can = canDo(actor, { status: row.status, importerId: Number(row.importer_id), warehouseId: Number(row.warehouse_id) });
  if (!can.cancel) {
    throw new InwardError("CONFLICT", `A ${STATUS_LABEL[row.status].toLowerCase()} request cannot be cancelled`);
  }
  await getDb().execute(sql`
    update wms.inward_request
       set status = 'CANCELLED', cancelled_by = ${actor.session.userId}, cancelled_at = now(),
           last_status_by = ${actor.session.userId}, last_status_at = now(), updated_by = ${actor.session.userId}
     where id = ${id}
  `);
  await auditQuietly({
    action: "inward.request.cancelled",
    operation: "UPDATE",
    entityType: "inward_request",
    entityId: String(id),
    entityLabel: row.code,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    before: { status: row.status },
    after: { status: "CANCELLED" },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
  // The dock only hears about it if it had been told in the first place.
  if (row.status !== "DRAFT") await tell("inward.request_cancelled", row, actor, meta);
  return getRequest(actor, scope, id);
}

// ── Writes: the warehouse side ────────────────────────────────────

export async function decideRequest(
  actor: Actor,
  scope: InwardScope,
  id: number,
  action: "ACKNOWLEDGE" | "NEEDS_CHANGES" | "IN_PROCESS" | "COMPLETE",
  note: string | null,
  meta: Meta,
) {
  const row = await visibleHeader(scope, id);
  const can = canDo(actor, { status: row.status, importerId: Number(row.importer_id), warehouseId: Number(row.warehouse_id) });
  const allowed = {
    ACKNOWLEDGE: can.acknowledge,
    NEEDS_CHANGES: can.needs_changes,
    IN_PROCESS: can.in_process,
    COMPLETE: can.complete,
  }[action];
  if (!allowed) {
    throw new InwardError(
      "CONFLICT",
      `That cannot be done to a ${STATUS_LABEL[row.status].toLowerCase()} request`,
    );
  }
  if (action === "NEEDS_CHANGES" && !note) {
    throw new InwardError("VALIDATION_FAILED", "Say what needs to change", { note: "Required" });
  }

  const next: InwardStatus = {
    ACKNOWLEDGE: "ACKNOWLEDGED" as const,
    NEEDS_CHANGES: "NEEDS_CHANGES" as const,
    IN_PROCESS: "IN_PROCESS" as const,
    COMPLETE: "COMPLETED" as const,
  }[action];

  const by = actor.session.userId;
  await getDb().execute(sql`
    update wms.inward_request
       set status = ${next},
           acknowledged_by = case when ${action} = 'ACKNOWLEDGE' then ${by} else acknowledged_by end,
           acknowledged_at = case when ${action} = 'ACKNOWLEDGE' then now() else acknowledged_at end,
           completed_by = case when ${action} = 'COMPLETE' then ${by} else completed_by end,
           completed_at = case when ${action} = 'COMPLETE' then now() else completed_at end,
           needs_changes_note = case when ${action} = 'NEEDS_CHANGES' then ${note} else needs_changes_note end,
           last_status_by = ${by}, last_status_at = now(), updated_by = ${by}
     where id = ${id}
  `);
  await auditQuietly({
    action: `inward.request.${action.toLowerCase()}`,
    operation: "UPDATE",
    entityType: "inward_request",
    entityId: String(id),
    entityLabel: row.code,
    actorUserId: by,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    before: { status: row.status },
    after: { status: next, note },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });

  const fresh = (await headerOf(id))!;
  if (action === "ACKNOWLEDGE") await tell("inward.request_acknowledged", fresh, actor, meta);
  else if (action === "NEEDS_CHANGES") await tell("inward.request_needs_changes", fresh, actor, meta, { note: note ?? "" });
  else await tell("inward.request_status", fresh, actor, meta, { statusLabel: STATUS_LABEL[next].toLowerCase() });

  return getRequest(actor, scope, id);
}

// ── Documents ─────────────────────────────────────────────────────

export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

const MAGIC: Array<{ type: string; bytes: number[]; ext: string }> = [
  { type: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46], ext: "pdf" },
  { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff], ext: "jpg" },
  { type: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47], ext: "png" },
  { type: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46], ext: "webp" },
];

/** What the bytes say they are — the header is the claim, this is the proof. */
export function sniffDocument(bytes: Uint8Array): { type: string; ext: string } {
  for (const m of MAGIC) {
    if (m.bytes.every((b, i) => bytes[i] === b)) {
      if (m.type === "image/webp" && !(bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)) {
        continue;
      }
      return { type: m.type, ext: m.ext };
    }
  }
  throw new InwardError("VALIDATION_FAILED", "A document has to be a PDF, JPG, PNG or WebP");
}

export async function addDocument(
  actor: Actor,
  scope: InwardScope,
  id: number,
  bytes: Uint8Array,
  originalName: string | null,
  meta: Meta,
): Promise<InwardDocument> {
  const row = await visibleHeader(scope, id);
  const can = canDo(actor, { status: row.status, importerId: Number(row.importer_id), warehouseId: Number(row.warehouse_id) });
  if (!can.edit) throw new InwardError("CONFLICT", "Documents can be added while the request is still yours to edit");
  if (bytes.length > DOCUMENT_MAX_BYTES) throw new InwardError("VALIDATION_FAILED", "That file is over 10 MB");
  const { type, ext } = sniffDocument(bytes);
  if (!configured()) throw new InwardError("CONFLICT", "Document storage is not configured on this environment");

  const key = `inward/${id}/${randomBytes(8).toString("hex")}.${ext}`;
  const put = await putObject(key, bytes, type);
  if (!put.ok) {
    console.error("[inward] document upload failed", { requestId: meta.requestId, key, ...put });
    throw new InwardError("INTERNAL", "The document could not be stored. Try again.");
  }
  const url = publicUrl(key);
  const clean = (originalName ?? "").replace(/[^\w. -]/g, "").slice(0, 120) || null;
  let rows: Array<Record<string, string>>;
  try {
    rows = await getDb().execute<Record<string, string>>(sql`
      insert into wms.inward_request_document
        (inward_request_id, storage_key, url, content_type, bytes, original_name, created_by)
      values (${id}, ${key}, ${url}, ${type}, ${bytes.length}, ${clean}, ${actor.session.userId})
      returning id, created_at::text as created_at
    `);
  } catch (error) {
    await deleteObject(key);
    throw error;
  }
  await auditQuietly({
    action: "inward.request.document_added",
    operation: "INSERT",
    entityType: "inward_request_document",
    entityId: String(rows[0]!.id),
    entityLabel: `${row.code} · ${clean ?? type}`,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
  return {
    id: Number(rows[0]!.id),
    url,
    contentType: type,
    bytes: bytes.length,
    originalName: clean,
    createdAt: rows[0]!.created_at,
  };
}

export async function removeDocument(
  actor: Actor,
  scope: InwardScope,
  id: number,
  documentId: number,
  meta: Meta,
): Promise<void> {
  const row = await visibleHeader(scope, id);
  const can = canDo(actor, { status: row.status, importerId: Number(row.importer_id), warehouseId: Number(row.warehouse_id) });
  if (!can.edit) throw new InwardError("CONFLICT", "Documents can be removed while the request is still yours to edit");
  const rows = await getDb().execute<{ storage_key: string; original_name: string | null }>(sql`
    delete from wms.inward_request_document
     where id = ${documentId} and inward_request_id = ${id}
    returning storage_key, original_name
  `);
  const gone = rows[0];
  if (!gone) throw new InwardError("NOT_FOUND", "No such document");
  await deleteObject(gone.storage_key);
  await auditQuietly({
    action: "inward.request.document_removed",
    operation: "DELETE",
    entityType: "inward_request_document",
    entityId: String(documentId),
    entityLabel: `${row.code} · ${gone.original_name ?? gone.storage_key}`,
    reason: "removed by the importer",
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
}

// ── The catalogue ─────────────────────────────────────────────────

export type ItemRow = {
  id: number;
  code: string;
  description: string;
  imageUrl: string | null;
  unitId: number | null;
  unitCode: string | null;
  piecesPerCarton: number | null;
  kgPerCarton: number | null;
  hsnCode: string | null;
  isActive: boolean;
  usedOn: number;
};

export async function listItems(importerId: number, q = ""): Promise<ItemRow[]> {
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await getDb().execute<Record<string, string | null>>(sql`
    select it.id, it.code, it.description, it.image_url, it.measurement_unit_id, mu.code as unit_code,
           it.pieces_per_carton, it.kg_per_carton::text as kg_per_carton, it.hsn_code, it.is_active,
           (select count(*) from wms.inward_request_item li where li.item_id = it.id) as used_on
      from wms.item it left join wms.measurement_unit mu on mu.id = it.measurement_unit_id
     where it.importer_id = ${importerId} and it.deleted_at is null
       ${q ? sql`and (it.description ilike ${like} or it.code ilike ${like})` : sql``}
     order by it.is_active desc, it.description
     limit 500
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    code: r.code ?? "",
    description: r.description ?? "",
    imageUrl: r.image_url,
    unitId: r.measurement_unit_id === null ? null : Number(r.measurement_unit_id),
    unitCode: r.unit_code,
    piecesPerCarton: r.pieces_per_carton === null ? null : Number(r.pieces_per_carton),
    kgPerCarton: r.kg_per_carton === null ? null : Number(r.kg_per_carton),
    hsnCode: r.hsn_code,
    isActive: r.is_active === "true" || (r.is_active as unknown) === true,
    usedOn: num(r.used_on),
  }));
}

export async function createItem(actor: Actor, importerId: number, input: ItemSaveInput, meta: Meta): Promise<ItemRow> {
  // ITM-0001 per importer. Two people adding at once collide on the
  // unique index and the second one simply tries the next number.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const next = await getDb().execute<{ n: number }>(sql`
      select coalesce(max(substring(code from '[0-9]+$')::int), 0) + 1 as n
        from wms.item where importer_id = ${importerId}
    `);
    const code = `ITM-${String(Number(next[0]?.n ?? 1)).padStart(4, "0")}`;
    try {
      const rows = await getDb().execute<{ id: number }>(sql`
        insert into wms.item
          (importer_id, code, description, measurement_unit_id, pieces_per_carton, kg_per_carton, hsn_code,
           is_active, created_by, updated_by)
        values (${importerId}, ${code}, ${input.description}, ${input.unitId ?? null},
                ${input.piecesPerCarton ?? null}, ${input.kgPerCarton ?? null}, ${input.hsnCode ?? null},
                ${input.isActive ?? true}, ${actor.session.userId}, ${actor.session.userId})
        returning id
      `);
      const id = Number(rows[0]!.id);
      await auditQuietly({
        action: "item.created",
        operation: "INSERT",
        entityType: "item",
        entityId: String(id),
        entityLabel: `${code} · ${input.description}`,
        actorUserId: actor.session.userId,
        actorEmail: actor.session.email,
        actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
        after: input,
        ip: meta.ip,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
      });
      return (await listItems(importerId)).find((r) => r.id === id)!;
    } catch (error) {
      const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
      if (code !== "23505") throw error;
    }
  }
  throw new InwardError("CONFLICT", "Could not allocate an item code. Try again.");
}

export async function updateItem(
  actor: Actor,
  importerId: number,
  id: number,
  input: Partial<ItemSaveInput>,
  meta: Meta,
): Promise<ItemRow> {
  const sets: SQL[] = [sql`updated_by = ${actor.session.userId}`];
  if (input.description !== undefined) sets.push(sql`description = ${input.description}`);
  if (input.unitId !== undefined) sets.push(sql`measurement_unit_id = ${input.unitId}`);
  if (input.piecesPerCarton !== undefined) sets.push(sql`pieces_per_carton = ${input.piecesPerCarton}`);
  if (input.kgPerCarton !== undefined) sets.push(sql`kg_per_carton = ${input.kgPerCarton}`);
  if (input.hsnCode !== undefined) sets.push(sql`hsn_code = ${input.hsnCode}`);
  if (input.isActive !== undefined) sets.push(sql`is_active = ${input.isActive}`);
  const rows = await getDb().execute<{ id: number }>(sql`
    update wms.item set ${sql.join(sets, sql`, `)}
     where id = ${id} and importer_id = ${importerId} and deleted_at is null
    returning id
  `);
  if (!rows[0]) throw new InwardError("NOT_FOUND", "No such item");
  await auditQuietly({
    action: "item.updated",
    operation: "UPDATE",
    entityType: "item",
    entityId: String(id),
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    after: input,
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
  return (await listItems(importerId)).find((r) => r.id === id)!;
}

export async function deleteItem(actor: Actor, importerId: number, id: number, meta: Meta): Promise<void> {
  const rows = await getDb().execute<{ id: number; image_storage_key: string | null; code: string }>(sql`
    update wms.item set deleted_at = now(), deleted_by = ${actor.session.userId}
     where id = ${id} and importer_id = ${importerId} and deleted_at is null
    returning id, image_storage_key, code
  `);
  if (!rows[0]) throw new InwardError("NOT_FOUND", "No such item");
  await auditQuietly({
    action: "item.deleted",
    operation: "DELETE",
    entityType: "item",
    entityId: String(id),
    entityLabel: rows[0].code,
    reason: "removed from the catalogue",
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
}

export async function setItemImage(
  actor: Actor,
  importerId: number,
  id: number,
  bytes: Uint8Array,
  meta: Meta,
): Promise<ItemRow> {
  const owned = await getDb().execute<{ image_storage_key: string | null }>(sql`
    select image_storage_key from wms.item where id = ${id} and importer_id = ${importerId} and deleted_at is null
  `);
  if (!owned[0]) throw new InwardError("NOT_FOUND", "No such item");
  if (bytes.length > 2 * 1024 * 1024) throw new InwardError("VALIDATION_FAILED", "That image is over 2 MB");
  const { type, ext } = sniffDocument(bytes);
  if (type === "application/pdf") throw new InwardError("VALIDATION_FAILED", "An item image has to be a picture");
  if (!configured()) throw new InwardError("CONFLICT", "Image storage is not configured on this environment");

  const key = `items/${importerId}/${randomBytes(8).toString("hex")}.${ext}`;
  const put = await putObject(key, bytes, type);
  if (!put.ok) {
    console.error("[inward] item image upload failed", { requestId: meta.requestId, key, ...put });
    throw new InwardError("INTERNAL", "The image could not be stored. Try again.");
  }
  const url = publicUrl(key);
  await getDb().execute(sql`
    update wms.item set image_url = ${url}, image_storage_key = ${key}, updated_by = ${actor.session.userId}
     where id = ${id}
  `);
  if (owned[0].image_storage_key) await deleteObject(owned[0].image_storage_key);
  return (await listItems(importerId)).find((r) => r.id === id)!;
}

// ── Proposing a carrier from the form ─────────────────────────────

/**
 * An importer adding a transporter, vehicle or driver the register does
 * not have. The row is PENDING, stamped with the importer, linked to the
 * warehouse the request is for (so that site's transporter manager sees
 * it), and usable on this importer's own requests immediately.
 */
export async function propose(
  actor: Actor,
  importerId: number,
  input: ProposeInput,
  meta: Meta,
): Promise<{ kind: string; id: number; label: string }> {
  const db = getDb();
  const by = actor.session.userId;

  if (input.kind === "transporter") {
    const seq = await db.execute<{ n: number }>(sql`
      select coalesce(max(substring(code from '[0-9]+$')::int), 0) + 1 as n from wms.transporter
    `);
    const code = `TRP-${String(Number(seq[0]?.n ?? 1)).padStart(4, "0")}`;
    const rows = await db.execute<{ id: number }>(sql`
      insert into wms.transporter
        (code, name, contact_person, contact_mobile, gstin, address, status,
         proposed_by_importer_id, created_by, updated_by)
      values (${code}, ${input.name}, ${input.contactPerson}, ${input.contactMobile},
              ${input.gstin ?? null}, ${input.address ?? null}, 'PENDING', ${importerId}, ${by}, ${by})
      returning id
    `);
    const id = Number(rows[0]!.id);
    await db.execute(sql`
      insert into wms.warehouse_transporter (warehouse_id, transporter_id)
      values (${input.warehouseId}, ${id}) on conflict do nothing
    `);
    await auditQuietly({
      action: "transporter.proposed",
      operation: "INSERT",
      entityType: "transporter",
      entityId: String(id),
      entityLabel: `${code} · ${input.name}`,
      actorUserId: by,
      actorEmail: actor.session.email,
      actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
      after: { ...input, importerId },
      ip: meta.ip,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    });
    return { kind: "transporter", id, label: input.name };
  }

  // A vehicle or driver hangs off a transporter the importer may use.
  const t = await db.execute<{ ok: boolean }>(sql`
    select exists(select 1 from wms.transporter where id = ${input.transporterId} and deleted_at is null
                    and (status = 'ACTIVE' or (status = 'PENDING' and proposed_by_importer_id = ${importerId}))) as ok
  `);
  if (!t[0]?.ok) throw new InwardError("VALIDATION_FAILED", "Choose a transporter first", { transporterId: "Required" });

  if (input.kind === "vehicle") {
    const rows = await db.execute<{ id: number }>(sql`
      insert into wms.vehicle
        (transporter_id, vehicle_type_id, registration_number, capacity_kg, notes, status,
         proposed_by_importer_id, created_by, updated_by)
      values (${input.transporterId}, ${input.vehicleTypeId}, ${input.registrationNumber},
              ${input.capacityKg ?? null}, ${input.rcNumber ? `RC ${input.rcNumber}` : null}, 'PENDING',
              ${importerId}, ${by}, ${by})
      returning id
    `);
    const id = Number(rows[0]!.id);
    await auditQuietly({
      action: "vehicle.proposed",
      operation: "INSERT",
      entityType: "vehicle",
      entityId: String(id),
      entityLabel: input.registrationNumber,
      actorUserId: by,
      actorEmail: actor.session.email,
      actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
      after: { ...input, importerId },
      ip: meta.ip,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    });
    return { kind: "vehicle", id, label: input.registrationNumber };
  }

  const rows = await db.execute<{ id: number }>(sql`
    insert into wms.driver
      (transporter_id, name, mobile, licence_number, aadhaar_number, status,
       proposed_by_importer_id, created_by, updated_by)
    values (${input.transporterId}, ${input.name}, ${input.mobile}, ${input.licenceNumber},
            ${input.aadhaarNumber ?? null}, 'PENDING', ${importerId}, ${by}, ${by})
    returning id
  `);
  const id = Number(rows[0]!.id);
  await auditQuietly({
    action: "driver.proposed",
    operation: "INSERT",
    entityType: "driver",
    entityId: String(id),
    entityLabel: input.name,
    actorUserId: by,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    after: { name: input.name, mobile: input.mobile, licenceNumber: input.licenceNumber, importerId },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
  return { kind: "driver", id, label: input.name };
}

// ── Dashboard tiles ───────────────────────────────────────────────

export async function inwardTiles(scope: InwardScope): Promise<{
  open: number;
  awaiting: number;
  needsChanges: number;
  arrivingToday: number;
}> {
  const rows = await getDb().execute<Record<string, string>>(sql`
    select count(*) filter (where r.status in ('DRAFT','SUBMITTED','NEEDS_CHANGES','ACKNOWLEDGED','IN_PROCESS')) as open,
           count(*) filter (where r.status = 'SUBMITTED') as awaiting,
           count(*) filter (where r.status = 'NEEDS_CHANGES') as needs_changes,
           count(*) filter (where r.status in ('ACKNOWLEDGED','IN_PROCESS') and r.expected_arrival = current_date) as arriving_today
      from wms.inward_request r
     where r.deleted_at is null and ${scopeWhere(scope)}
  `);
  const r = rows[0] ?? {};
  return {
    open: num(r.open),
    awaiting: num(r.awaiting),
    needsChanges: num(r.needs_changes),
    arrivingToday: num(r.arriving_today),
  };
}
