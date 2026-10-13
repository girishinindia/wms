import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db";
import { auditQuietly } from "@/lib/audit";
import { grantFor, type Actor } from "@/lib/auth/guard";
import { dnScope, dnWhere, fyOf } from "@/lib/delivery/ops";
import { afterStep, count } from "@/lib/dispatch/ops";
import { cartonNoFromScan } from "@/lib/inward/carton-format";
import { InwardError, sniffDocument, type Meta } from "@/lib/inward/ops";
import { fmtDateTime } from "@/lib/format/datetime";
import { announce } from "@/lib/notify/announce";
import { configured, publicUrl, putObject } from "@/lib/storage/bunny";
import { toWebp } from "@/lib/storage/picture";
import { warehousesFor } from "@/lib/storage/locations";

import { DO_LABEL, LR_LABEL } from "./labels";

/**
 * Outward: a delivery note that is packed and verified leaves on one or
 * more Dispatch Orders (DO), one per vehicle.
 *
 *   outward.order.read      see DOs                    SA · WA · Dispatch · Package · LR collector · importer / agent (own)
 *   outward.order.create    make, correct, hold, cancel SA · WA · Dispatch
 *   outward.order.update    loading scans               SA · WA · Dispatch · Package
 *   outward.order.approve   confirm departure           SA · WA · Dispatch
 *   outward.short_close.approve  close a note short     SA · WA
 *   lorry_receipt.create / update   attach LR, collected   SA · WA · Dispatch · LR collector
 *   lorry_receipt.approve            verify / reject LR    SA · WA · Dispatch
 *
 * The rules that must never break (one package on one DO, stock leaves
 * once, numbers never reused) live in sql/42 and run under row locks.
 */

export { DO_LABEL, LR_LABEL };

/** An LR not attached this many days after departure is shown as missing. */
export const LR_DUE_DAYS = 2;

const may = (actor: Actor, permission: string, warehouseId: number) => {
  const ids = warehousesFor(actor, permission);
  return ids === null || ids.includes(warehouseId);
};

function who(actor: Actor): string {
  return `${actor.session.firstName} ${actor.session.lastName}`.trim();
}

function auditBase(actor: Actor, meta: Meta) {
  return {
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: who(actor),
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  };
}

/** "26-27" → "2026-27": the year as Tally writes it on a voucher. */
export function longFy(fy: string): string {
  return `20${fy.slice(0, 2)}-${fy.slice(3)}`;
}

const MOBILE = /^[6-9][0-9]{9}$/;
const mobileOf = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");

// ── Rows ──────────────────────────────────────────────────────────

export type DoRow = {
  id: number;
  doNo: string;
  noteId: number;
  dnNo: string;
  status: string;
  statusLabel: string;
  lrStatus: string;
  lrLabel: string;
  /** Days since departure while the LR is still not attached (shown as missing past LR_DUE_DAYS). */
  lrDaysOut: number | null;
  warehouseId: number;
  warehouseName: string;
  importerName: string;
  buyerName: string | null;
  destination: string | null;
  transportName: string | null;
  vehicleNo: string | null;
  driverName: string | null;
  packages: number;
  cartons: number;
  loaded: number;
  lrCount: number;
  createdAt: string;
  dispatchedAt: string | null;
  holdReason: string | null;
};

const DO_SELECT = sql`
  select o.id, o.do_no, o.note_id, n.dn_no, o.status, o.lr_status, o.warehouse_id, w.name as warehouse_name,
         i.company_name as importer_name, o.buyer_name, o.destination, o.transport_name, o.vehicle_no, o.driver_name,
         o.created_at::text as created_at, o.dispatched_at::text as dispatched_at, o.hold_reason,
         (select count(*) from wms.dispatch_order_package dp where dp.do_id = o.id and dp.live)::int as packages,
         (select coalesce(sum(dp.cartons), 0) from wms.dispatch_order_package dp where dp.do_id = o.id and dp.live)::int as cartons,
         (select count(*) from wms.dispatch_order_package dp where dp.do_id = o.id and dp.live and dp.loaded_at is not null)::int as loaded,
         (select count(*) from wms.dispatch_lr l where l.do_id = o.id and l.status <> 'REPLACED')::int as lr_count,
         case when o.dispatched_at is null then null else floor(extract(epoch from (now() - o.dispatched_at)) / 86400)::int end as days_out
    from wms.dispatch_order o
    join wms.delivery_note n on n.id = o.note_id
    join wms.warehouse w on w.id = o.warehouse_id
    left join wms.importer i on i.id = o.importer_id
`;

function lrShown(status: string, lrStatus: string, daysOut: number | null): string {
  if (status !== "DISPATCHED") return "NOT_DUE";
  if (["PENDING", "COLLECTED", "SUBMITTED"].includes(lrStatus) && daysOut !== null && daysOut >= LR_DUE_DAYS) return "MISSING";
  return lrStatus;
}

function doRow(r: Record<string, unknown>): DoRow {
  const status = String(r.status);
  const daysOut = r.days_out === null || r.days_out === undefined ? null : Number(r.days_out);
  const lr = lrShown(status, String(r.lr_status), daysOut);
  return {
    id: Number(r.id),
    doNo: String(r.do_no),
    noteId: Number(r.note_id),
    dnNo: String(r.dn_no),
    status,
    statusLabel: DO_LABEL[status] ?? status,
    lrStatus: lr,
    lrLabel: LR_LABEL[lr] ?? lr,
    lrDaysOut: status === "DISPATCHED" && !["UPLOADED", "VERIFIED"].includes(lr) ? daysOut : null,
    warehouseId: Number(r.warehouse_id),
    warehouseName: String(r.warehouse_name),
    importerName: String(r.importer_name ?? ""),
    buyerName: (r.buyer_name as string | null) ?? null,
    destination: (r.destination as string | null) ?? null,
    transportName: (r.transport_name as string | null) ?? null,
    vehicleNo: (r.vehicle_no as string | null) ?? null,
    driverName: (r.driver_name as string | null) ?? null,
    packages: Number(r.packages ?? 0),
    cartons: Number(r.cartons ?? 0),
    loaded: Number(r.loaded ?? 0),
    lrCount: Number(r.lr_count ?? 0),
    createdAt: String(r.created_at),
    dispatchedAt: (r.dispatched_at as string | null) ?? null,
    holdReason: (r.hold_reason as string | null) ?? null,
  };
}

/** A note with verified packages not yet on a DO. */
export type ReadyNote = {
  id: number;
  dnNo: string;
  orderNo: string;
  warehouseId: number;
  warehouseName: string;
  importerName: string;
  buyerName: string;
  destination: string | null;
  priority: string;
  transportName: string | null;
  readyPackages: number;
  readyCartons: number;
  /** Cartons the note still asks for that have not left (incl. those not packed yet). */
  open: number;
  workStatus: string;
  readyAt: string | null;
};

// ── Who sees what ─────────────────────────────────────────────────

function readGrant(actor: Actor) {
  const g = grantFor(actor, "outward.order.read");
  if (!g) throw new InwardError("FORBIDDEN", "You do not have permission to see dispatch orders.");
  return g;
}

/** The WHERE for `delivery_note n` joined to a DO — importer / agent see only their own notes. */
function noteScope(actor: Actor): SQL {
  return dnWhere(dnScope(actor, readGrant(actor)));
}

export type OutwardView = "READY" | "LOADING" | "LOADED" | "LR_PENDING" | "LR_VERIFY" | "DONE" | "ALL";

const VIEW_WHERE: Record<Exclude<OutwardView, "READY">, SQL> = {
  LOADING: sql`o.status in ('DRAFT','PENDING_VERIFICATION','READY_FOR_OUTWARD','LOADING_IN_PROGRESS','ON_HOLD')`,
  LOADED: sql`o.status = 'LOADED'`,
  LR_PENDING: sql`o.status = 'DISPATCHED' and o.lr_status in ('PENDING','COLLECTED','SUBMITTED','REJECTED','MISSING')`,
  LR_VERIFY: sql`o.status = 'DISPATCHED' and o.lr_status = 'UPLOADED'`,
  DONE: sql`o.status = 'DISPATCHED' and o.lr_status = 'VERIFIED'`,
  ALL: sql`true`,
};

export type OutwardBoard = {
  view: OutwardView;
  counts: Record<OutwardView, number>;
  orders: DoRow[];
  ready: ReadyNote[];
};

const READY_SELECT = sql`
  select n.id, n.dn_no, n.order_no, n.warehouse_id, w.name as warehouse_name, i.company_name as importer_name, n.buyer_name,
         coalesce(n.destination, n.buyer_city) as destination, n.priority, n.transport_name, n.work_status, n.ready_at::text as ready_at,
         (select count(*) from wms.delivery_package p where p.note_id = n.id and p.status = 'VERIFIED'
            and not exists (select 1 from wms.dispatch_order_package dp where dp.package_id = p.id and dp.live))::int as ready_packages,
         (select count(*) from wms.inward_carton c join wms.delivery_package p on p.id = c.package_id
           where p.note_id = n.id and p.status = 'VERIFIED'
             and not exists (select 1 from wms.dispatch_order_package dp where dp.package_id = p.id and dp.live))::int as ready_cartons,
         (select coalesce(sum(l.cartons - l.dispatched_cartons - l.short_cartons), 0) from wms.delivery_line l where l.delivery_note_id = n.id)::int as open
    from wms.delivery_note n
    join wms.warehouse w on w.id = n.warehouse_id
    left join wms.importer i on i.id = n.importer_id
`;

const READY_WHERE = sql`n.status = 'APPROVED' and not n.on_hold and n.short_closed_at is null
  and exists (select 1 from wms.delivery_package p where p.note_id = n.id and p.status = 'VERIFIED'
               and not exists (select 1 from wms.dispatch_order_package dp where dp.package_id = p.id and dp.live))`;

function readyRow(r: Record<string, unknown>): ReadyNote {
  return {
    id: Number(r.id),
    dnNo: String(r.dn_no),
    orderNo: String(r.order_no ?? ""),
    warehouseId: Number(r.warehouse_id),
    warehouseName: String(r.warehouse_name),
    importerName: String(r.importer_name ?? ""),
    buyerName: String(r.buyer_name ?? ""),
    destination: (r.destination as string | null) ?? null,
    priority: String(r.priority ?? "NORMAL"),
    transportName: (r.transport_name as string | null) ?? null,
    readyPackages: Number(r.ready_packages ?? 0),
    readyCartons: Number(r.ready_cartons ?? 0),
    open: Number(r.open ?? 0),
    workStatus: String(r.work_status),
    readyAt: (r.ready_at as string | null) ?? null,
  };
}

const search = (q: string | null | undefined): SQL | null => {
  const t = q?.trim().toLowerCase();
  if (!t) return null;
  const like = `%${t}%`;
  return sql`(lower(n.dn_no) like ${like} or lower(coalesce(n.buyer_name, '')) like ${like} or lower(coalesce(i.company_name, '')) like ${like}
              or lower(coalesce(n.buyer_city, '')) like ${like}
              or exists (select 1 from wms.dispatch_order o2 where o2.note_id = n.id
                          and (lower(o2.do_no) like ${like} or lower(coalesce(o2.vehicle_no, '')) like ${like}
                               or lower(coalesce(o2.transport_name, '')) like ${like}
                               or exists (select 1 from wms.dispatch_lr l where l.do_id = o2.id and lower(l.lr_no) like ${like})))
              or exists (select 1 from wms.inward_carton c where c.dn_id = n.id and lower(c.carton_no) like ${like}))`;
};

export async function outwardBoard(actor: Actor, filter: { view?: string | null; q?: string | null } = {}): Promise<OutwardBoard> {
  const scope = noteScope(actor);
  const q = search(filter.q);
  const db = getDb();
  const own = readGrant(actor).scope === "OWN";
  const views: OutwardView[] = ["READY", "LOADING", "LOADED", "LR_PENDING", "LR_VERIFY", "DONE", "ALL"];
  const wanted = (views.includes(filter.view as OutwardView) ? filter.view : own ? "ALL" : "READY") as OutwardView;

  const countRows = await db.execute<Record<string, number>>(sql`
    select
      (select count(*) from wms.delivery_note n left join wms.importer i on i.id = n.importer_id
        where ${scope} and ${READY_WHERE} ${q ? sql`and ${q}` : sql``})::int as ready,
      ${sql.join(
        (Object.keys(VIEW_WHERE) as Exclude<OutwardView, "READY">[]).map(
          (v) => sql`(select count(*) from wms.dispatch_order o join wms.delivery_note n on n.id = o.note_id left join wms.importer i on i.id = n.importer_id
                       where ${scope} and ${VIEW_WHERE[v]} ${v === "ALL" ? sql`` : sql`and o.status <> 'CANCELLED'`} ${q ? sql`and ${q}` : sql``})::int as ${sql.raw(v.toLowerCase())}`,
        ),
        sql`, `,
      )}
  `);
  const c = countRows[0] ?? {};
  // "Missing" LRs are still pending ones, counted in LR_PENDING.
  const counts = Object.fromEntries(views.map((v) => [v, Number(c[v.toLowerCase()] ?? 0)])) as Record<OutwardView, number>;

  let orders: DoRow[] = [];
  let ready: ReadyNote[] = [];
  if (wanted === "READY") {
    ready = (
      await db.execute<Record<string, unknown>>(sql`
        ${READY_SELECT} where ${scope} and ${READY_WHERE} ${q ? sql`and ${q}` : sql``}
        order by case n.priority when 'URGENT' then 0 else 1 end, n.ready_at nulls last, n.id
        limit 300
      `)
    ).map(readyRow);
  } else {
    orders = (
      await db.execute<Record<string, unknown>>(sql`
        ${DO_SELECT} where ${scope} and ${VIEW_WHERE[wanted]} ${wanted === "ALL" ? sql`` : sql`and o.status <> 'CANCELLED'`} ${q ? sql`and ${q}` : sql``}
        order by case o.status when 'ON_HOLD' then 0 when 'LOADING_IN_PROGRESS' then 1 when 'LOADED' then 2 else 3 end,
                 coalesce(o.dispatched_at, o.created_at) ${wanted === "LR_PENDING" ? sql`asc` : sql`desc`}, o.id desc
        limit 300
      `)
    ).map(doRow);
  }
  return { view: wanted, counts, orders, ready };
}

// ── One DO ────────────────────────────────────────────────────────

export type DoCheck = { key: string; label: string; ok: boolean; detail: string; blocking: boolean };
export type DoPackage = { id: number; code: string; kind: string; cartons: number; cartonNos: string[]; items: string; loadedAt: string | null; loadedBy: string | null };
export type DoLr = {
  id: number;
  lrNo: string;
  lrDate: string;
  transportName: string | null;
  vehicleNo: string | null;
  fileUrl: string;
  fileName: string | null;
  fileType: string | null;
  status: string;
  duplicateOf: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
  checkedBy: string | null;
  checkedAt: string | null;
  rejectReason: string | null;
};

export type DoDetail = DoRow & {
  importerId: number;
  orderNo: string;
  noteStatus: string;
  noteWorkStatus: string;
  agentName: string | null;
  buyerMobile: string | null;
  buyerAddress: string | null;
  transporterId: number | null;
  transporterMobile: string | null;
  transporterGstin: string | null;
  vehicleId: number | null;
  vehicleType: string | null;
  driverId: number | null;
  driverMobile: string | null;
  transportMode: string;
  remarks: string | null;
  tallyVoucherNo: string | null;
  createdBy: string | null;
  loadedAt: string | null;
  loadedBy: string | null;
  dispatchedBy: string | null;
  cancelReason: string | null;
  lrCollectedBy: string | null;
  lrCollectedAt: string | null;
  lrSubmittedBy: string | null;
  lrSubmittedAt: string | null;
  packageList: DoPackage[];
  checks: DoCheck[];
  /** What else of the note is still to go (other packages, cartons not packed). */
  noteOpen: number;
  noteOtherReady: number;
  scans: { code: string; result: string; message: string | null; by: string | null; at: string }[];
  events: { action: string; detail: string | null; by: string | null; at: string }[];
  lrs: DoLr[];
  can: {
    edit: boolean;
    load: boolean;
    depart: boolean;
    cancel: boolean;
    hold: boolean;
    lrUpload: boolean;
    lrCollect: boolean;
    lrVerify: boolean;
    print: boolean;
  };
};

async function doBase(id: number) {
  const r = (await getDb().execute<Record<string, unknown>>(sql`
    select o.*, n.dn_no, n.order_no, n.status as note_status, n.work_status as note_work_status, n.version as note_now_version,
           n.buyer_name as n_buyer_name, coalesce(n.destination, n.buyer_city) as n_destination, n.buyer_mobile, n.buyer_address,
           n.created_by as note_created_by, n.on_hold as note_on_hold,
           trim(coalesce(ua.first_name, '') || ' ' || coalesce(ua.last_name, '')) as agent_name
      from wms.dispatch_order o
      join wms.delivery_note n on n.id = o.note_id
      left join wms.users ua on ua.id = n.created_by
     where o.id = ${id}
  `))[0];
  return r ?? null;
}

async function visible(actor: Actor, id: number) {
  const ok = (await getDb().execute<{ id: number }>(sql`
    select o.id from wms.dispatch_order o join wms.delivery_note n on n.id = o.note_id where o.id = ${id} and ${noteScope(actor)}
  `))[0];
  const r = ok ? await doBase(id) : null;
  if (!r) throw new InwardError("NOT_FOUND", "No such dispatch order");
  return r;
}

/** Everything that must be true before goods go: checked against the delivery note, every time. */
function checksOf(r: Record<string, unknown>, pkgs: { status: string; noteId: number; cartons: number; dispatched: number }[]): DoCheck[] {
  const list: DoCheck[] = [];
  const noteOk = String(r.note_status) === "APPROVED" && !r.note_on_hold;
  list.push({
    key: "note",
    label: "Delivery note approved",
    ok: noteOk,
    detail: noteOk ? `${r.dn_no} · approved` : `${r.dn_no} is ${r.note_on_hold ? "on hold" : String(r.note_status).toLowerCase()}`,
    blocking: true,
  });
  const same = Number(r.note_version) === Number(r.note_now_version);
  list.push({
    key: "version",
    label: "Note unchanged since this DO was made",
    ok: same,
    detail: same ? "Same as when the DO was made" : "The delivery note was changed after this DO was made — check it, then cancel and make a new DO",
    blocking: true,
  });
  const buyerOk = (r.buyer_name ?? "") === (r.n_buyer_name ?? "") && (r.destination ?? "") === (r.n_destination ?? "");
  list.push({
    key: "buyer",
    label: "Buyer and destination",
    ok: buyerOk,
    detail: buyerOk ? `${r.buyer_name ?? ""}${r.destination ? ` · ${r.destination}` : ""}` : `The note now says ${r.n_buyer_name ?? "?"} · ${r.n_destination ?? "?"}`,
    blocking: true,
  });
  const cartons = pkgs.reduce((a, p) => a + p.cartons, 0);
  const badPkg = pkgs.filter((p) => p.noteId !== Number(r.note_id) || (p.status !== "VERIFIED" && p.dispatched === 0));
  list.push({
    key: "goods",
    label: "Packages verified, of this note",
    ok: pkgs.length > 0 && badPkg.length === 0,
    detail: pkgs.length === 0 ? "No package on this DO" : badPkg.length ? `${badPkg.length} package(s) not verified or not of this note` : `${count(pkgs.length, "package")} · ${count(cartons, "carton")}`,
    blocking: true,
  });
  const vehicle = (r.vehicle_no as string | null)?.trim();
  const driver = (r.driver_name as string | null)?.trim();
  const mobile = mobileOf(r.driver_mobile as string | null);
  const transport = (r.transport_name as string | null)?.trim();
  const missing = [!transport && "transporter", !vehicle && "vehicle no.", !driver && "driver name", !MOBILE.test(mobile) && "driver mobile"].filter(Boolean);
  list.push({
    key: "transport",
    label: "Transporter, vehicle and driver",
    ok: missing.length === 0,
    detail: missing.length ? `Missing: ${missing.join(", ")}` : `${transport} · ${vehicle} · ${driver} (${mobile})`,
    blocking: false,
  });
  return list;
}

async function packagesOf(doId: number): Promise<(DoPackage & { status: string; noteId: number; dispatched: number })[]> {
  const rows = await getDb().execute<Record<string, unknown>>(sql`
    select p.id, p.code, p.kind, p.status, p.note_id, dp.cartons, dp.loaded_at::text as loaded_at,
           trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as loaded_by,
           (select array_agg(c.carton_no order by c.carton_no) from wms.inward_carton c where c.package_id = p.id) as carton_nos,
           (select count(*) from wms.inward_carton c where c.package_id = p.id and c.status = 'DISPATCHED')::int as dispatched,
           (select string_agg(distinct coalesce(li.item_code || ' · ', '') || li.description, '; ')
              from wms.inward_carton c join wms.inward_request_item li on li.id = c.inward_request_item_id where c.package_id = p.id) as items
      from wms.dispatch_order_package dp
      join wms.delivery_package p on p.id = dp.package_id
      left join wms.users u on u.id = dp.loaded_by
     where dp.do_id = ${doId} and dp.live
     order by p.package_no
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    code: String(r.code),
    kind: String(r.kind),
    status: String(r.status),
    noteId: Number(r.note_id),
    cartons: Number(r.cartons),
    cartonNos: ((r.carton_nos as string[] | null) ?? []).map(String),
    items: String(r.items ?? ""),
    loadedAt: (r.loaded_at as string | null) ?? null,
    loadedBy: (r.loaded_by as string | null) || null,
    dispatched: Number(r.dispatched ?? 0),
  }));
}

/** Move a DO between "needs details", "ready to load" and "on hold" as its checks say. */
async function settle(id: number, actor: Actor | null, meta: Meta | null): Promise<void> {
  const r = await doBase(id);
  if (!r) return;
  const status = String(r.status);
  if (!["DRAFT", "PENDING_VERIFICATION", "READY_FOR_OUTWARD", "LOADING_IN_PROGRESS", "LOADED"].includes(status)) return;
  const checks = checksOf(r, await packagesOf(id));
  const broken = checks.find((c) => c.blocking && !c.ok);
  const db = getDb();
  if (broken) {
    await db.execute(sql`
      update wms.dispatch_order set status = 'ON_HOLD', hold_from = ${status}, hold_reason = ${broken.detail}, hold_at = now(),
             hold_by = ${actor?.session.userId ?? null}, updated_at = now()
       where id = ${id} and status = ${status}
    `);
    await db.execute(sql`insert into wms.dispatch_order_event (do_id, action, detail, by_user) values (${id}, 'ON_HOLD', ${broken.detail}, ${actor?.session.userId ?? null})`);
    if (actor && meta) await tellDo("outward.hold", id, actor, meta, { reason: broken.detail });
    return;
  }
  const transportOk = checks.find((c) => c.key === "transport")?.ok ?? false;
  if (transportOk && (status === "PENDING_VERIFICATION" || status === "DRAFT")) {
    await db.execute(sql`update wms.dispatch_order set status = 'READY_FOR_OUTWARD', updated_at = now() where id = ${id} and status = ${status}`);
  } else if (!transportOk && status === "READY_FOR_OUTWARD") {
    await db.execute(sql`update wms.dispatch_order set status = 'PENDING_VERIFICATION', updated_at = now() where id = ${id} and status = 'READY_FOR_OUTWARD'`);
  }
}

export async function doDetail(actor: Actor, id: number): Promise<DoDetail> {
  await visible(actor, id);
  await settle(id, null, null);
  const r = (await doBase(id))!;
  const db = getDb();
  const row = doRow((await db.execute<Record<string, unknown>>(sql`${DO_SELECT} where o.id = ${id}`))[0]!);
  const pkgs = await packagesOf(id);
  const name = (uid: unknown) =>
    uid
      ? db
          .execute<{ n: string }>(sql`select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) as n from wms.users where id = ${Number(uid)}`)
          .then((x) => x[0]?.n || null)
      : Promise.resolve(null);
  const [createdBy, loadedBy, dispatchedBy, collectedBy, submittedBy] = await Promise.all([
    name(r.created_by),
    name(r.loaded_by),
    name(r.dispatched_by),
    name(r.lr_collected_by),
    name(r.lr_submitted_by),
  ]);
  const other = (await db.execute<{ n: number; open: number }>(sql`
    select (select count(*) from wms.delivery_package p where p.note_id = ${Number(r.note_id)} and p.status = 'VERIFIED'
              and not exists (select 1 from wms.dispatch_order_package dp where dp.package_id = p.id and dp.live))::int as n,
           (select coalesce(sum(l.cartons - l.dispatched_cartons - l.short_cartons), 0) from wms.delivery_line l where l.delivery_note_id = ${Number(r.note_id)})::int as open
  `))[0];
  const scans = await db.execute<Record<string, unknown>>(sql`
    select s.code, s.result, s.message, s.scanned_at::text as at, trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as by
      from wms.dispatch_scan s left join wms.users u on u.id = s.scanned_by
     where s.do_id = ${id} order by s.scanned_at desc limit 40
  `);
  const events = await db.execute<Record<string, unknown>>(sql`
    select e.action, e.detail, e.at::text as at, trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as by
      from wms.dispatch_order_event e left join wms.users u on u.id = e.by_user
     where e.do_id = ${id} order by e.at, e.id
  `);
  const lrs = await db.execute<Record<string, unknown>>(sql`
    select l.*, l.lr_date::text as lr_date_text, l.uploaded_at::text as uploaded_at_text, l.checked_at::text as checked_at_text,
           trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as uploaded_by_name,
           trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) as checked_by_name
      from wms.dispatch_lr l left join wms.users u on u.id = l.uploaded_by left join wms.users c on c.id = l.checked_by
     where l.do_id = ${id} order by l.uploaded_at desc
  `);
  const wh = Number(r.warehouse_id);
  const status = String(r.status);
  const live = !["DISPATCHED", "CANCELLED"].includes(status);
  return {
    ...row,
    importerId: Number(r.importer_id),
    orderNo: String(r.order_no ?? ""),
    noteStatus: String(r.note_status),
    noteWorkStatus: String(r.note_work_status),
    agentName: (r.agent_name as string) || null,
    buyerMobile: (r.buyer_mobile as string | null) ?? null,
    buyerAddress: (r.buyer_address as string | null) ?? null,
    transporterId: r.transporter_id ? Number(r.transporter_id) : null,
    transporterMobile: (r.transporter_mobile as string | null) ?? null,
    transporterGstin: (r.transporter_gstin as string | null) ?? null,
    vehicleId: r.vehicle_id ? Number(r.vehicle_id) : null,
    vehicleType: (r.vehicle_type as string | null) ?? null,
    driverId: r.driver_id ? Number(r.driver_id) : null,
    driverMobile: (r.driver_mobile as string | null) ?? null,
    transportMode: String(r.transport_mode ?? "ROAD"),
    remarks: (r.remarks as string | null) ?? null,
    tallyVoucherNo: (r.tally_voucher_no as string | null) ?? null,
    createdBy,
    loadedAt: r.loaded_at ? String(r.loaded_at) : null,
    loadedBy,
    dispatchedBy,
    cancelReason: (r.cancel_reason as string | null) ?? null,
    lrCollectedBy: collectedBy,
    lrCollectedAt: r.lr_collected_at ? String(r.lr_collected_at) : null,
    lrSubmittedBy: submittedBy,
    lrSubmittedAt: r.lr_submitted_at ? String(r.lr_submitted_at) : null,
    packageList: pkgs.map((p) => ({ id: p.id, code: p.code, kind: p.kind, cartons: p.cartons, cartonNos: p.cartonNos, items: p.items, loadedAt: p.loadedAt, loadedBy: p.loadedBy })),
    checks: checksOf(r, pkgs),
    noteOpen: Number(other?.open ?? 0),
    noteOtherReady: Number(other?.n ?? 0),
    scans: scans.map((s) => ({ code: String(s.code).split("\n")[0]!, result: String(s.result), message: (s.message as string | null) ?? null, by: (s.by as string) || null, at: String(s.at) })),
    events: events.map((e) => ({ action: String(e.action), detail: (e.detail as string | null) ?? null, by: (e.by as string) || null, at: String(e.at) })),
    lrs: lrs.map((l) => ({
      id: Number(l.id),
      lrNo: String(l.lr_no),
      lrDate: String(l.lr_date_text),
      transportName: (l.transport_name as string | null) ?? null,
      vehicleNo: (l.vehicle_no as string | null) ?? null,
      fileUrl: String(l.file_url),
      fileName: (l.file_name as string | null) ?? null,
      fileType: (l.file_type as string | null) ?? null,
      status: String(l.status),
      duplicateOf: (l.duplicate_of as string | null) ?? null,
      uploadedBy: (l.uploaded_by_name as string) || null,
      uploadedAt: String(l.uploaded_at_text),
      checkedBy: (l.checked_by_name as string) || null,
      checkedAt: (l.checked_at_text as string | null) ?? null,
      rejectReason: (l.reject_reason as string | null) ?? null,
    })),
    can: {
      edit: live && status !== "LOADED" && may(actor, "outward.order.create", wh),
      load: ["READY_FOR_OUTWARD", "LOADING_IN_PROGRESS"].includes(status) && may(actor, "outward.order.update", wh),
      depart: status === "LOADED" && may(actor, "outward.order.approve", wh),
      cancel: live && may(actor, "outward.order.create", wh),
      hold: live && may(actor, "outward.order.create", wh),
      lrUpload: status === "DISPATCHED" && may(actor, "lorry_receipt.create", wh),
      lrCollect: status === "DISPATCHED" && may(actor, "lorry_receipt.update", wh),
      lrVerify: status === "DISPATCHED" && may(actor, "lorry_receipt.approve", wh),
      print: may(actor, "outward.order.export", wh) || may(actor, "outward.order.read", wh),
    },
  };
}

// ── Notifications ─────────────────────────────────────────────────

async function tellDo(eventKey: string, id: number, actor: Actor, meta: Meta, extra: Record<string, string> = {}, subjectUserId?: number | null) {
  try {
    const r = await doBase(id);
    if (!r) return;
    const row = doRow((await getDb().execute<Record<string, unknown>>(sql`${DO_SELECT} where o.id = ${id}`))[0]!);
    await announce({
      eventKey,
      values: {
        id: String(id),
        do: row.doNo,
        dn: row.dnNo,
        buyer: row.buyerName ?? "",
        packages: count(row.packages, "package"),
        cartons: count(row.cartons, "carton"),
        vehicle: row.vehicleNo ?? "",
        transporter: row.transportName ?? "",
        at: fmtDateTime(new Date()),
        lr: "",
        what: "",
        reason: "",
        by: who(actor),
        ...extra,
      },
      dedupeSuffix: `dispatch_order:${id}:${eventKey}:${extra.lr ?? ""}:${subjectUserId ?? 0}:${Date.now()}`,
      actorUserId: actor.session.userId,
      subjectUserId: subjectUserId === undefined ? Number(r.note_created_by) || null : subjectUserId,
      skipActor: true,
      entityType: "dispatch_order",
      entityId: String(id),
      importerId: Number(r.importer_id) || undefined,
      warehouseId: Number(r.warehouse_id),
      correlationId: meta.requestId,
    });
  } catch (error) {
    console.error("[outward] notify failed", eventKey, error);
  }
}

async function audit(actor: Actor, meta: Meta, id: number, action: string, after: Record<string, unknown>, before?: Record<string, unknown>) {
  const r = await doBase(id);
  await auditQuietly({
    action: `outward.${action}`,
    operation: action === "created" ? "INSERT" : "UPDATE",
    entityType: "dispatch_order",
    entityId: String(id),
    entityLabel: r ? String(r.do_no) : undefined,
    before,
    after,
    ...auditBase(actor, meta),
  });
}

async function event(id: number, action: string, detail: string | null, actor: Actor) {
  await getDb().execute(sql`insert into wms.dispatch_order_event (do_id, action, detail, by_user) values (${id}, ${action}, ${detail}, ${actor.session.userId})`);
}

// ── Making a DO ───────────────────────────────────────────────────

export type TransportInput = {
  transporterId?: number | null;
  transportName?: string | null;
  transporterMobile?: string | null;
  transporterGstin?: string | null;
  vehicleId?: number | null;
  vehicleNo?: string | null;
  vehicleType?: string | null;
  driverId?: number | null;
  driverName?: string | null;
  driverMobile?: string | null;
  transportMode?: "ROAD" | "RAIL" | "AIR" | "COURIER" | "HAND" | null;
  remarks?: string | null;
  tallyVoucherNo?: string | null;
};

const clean = (v: unknown, max = 120): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/** Pick a vehicle or driver from the masters: their stored details win over what was typed. */
async function fromMasters(t: TransportInput): Promise<TransportInput> {
  const out: TransportInput = { ...t };
  const db = getDb();
  if (t.transporterId) {
    const x = (await db.execute<{ name: string; phone: string | null; gstin: string | null }>(sql`
      select name, contact_mobile::text as phone, gstin::text as gstin from wms.transporter where id = ${t.transporterId} and deleted_at is null
    `))[0];
    if (!x) throw new InwardError("VALIDATION_FAILED", "Choose the transporter from the list", { transporterId: "Choose the transporter from the list" });
    out.transportName = x.name;
    out.transporterMobile = t.transporterMobile ?? x.phone;
    out.transporterGstin = t.transporterGstin ?? x.gstin;
  }
  if (t.vehicleId) {
    const v = (await db.execute<{ reg: string; type: string | null; transporter_id: number }>(sql`
      select v.registration_number::text as reg, vt.name as type, v.transporter_id from wms.vehicle v left join wms.vehicle_type vt on vt.id = v.vehicle_type_id
       where v.id = ${t.vehicleId} and v.deleted_at is null
    `))[0];
    if (!v) throw new InwardError("VALIDATION_FAILED", "Choose the vehicle from the list", { vehicleId: "Choose the vehicle from the list" });
    out.vehicleNo = v.reg;
    out.vehicleType = v.type;
  }
  if (t.driverId) {
    const d = (await db.execute<{ name: string; mobile: string }>(sql`select name, mobile::text as mobile from wms.driver where id = ${t.driverId} and deleted_at is null`))[0];
    if (!d) throw new InwardError("VALIDATION_FAILED", "Choose the driver from the list", { driverId: "Choose the driver from the list" });
    out.driverName = d.name;
    out.driverMobile = d.mobile;
  }
  if (out.driverMobile && !MOBILE.test(mobileOf(out.driverMobile))) {
    throw new InwardError("VALIDATION_FAILED", "Driver mobile is 10 digits", { driverMobile: "Driver mobile is 10 digits" });
  }
  if (out.transporterMobile && !MOBILE.test(mobileOf(out.transporterMobile))) {
    throw new InwardError("VALIDATION_FAILED", "Transporter mobile is 10 digits", { transporterMobile: "Transporter mobile is 10 digits" });
  }
  if (out.driverMobile) out.driverMobile = mobileOf(out.driverMobile);
  if (out.transporterMobile) out.transporterMobile = mobileOf(out.transporterMobile);
  if (out.vehicleNo) out.vehicleNo = out.vehicleNo.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return out;
}

const SQL_ERRORS: Record<string, string> = {
  NO_NOTE: "No such delivery note",
  NOTE_NOT_APPROVED: "The delivery note is not approved — only approved notes go out",
  NOTE_ON_HOLD: "The delivery note is on hold",
  NOTE_CLOSED: "The delivery note was closed short — nothing more goes out on it",
  NO_PACKAGES: "Choose at least one verified package",
  PACKAGES_NOT_READY: "These packages are not verified or are already on a dispatch order",
  NO_DO: "No such dispatch order",
  ALREADY_DISPATCHED: "This dispatch order has already left",
  NOT_LOADED: "Complete the loading first",
  DO_IN_PROGRESS: "A dispatch order of this note is still being loaded — dispatch or cancel it first",
  CARTON_DISPATCHED: "That carton has already left the warehouse",
  PACKAGE_ON_DO: "That package is on a dispatch order — take it off the dispatch order first",
};

function sqlError(error: unknown): never {
  // drizzle wraps the database error: the RAISE text is on the cause.
  const e = error as { message?: string; cause?: { message?: string } };
  const text = `${e?.message ?? error} ${e?.cause?.message ?? ""}`;
  for (const [key, message] of Object.entries(SQL_ERRORS)) {
    if (text.includes(key)) {
      const detail = text.split(`${key}:`)[1]?.trim();
      throw new InwardError("CONFLICT", detail && key === "PACKAGES_NOT_READY" ? `${message}: ${detail}` : message);
    }
  }
  throw error;
}

export async function createDo(actor: Actor, input: { noteId: number; packageIds?: number[] | null } & TransportInput, meta: Meta): Promise<DoDetail> {
  const scopeOk = (await getDb().execute<{ warehouse_id: number }>(sql`
    select n.warehouse_id from wms.delivery_note n where n.id = ${input.noteId} and ${noteScope(actor)}
  `))[0];
  if (!scopeOk) throw new InwardError("NOT_FOUND", "No such delivery note");
  if (!may(actor, "outward.order.create", Number(scopeOk.warehouse_id))) {
    throw new InwardError("FORBIDDEN", "Only the dispatch manager, warehouse admin or super admin makes dispatch orders.");
  }
  const ids =
    input.packageIds && input.packageIds.length
      ? [...new Set(input.packageIds)]
      : (
          await getDb().execute<{ id: number }>(sql`
            select p.id from wms.delivery_package p
             where p.note_id = ${input.noteId} and p.status = 'VERIFIED'
               and not exists (select 1 from wms.dispatch_order_package dp where dp.package_id = p.id and dp.live)
             order by p.package_no
          `)
        ).map((r) => Number(r.id));
  const t = await fromMasters(input);
  const fy = longFy(fyOf().fy);
  let id: number;
  try {
    id = Number(
      (
        await getDb().execute<{ id: number }>(sql`
          select wms.do_create(${input.noteId}, ${`{${ids.join(",")}}`}::bigint[], ${actor.session.userId}, ${fy}, ${JSON.stringify({
            transporterId: t.transporterId ?? "",
            transportName: clean(t.transportName) ?? "",
            transporterMobile: t.transporterMobile ?? "",
            transporterGstin: clean(t.transporterGstin, 20) ?? "",
            vehicleId: t.vehicleId ?? "",
            vehicleNo: t.vehicleNo ?? "",
            vehicleType: clean(t.vehicleType, 60) ?? "",
            driverId: t.driverId ?? "",
            driverName: clean(t.driverName) ?? "",
            driverMobile: t.driverMobile ?? "",
            transportMode: t.transportMode ?? "",
            remarks: clean(t.remarks, 500) ?? "",
          })}::jsonb) as id
        `)
      )[0]!.id,
    );
  } catch (error) {
    sqlError(error);
  }
  await settle(id, actor, meta);
  await audit(actor, meta, id, "created", { noteId: input.noteId, packages: ids.length });
  return doDetail(actor, id);
}

async function editable(actor: Actor, id: number, permission = "outward.order.create") {
  const r = await visible(actor, id);
  if (!may(actor, permission, Number(r.warehouse_id))) {
    throw new InwardError(
      "FORBIDDEN",
      permission === "outward.order.update"
        ? "Loading is for the dispatch or package manager, warehouse admin or super admin."
        : permission === "outward.order.approve"
          ? "Only the dispatch manager, warehouse admin or super admin confirms departure."
          : "Only the dispatch manager, warehouse admin or super admin changes dispatch orders.",
    );
  }
  return r;
}

export async function updateTransport(actor: Actor, id: number, input: TransportInput, meta: Meta): Promise<DoDetail> {
  const r = await editable(actor, id);
  if (["DISPATCHED", "CANCELLED"].includes(String(r.status))) throw new InwardError("CONFLICT", `This dispatch order is ${String(r.status).toLowerCase()}`);
  const t = await fromMasters(input);
  const sets: SQL[] = [];
  const put = (col: string, v: unknown) => sets.push(sql`${sql.raw(col)} = ${v as string | number | null}`);
  if ("transporterId" in input) put("transporter_id", t.transporterId ?? null);
  if ("transportName" in input || t.transporterId) put("transport_name", clean(t.transportName));
  if ("transporterMobile" in input || t.transporterId) put("transporter_mobile", t.transporterMobile ?? null);
  if ("transporterGstin" in input || t.transporterId) put("transporter_gstin", clean(t.transporterGstin, 20));
  if ("vehicleId" in input) put("vehicle_id", t.vehicleId ?? null);
  if ("vehicleNo" in input || t.vehicleId) put("vehicle_no", t.vehicleNo || null);
  if ("vehicleType" in input || t.vehicleId) put("vehicle_type", clean(t.vehicleType, 60));
  if ("driverId" in input) put("driver_id", t.driverId ?? null);
  if ("driverName" in input || t.driverId) put("driver_name", clean(t.driverName));
  if ("driverMobile" in input || t.driverId) put("driver_mobile", t.driverMobile ?? null);
  if (input.transportMode) put("transport_mode", input.transportMode);
  if ("remarks" in input) put("remarks", clean(input.remarks, 500));
  if ("tallyVoucherNo" in input) put("tally_voucher_no", clean(input.tallyVoucherNo, 40));
  if (!sets.length) return doDetail(actor, id);
  const before = { transport: r.transport_name, vehicle: r.vehicle_no, driver: r.driver_name, driverMobile: r.driver_mobile };
  await getDb().execute(sql`update wms.dispatch_order set ${sql.join(sets, sql`, `)}, updated_at = now() where id = ${id}`);
  const after = (await doBase(id))!;
  await event(id, "TRANSPORT", [after.transport_name, after.vehicle_no, after.driver_name].filter(Boolean).join(" · ") || "Details changed", actor);
  await audit(actor, meta, id, "transport", { transport: after.transport_name, vehicle: after.vehicle_no, driver: after.driver_name, driverMobile: after.driver_mobile }, before);
  await settle(id, actor, meta);
  return doDetail(actor, id);
}

export async function setDoHold(actor: Actor, id: number, on: boolean, reason: string | null, meta: Meta): Promise<DoDetail> {
  const r = await editable(actor, id);
  const status = String(r.status);
  const db = getDb();
  if (on) {
    if (["DISPATCHED", "CANCELLED", "ON_HOLD"].includes(status)) throw new InwardError("CONFLICT", `This dispatch order is ${DO_LABEL[status]?.toLowerCase()}`);
    const why = clean(reason, 300);
    if (!why) throw new InwardError("VALIDATION_FAILED", "Say why it is on hold", { reason: "Say why it is on hold" });
    await db.execute(sql`
      update wms.dispatch_order set status = 'ON_HOLD', hold_from = ${status}, hold_reason = ${why}, hold_by = ${actor.session.userId}, hold_at = now(), updated_at = now()
       where id = ${id}
    `);
    await event(id, "ON_HOLD", why, actor);
    await tellDo("outward.hold", id, actor, meta, { reason: why });
  } else {
    if (status !== "ON_HOLD") return doDetail(actor, id);
    // Back to where it was; the checks run again (a changed note holds it again).
    const back = ["READY_FOR_OUTWARD", "LOADING_IN_PROGRESS", "LOADED", "PENDING_VERIFICATION"].includes(String(r.hold_from)) ? String(r.hold_from) : "PENDING_VERIFICATION";
    await db.execute(sql`
      update wms.dispatch_order set status = ${back}, hold_from = null, hold_reason = null, updated_at = now() where id = ${id}
    `);
    await event(id, "RESUMED", null, actor);
    await settle(id, actor, meta);
  }
  await audit(actor, meta, id, on ? "hold" : "resume", { reason });
  return doDetail(actor, id);
}

export async function cancelDo(actor: Actor, id: number, reason: string, meta: Meta): Promise<DoDetail> {
  await editable(actor, id);
  const why = clean(reason, 300);
  if (!why) throw new InwardError("VALIDATION_FAILED", "Say why it is cancelled", { reason: "Say why it is cancelled" });
  try {
    await getDb().execute(sql`select wms.do_cancel(${id}, ${actor.session.userId}, ${why})`);
  } catch (error) {
    sqlError(error);
  }
  await audit(actor, meta, id, "cancelled", { reason: why });
  return doDetail(actor, id);
}

/** Take a package off a DO before it is loaded (it can go on another DO). */
export async function removePackage(actor: Actor, id: number, packageId: number, meta: Meta): Promise<DoDetail> {
  const r = await editable(actor, id);
  if (!["PENDING_VERIFICATION", "READY_FOR_OUTWARD", "LOADING_IN_PROGRESS", "ON_HOLD"].includes(String(r.status))) {
    throw new InwardError("CONFLICT", `This dispatch order is ${DO_LABEL[String(r.status)]?.toLowerCase()}`);
  }
  const db = getDb();
  const left = (await db.execute<{ n: number }>(sql`select count(*)::int as n from wms.dispatch_order_package where do_id = ${id} and live`))[0]!.n;
  if (left <= 1) throw new InwardError("CONFLICT", "That is the last package — cancel the dispatch order instead");
  const gone = await db.execute<{ code: string }>(sql`
    update wms.dispatch_order_package dp set live = false
      from wms.delivery_package p
     where dp.do_id = ${id} and dp.package_id = ${packageId} and dp.live and dp.loaded_at is null and p.id = dp.package_id
    returning p.code
  `);
  if (!gone[0]) throw new InwardError("CONFLICT", "That package is not on this DO, or it is already loaded");
  await event(id, "PACKAGE_REMOVED", gone[0].code, actor);
  await audit(actor, meta, id, "package_removed", { package: gone[0].code });
  return doDetail(actor, id);
}

// ── Loading ───────────────────────────────────────────────────────

export type LoadAnswer = { result: "OK" | "DUPLICATE" | "REJECTED"; message: string; loaded: number; total: number; status: string };

const PACKAGE_CODE = /\bPK-?(\d{6})\b/i;

export async function loadScan(
  actor: Actor,
  id: number,
  input: { code: string; clientScanId?: string | null; via?: "SCAN" | "MANUAL"; device?: string | null },
  meta: Meta,
): Promise<LoadAnswer> {
  await editable(actor, id, "outward.order.update");
  await settle(id, actor, meta);
  const code = input.code.trim().slice(0, 500);
  const db = getDb();
  let packageId: number | null = null;
  let cartonId: number | null = null;
  const m = PACKAGE_CODE.exec(code);
  if (m) {
    packageId = Number((await db.execute<{ id: number }>(sql`select id from wms.delivery_package where code = ${`PK-${m[1]}`}`))[0]?.id ?? 0) || null;
  } else {
    const no = cartonNoFromScan(code);
    if (no) cartonId = Number((await db.execute<{ id: number }>(sql`select id from wms.inward_carton where carton_no = ${no}`))[0]?.id ?? 0) || null;
  }
  const r = (await db.execute<{ r: { result: LoadAnswer["result"]; message: string; loaded: number; total: number } }>(sql`
    select wms.do_load_scan(${id}, ${packageId}::bigint, ${cartonId}::bigint, ${code}, ${actor.session.userId},
                            ${input.via === "MANUAL" ? "MANUAL" : "SCAN"}, ${input.clientScanId?.slice(0, 80) ?? null},
                            ${input.device?.slice(0, 120) ?? meta.userAgent?.slice(0, 120) ?? null}) as r
  `))[0]!.r;
  const status = String((await doBase(id))!.status);
  return { result: r.result, message: r.message, loaded: Number(r.loaded ?? 0), total: Number(r.total ?? 0), status };
}

export async function loadingComplete(actor: Actor, id: number, meta: Meta): Promise<DoDetail> {
  const r = await editable(actor, id, "outward.order.update");
  if (String(r.status) !== "LOADING_IN_PROGRESS") throw new InwardError("CONFLICT", "Scan the packages onto the vehicle first");
  const done = await getDb().execute<{ id: number }>(sql`
    update wms.dispatch_order set status = 'LOADED', loaded_at = now(), loaded_by = ${actor.session.userId}, updated_at = now()
     where id = ${id} and status = 'LOADING_IN_PROGRESS'
       and not exists (select 1 from wms.dispatch_order_package dp where dp.do_id = ${id} and dp.live and dp.loaded_at is null)
    returning id
  `);
  if (!done[0]) {
    const left = (await getDb().execute<{ n: number }>(sql`select count(*)::int as n from wms.dispatch_order_package where do_id = ${id} and live and loaded_at is null`))[0]!.n;
    throw new InwardError("CONFLICT", `${count(left, "package")} not scanned onto the vehicle yet`);
  }
  await event(id, "LOADED", null, actor);
  await audit(actor, meta, id, "loaded", {});
  return doDetail(actor, id);
}

/** Loaded by mistake — back to loading (nothing has left yet). */
export async function reopenLoading(actor: Actor, id: number, meta: Meta): Promise<DoDetail> {
  const r = await editable(actor, id);
  if (String(r.status) !== "LOADED") throw new InwardError("CONFLICT", "Only a loaded dispatch order can go back to loading");
  await getDb().execute(sql`update wms.dispatch_order set status = 'LOADING_IN_PROGRESS', loaded_at = null, loaded_by = null, updated_at = now() where id = ${id}`);
  await event(id, "LOADING", "Back to loading", actor);
  await audit(actor, meta, id, "reopened", {});
  return doDetail(actor, id);
}

export async function confirmDeparture(actor: Actor, id: number, meta: Meta): Promise<DoDetail> {
  const r = await editable(actor, id, "outward.order.approve");
  const checks = checksOf(r, await packagesOf(id));
  const broken = checks.find((c) => !c.ok);
  if (broken) throw new InwardError("CONFLICT", `Before it can leave: ${broken.label.toLowerCase()} — ${broken.detail}`);
  const before = String(r.note_work_status);
  let cartons = 0;
  try {
    cartons = Number((await getDb().execute<{ n: number }>(sql`select wms.do_depart(${id}, ${actor.session.userId}) as n`))[0]!.n);
  } catch (error) {
    sqlError(error);
  }
  await afterStep(Number(r.note_id), before, actor, meta);
  await audit(actor, meta, id, "dispatched", { cartons });
  await tellDo("outward.dispatched", id, actor, meta);
  await tellDo("outward.lr_collect", id, actor, meta, {}, null);
  return doDetail(actor, id);
}

// ── Close a note short ────────────────────────────────────────────

export async function closeShort(actor: Actor, noteId: number, reason: string, meta: Meta): Promise<{ returned: number }> {
  const n = (await getDb().execute<{ warehouse_id: number; work_status: string; dn_no: string }>(sql`
    select n.warehouse_id, n.work_status, n.dn_no from wms.delivery_note n where n.id = ${noteId} and ${noteScope(actor)}
  `))[0];
  if (!n) throw new InwardError("NOT_FOUND", "No such delivery note");
  if (!may(actor, "outward.short_close.approve", Number(n.warehouse_id))) {
    throw new InwardError("FORBIDDEN", "Only the warehouse admin or super admin closes a delivery note short.");
  }
  const why = clean(reason, 300);
  if (!why) throw new InwardError("VALIDATION_FAILED", "Say why the rest does not go", { reason: "Say why the rest does not go" });
  let returned = 0;
  try {
    returned = Number((await getDb().execute<{ n: number }>(sql`select wms.dn_short_close(${noteId}, ${actor.session.userId}, ${why}) as n`))[0]!.n);
  } catch (error) {
    sqlError(error);
  }
  await afterStep(noteId, String(n.work_status), actor, meta);
  await auditQuietly({
    action: "delivery.short_closed",
    operation: "UPDATE",
    entityType: "delivery_note",
    entityId: String(noteId),
    entityLabel: n.dn_no,
    after: { reason: why, returned },
    ...auditBase(actor, meta),
  });
  if (returned > 0) {
    try {
      await announce({
        eventKey: "delivery.putback",
        values: { id: String(noteId), dn: n.dn_no, returning: count(returned, "carton"), why: "closed short" },
        dedupeSuffix: `delivery_note:${noteId}:short:${Date.now()}`,
        actorUserId: actor.session.userId,
        skipActor: true,
        entityType: "delivery_note",
        entityId: String(noteId),
        warehouseId: Number(n.warehouse_id),
        correlationId: meta.requestId,
      });
    } catch (error) {
      console.error("[outward] putback notify failed", error);
    }
  }
  return { returned };
}

// ── Lorry Receipts ────────────────────────────────────────────────

async function lrStatusRefresh(id: number) {
  // UPLOADED while any LR waits; VERIFIED once every live one is verified; REJECTED if the last answer was a rejection.
  await getDb().execute(sql`
    update wms.dispatch_order o set lr_status = case
        when exists (select 1 from wms.dispatch_lr l where l.do_id = o.id and l.status = 'UPLOADED') then 'UPLOADED'
        when exists (select 1 from wms.dispatch_lr l where l.do_id = o.id and l.status = 'VERIFIED')
             and not exists (select 1 from wms.dispatch_lr l where l.do_id = o.id and l.status in ('UPLOADED','REJECTED')) then 'VERIFIED'
        when exists (select 1 from wms.dispatch_lr l where l.do_id = o.id and l.status = 'REJECTED') then 'REJECTED'
        else (case when o.lr_status in ('COLLECTED','SUBMITTED') then o.lr_status else 'PENDING' end) end,
      updated_at = now()
     where o.id = ${id}
  `);
}

export async function lrStep(actor: Actor, id: number, step: "COLLECTED" | "SUBMITTED", meta: Meta): Promise<DoDetail> {
  const r = await visible(actor, id);
  if (!may(actor, "lorry_receipt.update", Number(r.warehouse_id))) throw new InwardError("FORBIDDEN", "Only the LR collector or the managers mark LRs.");
  if (String(r.status) !== "DISPATCHED") throw new InwardError("CONFLICT", "The LR comes after the vehicle leaves");
  if (["UPLOADED", "VERIFIED"].includes(String(r.lr_status))) throw new InwardError("CONFLICT", "The LR is already attached");
  const db = getDb();
  if (step === "COLLECTED") {
    await db.execute(sql`update wms.dispatch_order set lr_status = 'COLLECTED', lr_collected_by = ${actor.session.userId}, lr_collected_at = now(), updated_at = now() where id = ${id}`);
  } else {
    await db.execute(sql`update wms.dispatch_order set lr_status = 'SUBMITTED', lr_submitted_by = ${actor.session.userId}, lr_submitted_at = now(), updated_at = now() where id = ${id}`);
  }
  await event(id, `LR_${step}`, null, actor);
  await audit(actor, meta, id, `lr_${step.toLowerCase()}`, {});
  return doDetail(actor, id);
}

const LR_MAX = 8 * 1024 * 1024;

export async function attachLr(
  actor: Actor,
  id: number,
  input: { lrNo: string; lrDate: string; fileName: string | null; replacesId: number | null; transportName?: string | null; vehicleNo?: string | null },
  bytes: Uint8Array,
  meta: Meta,
): Promise<DoDetail> {
  const r = await visible(actor, id);
  if (!may(actor, "lorry_receipt.create", Number(r.warehouse_id))) throw new InwardError("FORBIDDEN", "Only the LR collector or the managers attach LRs.");
  if (String(r.status) !== "DISPATCHED") throw new InwardError("CONFLICT", "The LR is attached after the vehicle leaves");
  const lrNo = clean(input.lrNo, 40);
  if (!lrNo) throw new InwardError("VALIDATION_FAILED", "Enter the LR number", { lrNo: "Enter the LR number" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.lrDate)) throw new InwardError("VALIDATION_FAILED", "Enter the LR date", { lrDate: "Enter the LR date" });
  const dispatchedDay = String(r.dispatched_at ?? "").slice(0, 10);
  const today = fyOf().today;
  if (input.lrDate > today) throw new InwardError("VALIDATION_FAILED", "The LR date cannot be in the future", { lrDate: "The LR date cannot be in the future" });
  if (dispatchedDay && input.lrDate < new Date(new Date(dispatchedDay).getTime() - 3 * 86400_000).toISOString().slice(0, 10)) {
    throw new InwardError("VALIDATION_FAILED", "The LR date is long before the vehicle left — check it", { lrDate: "Check the LR date" });
  }
  if (bytes.length === 0) throw new InwardError("VALIDATION_FAILED", "Choose the LR photo or PDF", { file: "Choose the LR photo or PDF" });
  if (bytes.length > LR_MAX) throw new InwardError("VALIDATION_FAILED", "That file is over 8 MB", { file: "That file is over 8 MB" });
  const { type } = sniffDocument(bytes);
  const isPdf = type === "application/pdf";
  const isImage = !isPdf && /^image\//.test(type ?? "");
  if (!isPdf && !isImage) throw new InwardError("VALIDATION_FAILED", "Send a photo or a PDF of the LR", { file: "Send a photo or a PDF of the LR" });
  const sha = createHash("sha256").update(bytes).digest("hex");
  const db = getDb();
  const same = (await db.execute<{ do_no: string }>(sql`
    select o.do_no from wms.dispatch_lr l join wms.dispatch_order o on o.id = l.do_id where l.file_sha256 = ${sha} and l.status <> 'REPLACED' limit 1
  `))[0];
  if (same) throw new InwardError("CONFLICT", `This exact file is already attached to ${same.do_no}`, { file: `Already attached to ${same.do_no}` });
  const dup = (await db.execute<{ do_no: string }>(sql`
    select o.do_no from wms.dispatch_lr l join wms.dispatch_order o on o.id = l.do_id
     where lower(l.lr_no) = lower(${lrNo}) and l.status <> 'REPLACED' and l.do_id <> ${id} limit 1
  `))[0];
  if (!configured()) throw new InwardError("CONFLICT", "File storage is not configured on this environment");
  let body: Uint8Array = bytes;
  let contentType = "application/pdf";
  let ext = "pdf";
  if (isImage) {
    const webp = await toWebp(bytes, 2400);
    if (!webp) throw new InwardError("VALIDATION_FAILED", "That photo could not be read. Take it again.", { file: "Take the photo again" });
    body = webp;
    contentType = "image/webp";
    ext = "webp";
  }
  const key = `lr/${id}/${String(r.do_no).replace(/[^A-Za-z0-9-]+/g, "-")}-${randomBytes(4).toString("hex")}.${ext}`;
  const put = await putObject(key, body, contentType);
  if (!put.ok) throw new InwardError("INTERNAL", "The file could not be stored. Try again.");
  const url = publicUrl(key);
  if (input.replacesId) {
    await db.execute(sql`update wms.dispatch_lr set status = 'REPLACED' where id = ${input.replacesId} and do_id = ${id} and status in ('UPLOADED','REJECTED')`);
  }
  await db.execute(sql`
    insert into wms.dispatch_lr (do_id, lr_no, lr_date, transport_name, vehicle_no, file_url, file_name, file_type, file_bytes, file_sha256,
                                 duplicate_of, replaces_id, uploaded_by)
    values (${id}, ${lrNo}, ${input.lrDate}::date, ${clean(input.transportName) ?? (r.transport_name as string | null)},
            ${clean(input.vehicleNo, 20) ?? (r.vehicle_no as string | null)}, ${url}, ${clean(input.fileName, 120)}, ${contentType}, ${body.length}, ${sha},
            ${dup ? `LR ${lrNo} is also on ${dup.do_no}` : null}, ${input.replacesId}, ${actor.session.userId})
  `);
  await lrStatusRefresh(id);
  await event(id, "LR_UPLOADED", `LR ${lrNo} · ${input.lrDate}${dup ? ` · also on ${dup.do_no}` : ""}`, actor);
  await audit(actor, meta, id, "lr_uploaded", { lrNo, lrDate: input.lrDate, duplicateOf: dup?.do_no ?? null });
  await tellDo("outward.lr_uploaded", id, actor, meta, { lr: lrNo });
  return doDetail(actor, id);
}

export async function checkLr(actor: Actor, id: number, lrId: number, ok: boolean, reason: string | null, meta: Meta): Promise<DoDetail> {
  const r = await visible(actor, id);
  if (!may(actor, "lorry_receipt.approve", Number(r.warehouse_id))) throw new InwardError("FORBIDDEN", "Only the dispatch manager, warehouse admin or super admin verifies LRs.");
  const why = clean(reason, 300);
  if (!ok && !why) throw new InwardError("VALIDATION_FAILED", "Say what needs correcting", { reason: "Say what needs correcting" });
  const lr = (await getDb().execute<{ lr_no: string; uploaded_by: number }>(sql`
    update wms.dispatch_lr set status = ${ok ? "VERIFIED" : "REJECTED"}, checked_by = ${actor.session.userId}, checked_at = now(),
           reject_reason = ${ok ? null : why}
     where id = ${lrId} and do_id = ${id} and status = 'UPLOADED'
    returning lr_no, uploaded_by
  `))[0];
  if (!lr) throw new InwardError("CONFLICT", "That LR was already checked or replaced");
  await lrStatusRefresh(id);
  await event(id, ok ? "LR_VERIFIED" : "LR_REJECTED", ok ? `LR ${lr.lr_no}` : `LR ${lr.lr_no}: ${why}`, actor);
  await audit(actor, meta, id, ok ? "lr_verified" : "lr_rejected", { lrNo: lr.lr_no, reason: why });
  await tellDo("outward.lr_checked", id, actor, meta, { lr: lr.lr_no, what: ok ? "verified" : "rejected — upload it again", reason: ok ? "" : (why ?? "") }, Number(lr.uploaded_by) || null);
  return doDetail(actor, id);
}

// ── Number series ─────────────────────────────────────────────────

export type DoSeries = { prefix: string; separator: string; withYear: boolean; withWarehouse: boolean; padding: number; fy: string; nextNo: number; sample: string; lastNo: string | null };

function sampleOf(s: { prefix: string; separator: string; withYear: boolean; withWarehouse: boolean; padding: number; fy: string; nextNo: number }) {
  return [s.prefix, s.withWarehouse ? "WH-0001" : null, s.withYear ? s.fy : null, String(s.nextNo).padStart(s.padding, "0")].filter(Boolean).join(s.separator);
}

export async function getSeries(): Promise<DoSeries> {
  const fy = longFy(fyOf().fy);
  const r = (await getDb().execute<Record<string, unknown>>(sql`select * from wms.dispatch_series where warehouse_id is null`))[0];
  const s = {
    prefix: String(r?.prefix ?? "DO"),
    separator: String(r?.separator ?? "/"),
    withYear: r ? Boolean(r.with_year) : true,
    withWarehouse: r ? Boolean(r.with_warehouse) : false,
    padding: Number(r?.padding ?? 6),
    fy,
    nextNo: r && String(r.fy) === fy ? Number(r.next_no) : 1,
  };
  const last = (await getDb().execute<{ do_no: string }>(sql`select do_no from wms.dispatch_order order by id desc limit 1`))[0];
  return { ...s, sample: sampleOf(s), lastNo: last?.do_no ?? null };
}

export async function setSeries(
  actor: Actor,
  input: { prefix: string; separator: "/" | "-"; withYear: boolean; withWarehouse: boolean; padding: number; nextNo: number },
  meta: Meta,
): Promise<DoSeries> {
  const g = grantFor(actor, "outward.series.update");
  if (!g || g.scope !== "ALL") throw new InwardError("FORBIDDEN", "Only the super admin sets the dispatch order numbers.");
  const prefix = input.prefix.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,10}$/.test(prefix)) throw new InwardError("VALIDATION_FAILED", "Prefix: letters and numbers only, up to 10", { prefix: "Letters and numbers only" });
  const fy = longFy(fyOf().fy);
  const next = { prefix, separator: input.separator, withYear: input.withYear, withWarehouse: input.withWarehouse, padding: input.padding, fy, nextNo: input.nextNo };
  // Never a number already issued: the sample (with any warehouse code) must be free.
  const taken = (await getDb().execute<{ do_no: string }>(sql`
    select o.do_no from wms.dispatch_order o join wms.warehouse w on w.id = o.warehouse_id
     where o.do_no = ${prefix}
           || case when ${input.withWarehouse} then ${input.separator} || w.code else '' end
           || case when ${input.withYear} then ${input.separator} || ${fy} else '' end
           || ${input.separator} || lpad(${String(input.nextNo)}, ${input.padding}, '0')
     limit 1
  `))[0];
  if (taken) throw new InwardError("CONFLICT", `${taken.do_no} is already used — choose a higher next number`, { nextNo: "Already used" });
  const before = await getSeries();
  await getDb().execute(sql`
    insert into wms.dispatch_series (warehouse_id, prefix, separator, with_year, with_warehouse, padding, fy, next_no, updated_by)
    values (null, ${prefix}, ${input.separator}, ${input.withYear}, ${input.withWarehouse}, ${input.padding}, ${fy}, ${input.nextNo}, ${actor.session.userId})
    on conflict (coalesce(warehouse_id, 0)) do update
      set prefix = excluded.prefix, separator = excluded.separator, with_year = excluded.with_year, with_warehouse = excluded.with_warehouse,
          padding = excluded.padding, fy = excluded.fy, next_no = excluded.next_no, updated_by = excluded.updated_by, updated_at = now()
  `);
  await auditQuietly({
    action: "outward.series.updated",
    operation: "UPDATE",
    entityType: "dispatch_series",
    entityId: "company",
    before: { sample: before.sample },
    after: { sample: sampleOf(next) },
    ...auditBase(actor, meta),
  });
  return getSeries();
}

// ── For the delivery note page ────────────────────────────────────

export type NoteDo = { id: number; doNo: string; status: string; statusLabel: string; lrLabel: string; vehicleNo: string | null; packages: number; cartons: number; dispatchedAt: string | null };

export async function dosOfNote(actor: Actor, noteId: number): Promise<NoteDo[] | null> {
  if (!grantFor(actor, "outward.order.read")) return null;
  const rows = await getDb().execute<Record<string, unknown>>(sql`${DO_SELECT} where o.note_id = ${noteId} and ${noteScope(actor)} order by o.id`);
  return rows.map(doRow).map((d) => ({
    id: d.id,
    doNo: d.doNo,
    status: d.status,
    statusLabel: d.statusLabel,
    lrLabel: d.lrLabel,
    vehicleNo: d.vehicleNo,
    packages: d.packages,
    cartons: d.cartons,
    dispatchedAt: d.dispatchedAt,
  }));
}

/** Transporters, and the vehicles and drivers of one — to pick on a DO. */
export async function transportOptions(transporterId: number | null, q: string | null) {
  const db = getDb();
  const like = `%${(q ?? "").trim().toLowerCase()}%`;
  const transporters = await db.execute<{ id: number; name: string; gstin: string | null; mobile: string | null }>(sql`
    select id, name, gstin::text as gstin, contact_mobile::text as mobile from wms.transporter
     where deleted_at is null ${q ? sql`and lower(name) like ${like}` : sql``}
     order by name limit 30
  `);
  const vehicles = transporterId
    ? await db.execute<{ id: number; reg: string; type: string | null }>(sql`
        select v.id, v.registration_number::text as reg, vt.name as type from wms.vehicle v left join wms.vehicle_type vt on vt.id = v.vehicle_type_id
         where v.transporter_id = ${transporterId} and v.deleted_at is null order by v.registration_number limit 100
      `)
    : [];
  const drivers = transporterId
    ? await db.execute<{ id: number; name: string; mobile: string }>(sql`
        select id, name, mobile::text as mobile from wms.driver where transporter_id = ${transporterId} and deleted_at is null order by name limit 100
      `)
    : [];
  return {
    transporters: transporters.map((t) => ({ id: Number(t.id), name: t.name, gstin: t.gstin, mobile: t.mobile })),
    vehicles: vehicles.map((v) => ({ id: Number(v.id), registration: v.reg, type: v.type })),
    drivers: drivers.map((d) => ({ id: Number(d.id), name: d.name, mobile: d.mobile })),
  };
}

// ── What can go out on a new DO ───────────────────────────────────

export type NewDoData = {
  note: ReadyNote & { transporterMobile: string | null; transporterGstin: string | null; buyerAddress: string | null };
  packages: { id: number; code: string; kind: string; cartons: number; items: string; weightKg: number | null }[];
  otherDos: { id: number; doNo: string; status: string }[];
  nextNo: string;
};

export async function newDoData(actor: Actor, noteId: number): Promise<NewDoData> {
  const db = getDb();
  const r = (await db.execute<Record<string, unknown>>(sql`
    ${READY_SELECT} where n.id = ${noteId} and ${noteScope(actor)}
  `))[0];
  if (!r) throw new InwardError("NOT_FOUND", "No such delivery note");
  if (!may(actor, "outward.order.create", Number(r.warehouse_id))) {
    throw new InwardError("FORBIDDEN", "Only the dispatch manager, warehouse admin or super admin makes dispatch orders.");
  }
  const extra = (await db.execute<Record<string, unknown>>(sql`
    select transporter_mobile, transporter_gstin, buyer_address, status from wms.delivery_note where id = ${noteId}
  `))[0]!;
  const pkgs = await db.execute<Record<string, unknown>>(sql`
    select p.id, p.code, p.kind, p.weight_kg,
           (select count(*) from wms.inward_carton c where c.package_id = p.id)::int as cartons,
           (select string_agg(distinct coalesce(li.item_code || ' · ', '') || li.description, '; ')
              from wms.inward_carton c join wms.inward_request_item li on li.id = c.inward_request_item_id where c.package_id = p.id) as items
      from wms.delivery_package p
     where p.note_id = ${noteId} and p.status = 'VERIFIED'
       and not exists (select 1 from wms.dispatch_order_package dp where dp.package_id = p.id and dp.live)
     order by p.package_no
  `);
  const others = await db.execute<{ id: number; do_no: string; status: string }>(sql`
    select id, do_no, status from wms.dispatch_order where note_id = ${noteId} order by id
  `);
  const series = await getSeries();
  return {
    note: {
      ...readyRow(r),
      transporterMobile: (extra.transporter_mobile as string | null) ?? null,
      transporterGstin: (extra.transporter_gstin as string | null) ?? null,
      buyerAddress: (extra.buyer_address as string | null) ?? null,
    },
    packages: pkgs.map((p) => ({
      id: Number(p.id),
      code: String(p.code),
      kind: String(p.kind),
      cartons: Number(p.cartons),
      items: String(p.items ?? ""),
      weightKg: p.weight_kg === null ? null : Number(p.weight_kg),
    })),
    otherDos: others.map((o) => ({ id: Number(o.id), doNo: o.do_no, status: o.status })),
    nextNo: series.sample,
  };
}
