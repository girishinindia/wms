import "server-only";

import { sql, type SQL } from "drizzle-orm";

import type { Actor } from "@/lib/auth/guard";

import { agentWhere, impWhere, inPeriod, lensFor, scopeWhere, staffLens, whWhere, type Filters, type Lens, type LensKind } from "./lens";
import type { Column, ReportMeta, StatusOption } from "./report-types";

/**
 * Every report: who may open it (its lens), what it shows (columns) and
 * the one query that answers it. The query always applies the lens, so a
 * person can never read another warehouse's or importer's rows — whatever
 * the filters say.
 */
export type ReportDef = Omit<ReportMeta, "statuses" | "warehouse" | "importer"> & {
  statuses?: StatusOption[];
  warehouse?: boolean;
  importer?: boolean;
  lens: (actor: Actor) => Lens | null;
  query: (lens: Lens, f: Filters) => SQL;
};

// ── Access ────────────────────────────────────────────────────────

const staff = (...perms: string[]) => (a: Actor) => staffLens(a, perms);
const own = (perm: string, kinds: LensKind[]) => (a: Actor) => lensFor(a, perm, kinds);
const first =
  (...fns: ((a: Actor) => Lens | null)[]) =>
  (a: Actor) => {
    for (const fn of fns) {
      const l = fn(a);
      if (l) return l;
    }
    return null;
  };
const ALLK: LensKind[] = ["all", "warehouse", "importer", "agent"];
const STAFFK: LensKind[] = ["all", "warehouse"];

// ── SQL helpers ───────────────────────────────────────────────────

const who = (col: SQL) => sql`(select nullif(trim(u.first_name || ' ' || coalesce(u.last_name, '')), '') from wms.users u where u.id = ${col})`;
const ist = (col: SQL) => sql`to_char(${col} at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')`;
const day = (col: SQL) => sql`to_char(${col}, 'YYYY-MM-DD')`;
const hours = (a: SQL, b: SQL) => sql`round((extract(epoch from (${b} - ${a})) / 3600)::numeric, 1)`;
const status = (f: Filters, col: SQL) => (f.extra.status ? sql`${col} = ${f.extra.status}` : sql`true`);
const CW = (lens: Lens, f: Filters) => scopeWhere(lens, f, sql`r.warehouse_id`, sql`r.importer_id`);
const NW = (lens: Lens, f: Filters) => sql`${scopeWhere(lens, f, sql`n.warehouse_id`, sql`n.importer_id`)} and ${agentWhere(lens, sql`n.created_by`)}`;
const OW = (lens: Lens, f: Filters) =>
  sql`${scopeWhere(lens, f, sql`o.warehouse_id`, sql`o.importer_id`)} and ${lens.kind === "agent" ? sql`exists (select 1 from wms.delivery_note an where an.id = o.note_id and an.created_by = ${lens.userId})` : sql`true`}`;
const KEY = sql`wms.stock_key(li.item_id, li.description, li.pieces_per_carton)`;
const word = (col: SQL, map: Record<string, string>) =>
  sql`case ${col} ${sql.join(Object.entries(map).map(([k, v]) => sql`when ${k} then ${v}`), sql` `)} else ${col}::text end`;

const INWARD_STATUS: Record<string, string> = { DRAFT: "Draft", SUBMITTED: "Submitted", NEEDS_CHANGES: "Needs changes", ACKNOWLEDGED: "Acknowledged", IN_PROCESS: "In process", COMPLETED: "Completed", CANCELLED: "Cancelled" };
const NOTE_STATUS: Record<string, string> = { PENDING: "Waiting approval", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled" };
const WORK: Record<string, string> = { NEW: "New", ASSIGNED: "Assigned", PARTIALLY_PICKED: "Picking", PICKED: "Picked", PACKAGING_IN_PROGRESS: "Packing", PARTIALLY_PACKAGED: "Partly packed", PACKAGED: "Packed", VERIFICATION_PENDING: "Verifying", READY_FOR_DISPATCH: "Ready for outward", PARTIALLY_DISPATCHED: "Partly dispatched", DISPATCHED: "Dispatched", RETURNING: "Put back to storage", CANCELLED: "Closed" };
const DO_STATUS: Record<string, string> = { DRAFT: "Draft", PENDING_VERIFICATION: "Needs details", READY_FOR_OUTWARD: "Ready to load", LOADING_IN_PROGRESS: "Loading", LOADED: "Loaded", DISPATCHED: "Dispatched", ON_HOLD: "On hold", CANCELLED: "Cancelled" };
const LR_STATUS: Record<string, string> = { NOT_DUE: "—", PENDING: "Pending", COLLECTED: "Collected", SUBMITTED: "With manager", UPLOADED: "Attached", VERIFIED: "Verified", REJECTED: "Rejected", REPLACED: "Replaced" };
const EXP_STATUS: Record<string, string> = { PENDING: "Waiting", APPROVED: "Approved", REJECTED: "Rejected" };
const opts = (m: Record<string, string>, only?: string[]): StatusOption[] => Object.entries(m).filter(([k]) => !only || only.includes(k)).map(([value, label]) => ({ value, label }));

const c = (key: string, label: string, type: Column["type"] = "text", total = false): Column => ({ key, label, type, total });

// ── The catalogue ─────────────────────────────────────────────────

export const REPORTS: ReportDef[] = [
  // ── Inward ──
  {
    key: "inward-register",
    no: "R1",
    group: "Inward",
    title: "Inward register",
    description: "Every inward request in the period, with cartons expected, received and on hold.",
    period: true,
    statuses: opts(INWARD_STATUS),
    lens: own("inward.request.read", ALLK),
    columns: [c("code", "Request"), c("submitted", "Submitted", "datetime"), c("importer", "Importer"), c("warehouse", "Warehouse"), c("container", "Container"), c("port", "Port"), c("expected", "Expected", "date"), c("status", "Status"), c("lines", "Items", "int", true), c("expected_ctn", "Cartons expected", "int", true), c("received", "Received", "int", true), c("hold", "On hold", "int", true), c("difference", "Difference", "int", true), c("completed", "Completed", "datetime")],
    query: (l, f) => sql`
      select r.code, ${ist(sql`r.submitted_at`)} as submitted, i.company_name as importer, w.name as warehouse, r.container_number as container, p.name as port,
             ${day(sql`r.expected_arrival`)} as expected, ${word(sql`r.status`, INWARD_STATUS)} as status,
             (select count(*) from wms.inward_request_item li where li.inward_request_id = r.id)::int as lines,
             (select coalesce(sum(li.carton_qty), 0) from wms.inward_request_item li where li.inward_request_id = r.id)::int as expected_ctn,
             (select count(*) from wms.inward_carton c where c.inward_request_id = r.id and c.received_at is not null)::int as received,
             (select count(*) from wms.inward_carton c where c.inward_request_id = r.id and c.status = 'HOLD')::int as hold,
             ((select count(*) from wms.inward_carton c where c.inward_request_id = r.id and c.received_at is not null)
               - (select coalesce(sum(li.carton_qty), 0) from wms.inward_request_item li where li.inward_request_id = r.id))::int as difference,
             ${ist(sql`r.completed_at`)} as completed
        from wms.inward_request r join wms.importer i on i.id = r.importer_id join wms.warehouse w on w.id = r.warehouse_id left join wms.port p on p.id = r.port_id
       where ${CW(l, f)} and r.deleted_at is null and r.status <> 'DRAFT' and ${inPeriod(f, sql`coalesce(r.submitted_at, r.created_at)`)} and ${status(f, sql`r.status`)}
       order by coalesce(r.submitted_at, r.created_at) desc`,
  },
  {
    key: "inward-items",
    no: "R2",
    group: "Inward",
    title: "Item-wise inward",
    description: "Cartons, pieces and weight received per item in the period.",
    period: true,
    lens: own("inward.request.read", ALLK),
    columns: [c("item_code", "Item code"), c("description", "Description"), c("importer", "Importer"), c("unit", "Unit"), c("cartons", "Cartons", "int", true), c("pieces", "Pieces", "int", true), c("kg", "Kg", "num", true), c("requests", "Requests", "int")],
    query: (l, f) => sql`
      select li.item_code, li.description, i.company_name as importer, li.unit_code as unit, count(*)::int as cartons,
             sum(li.pieces_per_carton)::int as pieces, round(coalesce(sum(li.kg_per_carton), 0)::numeric, 2) as kg, count(distinct r.id)::int as requests
        from wms.inward_carton c join wms.inward_request r on r.id = c.inward_request_id join wms.inward_request_item li on li.id = c.inward_request_item_id
        join wms.importer i on i.id = r.importer_id
       where ${CW(l, f)} and ${inPeriod(f, sql`c.received_at`)}
       group by li.item_code, li.description, i.company_name, li.unit_code order by cartons desc`,
  },
  {
    key: "carton-receipts",
    no: "R3",
    group: "Inward",
    title: "Carton receipt log",
    description: "Each carton received at the dock: when, by whom, scanned or typed.",
    period: true,
    lens: own("inward.request.read", ALLK),
    columns: [c("carton", "Carton"), c("request", "Request"), c("importer", "Importer"), c("item", "Item"), c("received", "Received", "datetime"), c("by", "By"), c("via", "How"), c("status", "Now")],
    query: (l, f) => sql`
      select c.carton_no as carton, r.code as request, i.company_name as importer, coalesce(li.item_code || ' · ', '') || li.description as item,
             ${ist(sql`c.received_at`)} as received, ${who(sql`c.received_by`)} as by,
             case c.received_via when 'SCAN' then 'Scanned' when 'MANUAL' then 'Typed' else c.received_via end as via,
             case when c.status = 'HOLD' then 'On hold' when c.status = 'DISPATCHED' then 'Dispatched' when c.area = 'PACKING' then 'Picked'
                  when c.gala_id is not null then 'In gala' else 'At dock' end as status
        from wms.inward_carton c join wms.inward_request r on r.id = c.inward_request_id join wms.inward_request_item li on li.id = c.inward_request_item_id
        join wms.importer i on i.id = r.importer_id
       where ${CW(l, f)} and ${inPeriod(f, sql`c.received_at`)} order by c.received_at desc`,
  },
  {
    key: "holds",
    no: "R4",
    group: "Inward",
    title: "Cartons on hold",
    description: "Cartons held at the dock now, with the reason, note and photo.",
    period: false,
    lens: own("inward.goods.read", ALLK),
    columns: [c("carton", "Carton"), c("request", "Request"), c("importer", "Importer"), c("item", "Item"), c("reason", "Reason"), c("note", "Note"), c("held", "Held", "datetime"), c("by", "By"), c("days", "Days on hold", "days"), c("photo", "Photo")],
    query: (l, f) => sql`
      select c.carton_no as carton, r.code as request, i.company_name as importer, coalesce(li.item_code || ' · ', '') || li.description as item,
             c.hold_reason as reason, c.hold_note as note, ${ist(sql`c.hold_at`)} as held, ${who(sql`c.hold_by`)} as by,
             floor(extract(epoch from (now() - c.hold_at)) / 86400)::int as days, c.hold_photo_url as photo
        from wms.inward_carton c join wms.inward_request r on r.id = c.inward_request_id join wms.inward_request_item li on li.id = c.inward_request_item_id
        join wms.importer i on i.id = r.importer_id
       where ${CW(l, f)} and c.status = 'HOLD' order by c.hold_at`,
  },
  {
    key: "pending-arrivals",
    no: "R5",
    group: "Inward",
    title: "Pending arrivals",
    description: "Requests not complete yet, with the expected date and days late.",
    period: false,
    lens: own("inward.request.read", ALLK),
    columns: [c("code", "Request"), c("importer", "Importer"), c("warehouse", "Warehouse"), c("container", "Container"), c("expected", "Expected", "date"), c("late", "Days late", "days"), c("status", "Status"), c("expected_ctn", "Cartons expected", "int", true), c("received", "Received", "int", true)],
    query: (l, f) => sql`
      select r.code, i.company_name as importer, w.name as warehouse, r.container_number as container, ${day(sql`r.expected_arrival`)} as expected,
             greatest((current_date - r.expected_arrival), 0)::int as late, ${word(sql`r.status`, INWARD_STATUS)} as status,
             (select coalesce(sum(li.carton_qty), 0) from wms.inward_request_item li where li.inward_request_id = r.id)::int as expected_ctn,
             (select count(*) from wms.inward_carton c where c.inward_request_id = r.id and c.received_at is not null)::int as received
        from wms.inward_request r join wms.importer i on i.id = r.importer_id join wms.warehouse w on w.id = r.warehouse_id
       where ${CW(l, f)} and r.deleted_at is null and r.status in ('SUBMITTED','NEEDS_CHANGES','ACKNOWLEDGED','IN_PROCESS')
       order by r.expected_arrival nulls last`,
  },

  // ── Stock ──
  {
    key: "stock-summary",
    no: "R6",
    group: "Stock",
    title: "Stock summary",
    description: "Cartons in stock now per importer, warehouse and item — kept for notes and free.",
    period: false,
    lens: first(own("storage.goods.read", ALLK), staff("inward.goods.read")),
    columns: [c("importer", "Importer"), c("warehouse", "Warehouse"), c("item_code", "Item code"), c("description", "Description"), c("unit", "Unit"), c("ppc", "Pcs / carton", "int"), c("stock", "Cartons in stock", "int", true), c("pieces", "Pieces", "int", true), c("kg", "Kg", "num", true), c("picked", "Picked", "int", true), c("kept", "Kept for notes", "int", true), c("free", "Free", "int", true), c("hold", "On hold", "int", true)],
    query: (l, f) => sql`
      with s as (
        select r.importer_id, r.warehouse_id, ${KEY} as k, max(li.item_code) as item_code, max(li.description) as description, max(li.unit_code) as unit,
               max(li.pieces_per_carton) as ppc, max(li.kg_per_carton) as kgpc,
               count(*) filter (where c.status = 'RECEIVED') as stock, count(*) filter (where c.status = 'RECEIVED' and c.area = 'PACKING') as picked,
               count(*) filter (where c.status = 'HOLD') as hold
          from wms.inward_carton c join wms.inward_request r on r.id = c.inward_request_id join wms.inward_request_item li on li.id = c.inward_request_item_id
         where ${CW(l, f)} and c.status in ('RECEIVED','HOLD') group by 1, 2, 3),
      kept as (
        select dl.importer_id, dl.warehouse_id, dl.stock_key as k, sum(greatest(dl.cartons - dl.dispatched_cartons - dl.short_cartons, 0)) as n
          from wms.delivery_line dl join wms.delivery_note n on n.id = dl.delivery_note_id
         where n.status in ('PENDING','APPROVED') group by 1, 2, 3)
      select i.company_name as importer, w.name as warehouse, s.item_code, s.description, s.unit, s.ppc::int, s.stock::int,
             (s.stock * s.ppc)::int as pieces, round(coalesce(s.stock * s.kgpc, 0)::numeric, 2) as kg, s.picked::int,
             coalesce(kept.n, 0)::int as kept, greatest(s.stock - coalesce(kept.n, 0), 0)::int as free, s.hold::int
        from s join wms.importer i on i.id = s.importer_id join wms.warehouse w on w.id = s.warehouse_id
        left join kept on kept.importer_id = s.importer_id and kept.warehouse_id = s.warehouse_id and kept.k = s.k
       order by i.company_name, w.name, s.item_code nulls last, s.description`,
  },
  {
    key: "stock-ledger",
    no: "R7",
    group: "Stock",
    title: "Stock ledger",
    description: "Per item: cartons at the start, received, dispatched, and at the end of the period.",
    period: true,
    lens: first(own("storage.goods.read", ALLK), staff("inward.goods.read")),
    columns: [c("importer", "Importer"), c("warehouse", "Warehouse"), c("item_code", "Item code"), c("description", "Description"), c("opening", "Opening", "int", true), c("inward", "In", "int", true), c("outward", "Out", "int", true), c("closing", "Closing", "int", true)],
    query: (l, f) => {
      const start = sql`(${f.from}::date)::timestamp at time zone 'Asia/Kolkata'`;
      const end = sql`(${f.to}::date + 1)::timestamp at time zone 'Asia/Kolkata'`;
      return sql`
        select i.company_name as importer, w.name as warehouse, max(li.item_code) as item_code, max(li.description) as description,
               count(*) filter (where c.received_at < ${start} and (c.dispatched_at is null or c.dispatched_at >= ${start}))::int as opening,
               count(*) filter (where c.received_at >= ${start} and c.received_at < ${end})::int as inward,
               count(*) filter (where c.dispatched_at >= ${start} and c.dispatched_at < ${end})::int as outward,
               count(*) filter (where c.received_at < ${end} and (c.dispatched_at is null or c.dispatched_at >= ${end}))::int as closing
          from wms.inward_carton c join wms.inward_request r on r.id = c.inward_request_id join wms.inward_request_item li on li.id = c.inward_request_item_id
          join wms.importer i on i.id = r.importer_id join wms.warehouse w on w.id = r.warehouse_id
         where ${CW(l, f)} and c.received_at is not null and c.received_at < ${end}
         group by i.company_name, w.name, ${KEY}
        having count(*) filter (where c.received_at < ${end} and (c.dispatched_at is null or c.dispatched_at >= ${start})) > 0
         order by 1, 2, 3 nulls last, 4`;
    },
  },
  {
    key: "stock-ageing",
    no: "R8",
    group: "Stock",
    title: "Stock ageing",
    description: "Cartons in stock by how long they have been in the warehouse.",
    period: false,
    lens: first(own("storage.goods.read", ALLK), staff("inward.goods.read")),
    columns: [c("importer", "Importer"), c("warehouse", "Warehouse"), c("item_code", "Item code"), c("description", "Description"), c("d30", "0–30 days", "int", true), c("d60", "31–60 days", "int", true), c("d90", "61–90 days", "int", true), c("d90p", "90+ days", "int", true), c("total", "Total", "int", true), c("oldest", "Oldest received", "date")],
    query: (l, f) => sql`
      select i.company_name as importer, w.name as warehouse, max(li.item_code) as item_code, max(li.description) as description,
             count(*) filter (where c.received_at > now() - interval '30 days')::int as d30,
             count(*) filter (where c.received_at <= now() - interval '30 days' and c.received_at > now() - interval '60 days')::int as d60,
             count(*) filter (where c.received_at <= now() - interval '60 days' and c.received_at > now() - interval '90 days')::int as d90,
             count(*) filter (where c.received_at <= now() - interval '90 days')::int as d90p,
             count(*)::int as total, to_char(min(c.received_at) at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as oldest
        from wms.inward_carton c join wms.inward_request r on r.id = c.inward_request_id join wms.inward_request_item li on li.id = c.inward_request_item_id
        join wms.importer i on i.id = r.importer_id join wms.warehouse w on w.id = r.warehouse_id
       where ${CW(l, f)} and c.status = 'RECEIVED'
       group by i.company_name, w.name, ${KEY} order by min(c.received_at)`,
  },
  {
    key: "gala-stock",
    no: "R9",
    group: "Stock",
    title: "Gala-wise location",
    description: "What is in each gala now: importer, item and cartons.",
    period: false,
    lens: staff("storage.goods.read"),
    columns: [c("warehouse", "Warehouse"), c("floor", "Floor"), c("gala", "Gala"), c("importer", "Importer"), c("item_code", "Item code"), c("description", "Description"), c("cartons", "Cartons", "int", true)],
    query: (l, f) => sql`
      select w.name as warehouse, coalesce(fl.name, 'Floor ' || fl.floor_no) as floor, gl.code as gala, i.company_name as importer,
             max(li.item_code) as item_code, max(li.description) as description, count(*)::int as cartons
        from wms.inward_carton c join wms.inward_request r on r.id = c.inward_request_id join wms.inward_request_item li on li.id = c.inward_request_item_id
        join wms.importer i on i.id = r.importer_id join wms.warehouse_gala gl on gl.id = c.gala_id join wms.warehouse_floor fl on fl.id = gl.floor_id
        join wms.warehouse w on w.id = gl.warehouse_id
       where ${CW(l, f)} and c.status = 'RECEIVED' and c.area is null
       group by w.name, fl.name, fl.floor_no, gl.code, gl.gala_no, i.company_name, ${KEY}
       order by w.name, fl.floor_no, gl.gala_no, i.company_name`,
  },
  {
    key: "carton-movements",
    no: "R10",
    group: "Stock",
    title: "Carton movement history",
    description: "Every store, move, pick, put-back and dispatch of a carton in the period.",
    period: true,
    lens: staff("storage.goods.read"),
    columns: [c("at", "When", "datetime"), c("carton", "Carton"), c("importer", "Importer"), c("action", "Action"), c("from", "From"), c("to", "To"), c("note", "Delivery note"), c("by", "By")],
    query: (l, f) => sql`
      select ${ist(sql`m.moved_at`)} as at, c.carton_no as carton, i.company_name as importer,
             ${word(sql`m.action`, { STORED: "Stored", MOVED: "Moved", PICKED: "Picked", RETURNED: "Put back", RESTORED: "Stored again", DISPATCHED: "Dispatched" })} as action,
             coalesce(gf.code, case m.from_area when 'PACKING' then 'Packing area' when 'RETURN' then 'Put-back shelf' else m.from_area end, 'Dock') as from,
             coalesce(gt.code, case m.to_area when 'PACKING' then 'Packing area' when 'RETURN' then 'Put-back shelf' when 'OUT' then 'Left the warehouse' else m.to_area end) as to,
             n.dn_no as note, ${who(sql`m.moved_by`)} as by
        from wms.carton_movement m join wms.inward_carton c on c.id = m.carton_id join wms.inward_request r on r.id = c.inward_request_id
        join wms.importer i on i.id = r.importer_id left join wms.warehouse_gala gf on gf.id = m.from_gala_id left join wms.warehouse_gala gt on gt.id = m.to_gala_id
        left join wms.delivery_note n on n.id = m.delivery_note_id
       where ${CW(l, f)} and ${inPeriod(f, sql`m.moved_at`)} order by m.moved_at desc`,
  },

  // ── Storage billing ──
  {
    key: "carton-days",
    no: "R11",
    group: "Storage billing",
    title: "Carton-days per importer",
    description: "For billing: carton-days, average and peak cartons, received and dispatched — per importer, warehouse and month.",
    period: true,
    lens: first(staff("inward.goods.read", "outward.order.read"), own("inward.request.read", ["importer"])),
    columns: [c("month", "Month"), c("importer", "Importer"), c("warehouse", "Warehouse"), c("carton_days", "Carton-days", "int", true), c("avg", "Average cartons", "num"), c("peak", "Peak cartons", "int"), c("received", "Received", "int", true), c("dispatched", "Dispatched", "int", true)],
    query: (l, f) => sql`
      with days as (select d::date as d from generate_series(${f.from}::date, ${f.to}::date, interval '1 day') d),
      ct as (
        select r.importer_id, r.warehouse_id, (c.received_at at time zone 'Asia/Kolkata')::date as a,
               coalesce((c.dispatched_at at time zone 'Asia/Kolkata')::date, ${f.to}::date + 1) as b, c.received_at, c.dispatched_at
          from wms.inward_carton c join wms.inward_request r on r.id = c.inward_request_id
         where ${CW(l, f)} and c.received_at is not null and c.received_at < (${f.to}::date + 1)::timestamp at time zone 'Asia/Kolkata'
           and (c.dispatched_at is null or c.dispatched_at >= (${f.from}::date)::timestamp at time zone 'Asia/Kolkata')),
      daily as (
        select ct.importer_id, ct.warehouse_id, d.d, count(*) as n from ct join days d on d.d >= ct.a and d.d < ct.b group by 1, 2, 3),
      monthly as (
        select importer_id, warehouse_id, to_char(d, 'YYYY-MM') as m, sum(n) as cd, round(sum(n)::numeric / count(*), 1) as avg, max(n) as peak
          from daily group by 1, 2, 3),
      flows as (
        select importer_id, warehouse_id, to_char(received_at at time zone 'Asia/Kolkata', 'YYYY-MM') as m, count(*) filter (where received_at >= (${f.from}::date)::timestamp at time zone 'Asia/Kolkata') as rec, 0 as out from ct group by 1, 2, 3
        union all
        select importer_id, warehouse_id, to_char(dispatched_at at time zone 'Asia/Kolkata', 'YYYY-MM'), 0, count(*) from ct
         where dispatched_at is not null and dispatched_at < (${f.to}::date + 1)::timestamp at time zone 'Asia/Kolkata' group by 1, 2, 3)
      select mo.m as month, i.company_name as importer, w.name as warehouse, mo.cd::int as carton_days, mo.avg, mo.peak::int as peak,
             coalesce((select sum(rec) from flows fl where fl.importer_id = mo.importer_id and fl.warehouse_id = mo.warehouse_id and fl.m = mo.m), 0)::int as received,
             coalesce((select sum(out) from flows fl where fl.importer_id = mo.importer_id and fl.warehouse_id = mo.warehouse_id and fl.m = mo.m), 0)::int as dispatched
        from monthly mo join wms.importer i on i.id = mo.importer_id join wms.warehouse w on w.id = mo.warehouse_id
       order by mo.m, i.company_name, w.name`,
  },
  {
    key: "space-used",
    no: "R12",
    group: "Storage billing",
    title: "Space used per importer",
    description: "Galas holding each importer's cartons now, and their share of the warehouse.",
    period: false,
    lens: first(staff("storage.goods.read", "outward.order.read"), own("inward.request.read", ["importer"])),
    columns: [c("importer", "Importer"), c("warehouse", "Warehouse"), c("galas", "Galas used", "int", true), c("shared", "Shared with others", "int"), c("cartons", "Cartons in galas", "int", true), c("share", "Share of galas", "pct")],
    query: (l, f) => sql`
      with g as (
        select r.importer_id, gl.warehouse_id, c.gala_id, count(*) as n
          from wms.inward_carton c join wms.inward_request r on r.id = c.inward_request_id join wms.warehouse_gala gl on gl.id = c.gala_id
         where ${CW(l, f)} and c.status = 'RECEIVED' and c.area is null group by 1, 2, 3),
      owners as (select gala_id, count(distinct importer_id) as k from wms.inward_carton c join wms.inward_request r on r.id = c.inward_request_id
                  where c.status = 'RECEIVED' and c.area is null and c.gala_id is not null group by 1)
      select i.company_name as importer, w.name as warehouse, count(*)::int as galas, count(*) filter (where o.k > 1)::int as shared, sum(g.n)::int as cartons,
             round(100.0 * count(*) / nullif((select count(*) from wms.warehouse_gala x where x.warehouse_id = g.warehouse_id and x.deleted_at is null and x.is_active), 0), 1) as share
        from g join owners o on o.gala_id = g.gala_id join wms.importer i on i.id = g.importer_id join wms.warehouse w on w.id = g.warehouse_id
       group by i.company_name, w.name, g.warehouse_id order by galas desc`,
  },

  // ── Delivery notes ──
  {
    key: "note-register",
    no: "R13",
    group: "Delivery notes",
    title: "Delivery note register",
    description: "Every delivery note in the period: buyer, cartons, approval and where it is in the warehouse.",
    period: true,
    statuses: opts(NOTE_STATUS),
    lens: own("dispatch.order.read", ALLK),
    columns: [c("dn", "Note"), c("date", "Date", "date"), c("order_no", "Order"), c("importer", "Importer"), c("made_by", "Made by"), c("buyer", "Buyer"), c("city", "City"), c("status", "Status"), c("cartons", "Cartons", "int", true), c("dispatched", "Dispatched", "int", true), c("short", "Closed short", "int", true), c("approved_by", "Approved by"), c("approved", "Approved", "datetime"), c("step", "Warehouse step")],
    query: (l, f) => sql`
      select n.dn_no as dn, ${day(sql`n.dn_date`)} as date, n.order_no, i.company_name as importer, ${who(sql`n.created_by`)} as made_by, n.buyer_name as buyer, n.buyer_city as city,
             ${word(sql`n.status`, NOTE_STATUS)} as status,
             (select coalesce(sum(dl.cartons), 0) from wms.delivery_line dl where dl.delivery_note_id = n.id)::int as cartons,
             (select coalesce(sum(dl.dispatched_cartons), 0) from wms.delivery_line dl where dl.delivery_note_id = n.id)::int as dispatched,
             (select coalesce(sum(dl.short_cartons), 0) from wms.delivery_line dl where dl.delivery_note_id = n.id)::int as short,
             ${who(sql`n.approved_by`)} as approved_by, ${ist(sql`n.approved_at`)} as approved, ${word(sql`n.work_status`, WORK)} as step
        from wms.delivery_note n join wms.importer i on i.id = n.importer_id
       where ${NW(l, f)} and n.dn_date between ${f.from}::date and ${f.to}::date and ${status(f, sql`n.status`)}
       order by n.dn_date desc, n.id desc`,
  },
  {
    key: "note-items",
    no: "R14",
    group: "Delivery notes",
    title: "Item-wise delivery",
    description: "Cartons and pieces asked for per item and buyer on notes in the period.",
    period: true,
    lens: own("dispatch.order.read", ALLK),
    columns: [c("item_code", "Item code"), c("description", "Description"), c("importer", "Importer"), c("buyer", "Buyer"), c("cartons", "Cartons", "int", true), c("pieces", "Pieces", "int", true), c("dispatched", "Dispatched", "int", true), c("notes", "Notes", "int")],
    query: (l, f) => sql`
      select dl.item_code, dl.description, i.company_name as importer, n.buyer_name as buyer, sum(dl.cartons)::int as cartons,
             sum(dl.cartons * dl.pieces_per_carton)::int as pieces, sum(dl.dispatched_cartons)::int as dispatched, count(distinct n.id)::int as notes
        from wms.delivery_line dl join wms.delivery_note n on n.id = dl.delivery_note_id join wms.importer i on i.id = n.importer_id
       where ${NW(l, f)} and n.status in ('PENDING','APPROVED') and n.dn_date between ${f.from}::date and ${f.to}::date
       group by 1, 2, 3, 4 order by cartons desc`,
  },
  {
    key: "approvals",
    no: "R15",
    group: "Delivery notes",
    title: "Approval report",
    description: "How long each note waited for approval, who decided and how.",
    period: true,
    statuses: opts(NOTE_STATUS),
    lens: own("dispatch.order.read", ALLK),
    columns: [c("dn", "Note"), c("made", "Made", "datetime"), c("made_by", "Made by"), c("importer", "Importer"), c("status", "Status"), c("kind", "How"), c("decided_by", "Decided by"), c("decided", "Decided", "datetime"), c("hours", "Hours to decide", "hours"), c("confirmed_with", "Confirmed with")],
    query: (l, f) => sql`
      select n.dn_no as dn, ${ist(sql`n.created_at`)} as made, ${who(sql`n.created_by`)} as made_by, i.company_name as importer, ${word(sql`n.status`, NOTE_STATUS)} as status,
             ${word(sql`n.approval_kind`, { IMPORTER: "By the importer", IMPORTER_EDIT: "Changed and approved by the importer", IMPORTER_CREATED: "Made by the importer", AUTO: "Auto (trusted agent)", CONFIRMED: "Admin, on the importer's word" })} as kind,
             coalesce(${who(sql`n.approved_by`)}, ${who(sql`n.rejected_by`)}) as decided_by, ${ist(sql`coalesce(n.approved_at, n.rejected_at)`)} as decided,
             case when coalesce(n.approved_at, n.rejected_at) is not null then ${hours(sql`n.created_at`, sql`coalesce(n.approved_at, n.rejected_at)`)} end as hours,
             n.confirm_person as confirmed_with
        from wms.delivery_note n join wms.importer i on i.id = n.importer_id
       where ${NW(l, f)} and ${inPeriod(f, sql`n.created_at`)} and ${status(f, sql`n.status`)} order by n.created_at desc`,
  },
  {
    key: "short-closed",
    no: "R16",
    group: "Delivery notes",
    title: "Short-closed and cancelled notes",
    description: "Notes closed short, cancelled or rejected in the period, and what did not go.",
    period: true,
    lens: own("dispatch.order.read", ALLK),
    columns: [c("dn", "Note"), c("importer", "Importer"), c("buyer", "Buyer"), c("what", "What happened"), c("asked", "Cartons asked", "int", true), c("sent", "Dispatched", "int", true), c("not_sent", "Not sent", "int", true), c("reason", "Reason"), c("by", "By"), c("at", "When", "datetime")],
    query: (l, f) => sql`
      select n.dn_no as dn, i.company_name as importer, n.buyer_name as buyer,
             case when n.short_closed_at is not null then 'Closed short' when n.status = 'CANCELLED' then 'Cancelled' else 'Rejected' end as what,
             (select coalesce(sum(dl.cartons), 0) from wms.delivery_line dl where dl.delivery_note_id = n.id)::int as asked,
             (select coalesce(sum(dl.dispatched_cartons), 0) from wms.delivery_line dl where dl.delivery_note_id = n.id)::int as sent,
             (select coalesce(sum(dl.cartons - dl.dispatched_cartons), 0) from wms.delivery_line dl where dl.delivery_note_id = n.id)::int as not_sent,
             coalesce(n.short_close_reason, n.cancel_reason, n.reject_reason) as reason,
             coalesce(${who(sql`n.short_closed_by`)}, ${who(sql`n.cancelled_by`)}, ${who(sql`n.rejected_by`)}) as by,
             ${ist(sql`coalesce(n.short_closed_at, n.cancelled_at, n.rejected_at)`)} as at
        from wms.delivery_note n join wms.importer i on i.id = n.importer_id
       where ${NW(l, f)} and (n.short_closed_at is not null or n.status in ('CANCELLED','REJECTED'))
         and ${inPeriod(f, sql`coalesce(n.short_closed_at, n.cancelled_at, n.rejected_at)`)}
       order by coalesce(n.short_closed_at, n.cancelled_at, n.rejected_at) desc`,
  },

  // ── Pick and pack ──
  {
    key: "staff-productivity",
    no: "R17",
    group: "Pick and pack",
    title: "Staff productivity",
    description: "Good scans per person per day: picked, at packing, packed, verified, loaded — and red scans.",
    period: true,
    lens: staff("package.read"),
    columns: [c("day", "Day", "date"), c("person", "Person"), c("picked", "Picked", "int", true), c("arrived", "At packing", "int", true), c("packed", "Packed", "int", true), c("verified", "Verified", "int", true), c("loaded", "Loaded", "int", true), c("red", "Red scans", "int", true)],
    query: (l, f) => sql`
      with s as (
        select (x.scanned_at at time zone 'Asia/Kolkata')::date as d, x.scanned_by as u, x.step, x.result
          from wms.delivery_scan x join wms.delivery_note n on n.id = x.note_id
         where ${scopeWhere(l, f, sql`n.warehouse_id`, sql`n.importer_id`)} and ${inPeriod(f, sql`x.scanned_at`)}
        union all
        select (x.scanned_at at time zone 'Asia/Kolkata')::date, x.scanned_by, 'LOAD', x.result
          from wms.dispatch_scan x join wms.dispatch_order o on o.id = x.do_id
         where ${scopeWhere(l, f, sql`o.warehouse_id`, sql`o.importer_id`)} and ${inPeriod(f, sql`x.scanned_at`)})
      select to_char(d, 'YYYY-MM-DD') as day, ${who(sql`s.u`)} as person,
             count(*) filter (where step = 'PICK' and result = 'OK')::int as picked, count(*) filter (where step = 'ARRIVE' and result = 'OK')::int as arrived,
             count(*) filter (where step = 'PACK' and result = 'OK')::int as packed, count(*) filter (where step = 'VERIFY' and result = 'OK')::int as verified,
             count(*) filter (where step = 'LOAD' and result = 'OK')::int as loaded, count(*) filter (where result = 'REJECTED')::int as red
        from s group by d, s.u order by d desc, person`,
  },
  {
    key: "packages",
    no: "R18",
    group: "Pick and pack",
    title: "Package register",
    description: "Every package made in the period: cartons, weight, size, verification and its vehicle.",
    period: true,
    statuses: opts({ OPEN: "Open", CLOSED: "Closed", VERIFIED: "Verified", CANCELLED: "Cancelled" }),
    lens: own("package.read", ALLK),
    columns: [c("code", "Package"), c("dn", "Note"), c("importer", "Importer"), c("kind", "Kind"), c("status", "Status"), c("cartons", "Cartons", "int", true), c("kg", "Kg", "num", true), c("size", "L × W × H cm"), c("made_by", "Made by"), c("verified_by", "Verified by"), c("verified", "Verified", "datetime"), c("do_no", "Dispatch order")],
    query: (l, f) => sql`
      select p.code, n.dn_no as dn, i.company_name as importer, ${word(sql`p.kind`, { PACKAGE: "Package", BUNDLE: "Bundle", SINGLE: "Single carton" })} as kind,
             ${word(sql`p.status`, { OPEN: "Open", CLOSED: "Closed", VERIFIED: "Verified", CANCELLED: "Cancelled" })} as status,
             (select count(*) from wms.inward_carton c where c.package_id = p.id)::int as cartons, p.weight_kg as kg,
             case when p.length_cm is not null then trim(to_char(p.length_cm, 'FM999990.##')) || ' × ' || trim(to_char(p.width_cm, 'FM999990.##')) || ' × ' || trim(to_char(p.height_cm, 'FM999990.##')) end as size,
             ${who(sql`p.created_by`)} as made_by, ${who(sql`p.verified_by`)} as verified_by, ${ist(sql`p.verified_at`)} as verified,
             (select o.do_no from wms.dispatch_order_package dp join wms.dispatch_order o on o.id = dp.do_id where dp.package_id = p.id and dp.live limit 1) as do_no
        from wms.delivery_package p join wms.delivery_note n on n.id = p.note_id join wms.importer i on i.id = n.importer_id
       where ${NW(l, f)} and ${inPeriod(f, sql`p.created_at`)} and ${status(f, sql`p.status`)} order by p.created_at desc`,
  },
  {
    key: "put-back",
    no: "R19",
    group: "Pick and pack",
    title: "Put-back report",
    description: "Picked cartons sent back from rejected, cancelled or short-closed notes, and whether they are stored again.",
    period: true,
    lens: staff("package.read"),
    columns: [c("carton", "Carton"), c("dn", "Note"), c("importer", "Importer"), c("why", "Why"), c("back", "Sent back", "datetime"), c("stored", "Stored again", "datetime"), c("gala", "Gala now"), c("by", "Stored by")],
    query: (l, f) => sql`
      select c.carton_no as carton, n.dn_no as dn, i.company_name as importer,
             case when n.short_closed_at is not null then 'Closed short' when n.status = 'CANCELLED' then 'Cancelled' when n.status = 'REJECTED' then 'Rejected' else 'Returned' end as why,
             ${ist(sql`m.moved_at`)} as back,
             ${ist(sql`(select min(m2.moved_at) from wms.carton_movement m2 where m2.carton_id = m.carton_id and m2.action in ('RESTORED','STORED') and m2.moved_at > m.moved_at)`)} as stored,
             case when c.area = 'RETURN' then 'Not yet' else g.code end as gala,
             ${who(sql`(select m2.moved_by from wms.carton_movement m2 where m2.carton_id = m.carton_id and m2.action in ('RESTORED','STORED') and m2.moved_at > m.moved_at order by m2.moved_at limit 1)`)} as by
        from wms.carton_movement m join wms.inward_carton c on c.id = m.carton_id join wms.inward_request r on r.id = c.inward_request_id
        join wms.importer i on i.id = r.importer_id left join wms.delivery_note n on n.id = m.delivery_note_id left join wms.warehouse_gala g on g.id = c.gala_id
       where ${CW(l, f)} and m.action = 'RETURNED' and ${inPeriod(f, sql`m.moved_at`)} order by m.moved_at desc`,
  },
  {
    key: "scan-exceptions",
    no: "R20",
    group: "Pick and pack",
    title: "Scan exceptions",
    description: "Red and amber scans in pick & pack and loading: what was scanned, the message, by whom.",
    period: true,
    statuses: opts({ REJECTED: "Red (refused)", DUPLICATE: "Amber (again)" }),
    lens: staff("package.read"),
    columns: [c("at", "When", "datetime"), c("where", "Where"), c("step", "Step"), c("code", "Scanned"), c("result", "Result"), c("message", "Message"), c("ref", "Note / DO"), c("by", "By")],
    query: (l, f) => sql`
      select * from (
        select ${ist(sql`x.scanned_at`)} as at, 'Pick & pack' as where, initcap(x.step) as step, split_part(x.code, E'\\n', 1) as code,
               case x.result when 'REJECTED' then 'Red' else 'Amber' end as result, x.message, n.dn_no as ref, ${who(sql`x.scanned_by`)} as by, x.scanned_at as t, x.result as r
          from wms.delivery_scan x join wms.delivery_note n on n.id = x.note_id
         where ${scopeWhere(l, f, sql`n.warehouse_id`, sql`n.importer_id`)} and x.result <> 'OK' and ${inPeriod(f, sql`x.scanned_at`)}
        union all
        select ${ist(sql`x.scanned_at`)}, 'Loading', 'Load', split_part(x.code, E'\\n', 1), case x.result when 'REJECTED' then 'Red' else 'Amber' end, x.message, o.do_no, ${who(sql`x.scanned_by`)}, x.scanned_at, x.result
          from wms.dispatch_scan x join wms.dispatch_order o on o.id = x.do_id
         where ${scopeWhere(l, f, sql`o.warehouse_id`, sql`o.importer_id`)} and x.result <> 'OK' and ${inPeriod(f, sql`x.scanned_at`)}) s
       where ${status(f, sql`s.r`)} order by s.t desc`,
  },

  // ── Outward and LR ──
  {
    key: "dispatch-register",
    no: "R21",
    group: "Outward and LR",
    title: "Dispatch register",
    description: "Every dispatch order in the period: buyer, transporter, vehicle, packages, cartons and its LR.",
    period: true,
    statuses: opts(DO_STATUS),
    lens: own("outward.order.read", ALLK),
    columns: [c("do_no", "Dispatch order"), c("left", "Left", "datetime"), c("dn", "Note"), c("importer", "Importer"), c("buyer", "Buyer"), c("destination", "Destination"), c("transporter", "Transporter"), c("vehicle", "Vehicle"), c("driver", "Driver"), c("packages", "Packages", "int", true), c("cartons", "Cartons", "int", true), c("status", "Status"), c("lr_no", "LR no."), c("lr", "LR")],
    query: (l, f) => sql`
      select o.do_no, ${ist(sql`o.dispatched_at`)} as left, n.dn_no as dn, i.company_name as importer, o.buyer_name as buyer, o.destination,
             o.transport_name as transporter, o.vehicle_no as vehicle, o.driver_name as driver,
             (select count(*) from wms.dispatch_order_package dp where dp.do_id = o.id and dp.live)::int as packages,
             (select coalesce(sum(dp.cartons), 0) from wms.dispatch_order_package dp where dp.do_id = o.id and dp.live)::int as cartons,
             ${word(sql`o.status`, DO_STATUS)} as status,
             (select string_agg(x.lr_no, ', ') from wms.dispatch_lr x where x.do_id = o.id and x.status <> 'REPLACED') as lr_no,
             ${word(sql`o.lr_status`, LR_STATUS)} as lr
        from wms.dispatch_order o join wms.delivery_note n on n.id = o.note_id left join wms.importer i on i.id = o.importer_id
       where ${OW(l, f)} and ${inPeriod(f, sql`coalesce(o.dispatched_at, o.created_at)`)} and ${status(f, sql`o.status`)}
       order by coalesce(o.dispatched_at, o.created_at) desc`,
  },
  {
    key: "transporters",
    no: "R22",
    group: "Outward and LR",
    title: "Vehicle and transporter-wise",
    description: "Trips, cartons and how fast the LR came, per transporter and vehicle.",
    period: true,
    lens: own("outward.order.read", STAFFK),
    columns: [c("transporter", "Transporter"), c("vehicle", "Vehicle"), c("trips", "Trips", "int", true), c("packages", "Packages", "int", true), c("cartons", "Cartons", "int", true), c("lr_days", "Avg days to LR", "num"), c("verified", "LR verified", "int", true), c("missing", "LR still missing", "int", true)],
    query: (l, f) => sql`
      select coalesce(o.transport_name, '—') as transporter, coalesce(o.vehicle_no, '—') as vehicle, count(*)::int as trips,
             sum((select count(*) from wms.dispatch_order_package dp where dp.do_id = o.id and dp.live))::int as packages,
             sum((select coalesce(sum(dp.cartons), 0) from wms.dispatch_order_package dp where dp.do_id = o.id and dp.live))::int as cartons,
             round(avg(extract(epoch from ((select min(x.uploaded_at) from wms.dispatch_lr x where x.do_id = o.id) - o.dispatched_at)) / 86400)::numeric, 1) as lr_days,
             count(*) filter (where o.lr_status = 'VERIFIED')::int as verified,
             count(*) filter (where o.lr_status in ('PENDING','COLLECTED','SUBMITTED','REJECTED'))::int as missing
        from wms.dispatch_order o
       where ${OW(l, f)} and o.status = 'DISPATCHED' and ${inPeriod(f, sql`o.dispatched_at`)} group by 1, 2 order by trips desc`,
  },
  {
    key: "buyers",
    no: "R23",
    group: "Outward and LR",
    title: "Buyer-wise dispatch",
    description: "What left for each buyer in the period: notes, vehicles, cartons and pieces.",
    period: true,
    lens: own("outward.order.read", ALLK),
    columns: [c("buyer", "Buyer"), c("city", "City"), c("importer", "Importer"), c("notes", "Notes", "int", true), c("vehicles", "Vehicles", "int", true), c("cartons", "Cartons", "int", true), c("pieces", "Pieces", "int", true), c("last", "Last dispatch", "date")],
    query: (l, f) => sql`
      select n.buyer_name as buyer, n.buyer_city as city, i.company_name as importer, count(distinct n.id)::int as notes, count(distinct c.dispatch_order_id)::int as vehicles,
             count(*)::int as cartons, sum(dl.pieces_per_carton)::int as pieces, to_char(max(c.dispatched_at) at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as last
        from wms.inward_carton c join wms.delivery_note n on n.id = c.dn_id join wms.delivery_line dl on dl.id = c.dn_line_id join wms.importer i on i.id = n.importer_id
       where ${NW(l, f)} and c.status = 'DISPATCHED' and ${inPeriod(f, sql`c.dispatched_at`)}
       group by n.buyer_name, n.buyer_city, i.company_name order by cartons desc`,
  },
  {
    key: "lr-register",
    no: "R24",
    group: "Outward and LR",
    title: "LR register",
    description: "Every Lorry Receipt attached in the period, its check and how many days after departure it came.",
    period: true,
    statuses: opts(LR_STATUS, ["UPLOADED", "VERIFIED", "REJECTED", "REPLACED"]),
    lens: own("lorry_receipt.read", ALLK),
    columns: [c("lr_no", "LR no."), c("lr_date", "LR date", "date"), c("do_no", "Dispatch order"), c("importer", "Importer"), c("transporter", "Transporter"), c("vehicle", "Vehicle"), c("status", "Status"), c("duplicate", "Also on"), c("uploaded", "Attached", "datetime"), c("uploaded_by", "Attached by"), c("checked_by", "Checked by"), c("days", "Days after departure", "num")],
    query: (l, f) => sql`
      select x.lr_no, ${day(sql`x.lr_date`)} as lr_date, o.do_no, i.company_name as importer, coalesce(x.transport_name, o.transport_name) as transporter,
             coalesce(x.vehicle_no, o.vehicle_no) as vehicle, ${word(sql`x.status`, LR_STATUS)} as status, x.duplicate_of as duplicate,
             ${ist(sql`x.uploaded_at`)} as uploaded, ${who(sql`x.uploaded_by`)} as uploaded_by, ${who(sql`x.checked_by`)} as checked_by,
             round((extract(epoch from (x.uploaded_at - o.dispatched_at)) / 86400)::numeric, 1) as days
        from wms.dispatch_lr x join wms.dispatch_order o on o.id = x.do_id left join wms.importer i on i.id = o.importer_id
       where ${OW(l, f)} and ${inPeriod(f, sql`x.uploaded_at`)} and ${status(f, sql`x.status`)} order by x.uploaded_at desc`,
  },
  {
    key: "lr-pending",
    no: "R25",
    group: "Outward and LR",
    title: "Pending and missing LR",
    description: "Vehicles that left without a verified LR, oldest first.",
    period: false,
    lens: own("lorry_receipt.read", ALLK),
    columns: [c("do_no", "Dispatch order"), c("left", "Left", "datetime"), c("days", "Days since", "days"), c("importer", "Importer"), c("buyer", "Buyer"), c("transporter", "Transporter"), c("vehicle", "Vehicle"), c("lr", "LR state"), c("collected_by", "Collected by")],
    query: (l, f) => sql`
      select o.do_no, ${ist(sql`o.dispatched_at`)} as left, floor(extract(epoch from (now() - o.dispatched_at)) / 86400)::int as days, i.company_name as importer,
             o.buyer_name as buyer, o.transport_name as transporter, o.vehicle_no as vehicle,
             case when o.lr_status in ('PENDING','COLLECTED','SUBMITTED','REJECTED') and o.dispatched_at < now() - interval '2 days' then 'Missing (' || ${word(sql`o.lr_status`, LR_STATUS)} || ')'
                  else ${word(sql`o.lr_status`, LR_STATUS)} end as lr,
             ${who(sql`o.lr_collected_by`)} as collected_by
        from wms.dispatch_order o left join wms.importer i on i.id = o.importer_id
       where ${OW(l, f)} and o.status = 'DISPATCHED' and o.lr_status <> 'VERIFIED' order by o.dispatched_at`,
  },

  // ── Expenses ──
  {
    key: "expense-register",
    no: "R26",
    group: "Expenses",
    title: "Expense register",
    description: "Every expense in the period with category, warehouse, payment and approval.",
    period: true,
    importer: false,
    statuses: opts(EXP_STATUS),
    lens: staff("expense.read"),
    columns: [c("date", "Date", "date"), c("category", "Category"), c("warehouse", "Warehouse"), c("paid_to", "Paid to"), c("mode", "Mode"), c("ref", "Reference"), c("amount", "Amount", "money", true), c("status", "Approval"), c("approved_by", "Decided by"), c("notes", "Notes")],
    query: (l, f) => sql`
      select ${day(sql`x.spent_on`)} as date, k.name as category, w.name as warehouse, x.paid_to,
             ${word(sql`x.payment_mode`, { CASH: "Cash", UPI: "UPI", CARD: "Card", BANK_TRANSFER: "Bank transfer", CHEQUE: "Cheque" })} as mode, x.reference_no as ref,
             round(x.amount_paise / 100.0, 2) as amount, ${word(sql`x.approval_status`, EXP_STATUS)} as status, ${who(sql`x.approved_by`)} as approved_by, x.notes
        from wms.expense x left join wms.expense_category k on k.id = x.expense_category_id join wms.warehouse w on w.id = x.warehouse_id
       where x.deleted_at is null and x.is_active and ${whWhere(l, f, sql`x.warehouse_id`)} and x.spent_on between ${f.from}::date and ${f.to}::date and ${status(f, sql`x.approval_status`)}
       order by x.spent_on desc, x.id desc`,
  },
  {
    key: "expense-categories",
    no: "R27",
    group: "Expenses",
    title: "Category summary",
    description: "Total, count and share per category in the period (rejected left out).",
    period: true,
    importer: false,
    lens: staff("expense.read"),
    columns: [c("category", "Category"), c("entries", "Entries", "int", true), c("amount", "Amount", "money", true), c("avg", "Average", "money"), c("share", "Share", "pct")],
    query: (l, f) => sql`
      with x as (select k.name as category, x.amount_paise from wms.expense x left join wms.expense_category k on k.id = x.expense_category_id
                  where x.deleted_at is null and x.is_active and x.approval_status <> 'REJECTED' and ${whWhere(l, f, sql`x.warehouse_id`)}
                    and x.spent_on between ${f.from}::date and ${f.to}::date)
      select coalesce(category, 'Other') as category, count(*)::int as entries, round(sum(amount_paise) / 100.0, 2) as amount,
             round(avg(amount_paise) / 100.0, 2) as avg, round(100.0 * sum(amount_paise) / nullif((select sum(amount_paise) from x), 0), 1) as share
        from x group by 1 order by amount desc`,
  },
  {
    key: "expense-warehouses",
    no: "R28",
    group: "Expenses",
    title: "Warehouse-wise spend",
    description: "Spend per warehouse and category in the period (rejected left out).",
    period: true,
    importer: false,
    lens: staff("expense.read"),
    columns: [c("warehouse", "Warehouse"), c("category", "Category"), c("entries", "Entries", "int", true), c("amount", "Amount", "money", true)],
    query: (l, f) => sql`
      select w.name as warehouse, coalesce(k.name, 'Other') as category, count(*)::int as entries, round(sum(x.amount_paise) / 100.0, 2) as amount
        from wms.expense x left join wms.expense_category k on k.id = x.expense_category_id join wms.warehouse w on w.id = x.warehouse_id
       where x.deleted_at is null and x.is_active and x.approval_status <> 'REJECTED' and ${whWhere(l, f, sql`x.warehouse_id`)}
         and x.spent_on between ${f.from}::date and ${f.to}::date
       group by 1, 2 order by 1, amount desc`,
  },
  {
    key: "expense-approvals",
    no: "R29",
    group: "Expenses",
    title: "Expense approval status",
    description: "Waiting, approved and rejected expenses with who decided and how long it took.",
    period: true,
    importer: false,
    statuses: opts(EXP_STATUS),
    lens: staff("expense.read"),
    columns: [c("date", "Date", "date"), c("category", "Category"), c("warehouse", "Warehouse"), c("amount", "Amount", "money", true), c("status", "Approval"), c("entered_by", "Entered by"), c("decided_by", "Decided by"), c("decided", "Decided", "datetime"), c("hours", "Hours to decide", "hours"), c("note", "Note")],
    query: (l, f) => sql`
      select ${day(sql`x.spent_on`)} as date, k.name as category, w.name as warehouse, round(x.amount_paise / 100.0, 2) as amount,
             ${word(sql`x.approval_status`, EXP_STATUS)} as status, ${who(sql`x.created_by`)} as entered_by, ${who(sql`x.approved_by`)} as decided_by,
             ${ist(sql`x.approved_at`)} as decided, case when x.approved_at is not null then ${hours(sql`x.created_at`, sql`x.approved_at`)} end as hours, x.approval_note as note
        from wms.expense x left join wms.expense_category k on k.id = x.expense_category_id join wms.warehouse w on w.id = x.warehouse_id
       where x.deleted_at is null and ${whWhere(l, f, sql`x.warehouse_id`)} and x.spent_on between ${f.from}::date and ${f.to}::date and ${status(f, sql`x.approval_status`)}
       order by x.approval_status = 'PENDING' desc, x.spent_on desc`,
  },

  // ── Admin ──
  {
    key: "importers",
    no: "R30",
    group: "Admin",
    title: "Importer and KYC register",
    description: "Every importer: GSTIN, status, KYC, when they joined, agents and cartons in stock.",
    period: false,
    warehouse: false,
    importer: false,
    statuses: opts({ PENDING: "Pending", ACTIVE: "Active", SUSPENDED: "Suspended", CLOSED: "Closed", REJECTED: "Rejected" }),
    lens: own("importer.read", ["all"]),
    columns: [c("code", "Code"), c("company", "Company"), c("gstin", "GSTIN"), c("contact", "Contact"), c("mobile", "Mobile"), c("city", "City"), c("status", "Status"), c("kyc", "KYC"), c("joined", "Joined", "date"), c("approved", "Approved", "date"), c("agents", "Sales agents", "int", true), c("stock", "Cartons in stock", "int", true)],
    query: (l) => sql`
      select i.code, i.company_name as company, i.gstin, i.contact_person as contact, i.contact_mobile as mobile, ct.name as city, initcap(i.status::text) as status,
             initcap(replace(i.kyc_status, '_', ' ')) as kyc, to_char(i.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as joined,
             to_char(i.approved_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as approved,
             (select count(*) from wms.sales_agent a where a.importer_id = i.id and a.deleted_at is null)::int as agents,
             (select count(*) from wms.inward_carton c join wms.inward_request r on r.id = c.inward_request_id
               where r.importer_id = i.id and c.status = 'RECEIVED' and ${whWhere(l, null, sql`r.warehouse_id`)})::int as stock
        from wms.importer i left join wms.city ct on ct.id = i.city_id
       where i.deleted_at is null
         and ${l.kind === "warehouse" ? sql`exists (select 1 from wms.inward_request r where r.importer_id = i.id and ${whWhere(l, null, sql`r.warehouse_id`)})` : sql`true`}
       order by i.company_name`,
  },
  {
    key: "users",
    no: "R31",
    group: "Admin",
    title: "Users and roles",
    description: "Every user with roles, warehouses, status and last sign-in.",
    period: false,
    warehouse: false,
    importer: false,
    lens: own("user.read", ["all"]),
    columns: [c("name", "Name"), c("email", "Email"), c("mobile", "Mobile"), c("roles", "Roles"), c("warehouses", "Warehouses"), c("status", "Status"), c("last_login", "Last sign-in", "datetime"), c("created", "Created", "date")],
    query: () => sql`
      select trim(u.first_name || ' ' || coalesce(u.last_name, '')) as name, u.email::text as email, u.mobile::text as mobile,
             (select string_agg(distinct initcap(replace(a.role::text, '_', ' ')), ', ') from wms.user_role_assignment a where a.user_id = u.id and a.revoked_at is null) as roles,
             (select string_agg(distinct w.name, ', ') from wms.user_role_assignment a join wms.warehouse w on w.id = a.warehouse_id where a.user_id = u.id and a.revoked_at is null) as warehouses,
             initcap(u.status::text) as status, ${ist(sql`u.last_login_at`)} as last_login, to_char(u.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as created
        from wms.users u where u.deleted_at is null order by name`,
  },
  {
    key: "audit",
    no: "R32",
    group: "Admin",
    title: "Audit trail",
    description: "Who did what, when and on which record, in the period.",
    period: true,
    importer: false,
    lens: own("audit_log.read", ["all"]),
    columns: [c("at", "When", "datetime"), c("who", "Who"), c("role", "As"), c("action", "Action"), c("entity", "Record"), c("label", "Which"), c("result", "Result"), c("ip", "IP")],
    query: (l, f) => sql`
      select ${ist(sql`a.occurred_at`)} as at, coalesce(a.actor_name, a.actor_email::text) as who, initcap(replace(a.acting_role::text, '_', ' ')) as role,
             a.action, a.entity_type as entity, coalesce(a.entity_label, a.entity_id) as label, initcap(a.result::text) as result, host(a.ip) as ip
        from wms.audit_log a
       where ${inPeriod(f, sql`a.occurred_at`)}
         and ${l.kind === "warehouse" ? whWhere(l, f, sql`a.actor_warehouse_id`) : l.kind === "importer" ? sql`a.actor_importer_id = ${l.importerId}` : f.warehouseId ? sql`a.actor_warehouse_id = ${f.warehouseId}` : sql`true`}
       order by a.occurred_at desc`,
  },
  {
    key: "alerts",
    no: "R33",
    group: "Admin",
    title: "Alerts sent and failed",
    description: "Every alert sent by email, SMS, push or in the app in the period, with failures and why.",
    period: true,
    importer: false,
    statuses: opts({ SENT: "Sent", DELIVERED: "Delivered", READ: "Read", FAILED: "Failed", PENDING: "Pending", QUEUED: "Queued", SUPPRESSED: "Suppressed", EXPIRED: "Expired" }),
    lens: own("notification.read", ["all"]),
    columns: [c("at", "When", "datetime"), c("event", "Event"), c("channel", "Channel"), c("recipient", "To"), c("title", "Title"), c("status", "Status"), c("attempts", "Attempts", "int"), c("error", "Error")],
    query: (l, f) => sql`
      select ${ist(sql`d.created_at`)} as at, n.event_key as event, initcap(replace(d.channel::text, '_', ' ')) as channel,
             coalesce(${who(sql`n.recipient_user_id`)}, d.address) as recipient, n.title, initcap(d.status::text) as status, d.attempts::int as attempts, d.last_error as error
        from wms.notification_delivery d join wms.notification n on n.id = d.notification_id
       where ${inPeriod(f, sql`d.created_at`)} and ${l.kind === "warehouse" ? whWhere(l, f, sql`n.warehouse_id`) : f.warehouseId ? sql`n.warehouse_id = ${f.warehouseId}` : sql`true`}
         and ${status(f, sql`d.status::text`)}
       order by d.created_at desc`,
  },
  {
    key: "enquiries",
    no: "R34",
    group: "Admin",
    title: "Enquiries",
    description: "Enquiries from the website in the period: who, what, read and replied.",
    period: true,
    warehouse: false,
    importer: false,
    lens: own("enquiry.read", ["all"]),
    columns: [c("received", "Received", "datetime"), c("name", "Name"), c("email", "Email"), c("mobile", "Mobile"), c("subject", "Subject"), c("read", "Read", "datetime"), c("replied", "Replied", "datetime")],
    query: (_l, f) => sql`
      select ${ist(sql`e.created_at`)} as received, e.name, e.email::text as email, e.mobile::text as mobile, e.subject, ${ist(sql`e.read_at`)} as read, ${ist(sql`e.replied_at`)} as replied
        from wms.enquiry e where e.deleted_at is null and ${inPeriod(f, sql`e.created_at`)} order by e.created_at desc`,
  },
  {
    key: "agents",
    no: "R35",
    group: "Admin",
    title: "Sales-agent performance",
    description: "Per agent in the period: notes made, approved, cartons dispatched, buyers and hours to approval.",
    period: true,
    warehouse: false,
    lens: own("sales_agent.read", ["all", "warehouse", "importer"]),
    columns: [c("code", "Code"), c("agent", "Agent"), c("importer", "Importer"), c("notes", "Notes made", "int", true), c("approved", "Approved", "int", true), c("rejected", "Rejected", "int", true), c("cartons", "Cartons dispatched", "int", true), c("buyers", "Buyers", "int"), c("hours", "Avg hours to approval", "hours"), c("active", "Active")],
    query: (l, f) => sql`
      select a.code, trim(a.first_name || ' ' || coalesce(a.last_name, '')) as agent, i.company_name as importer,
             count(n.id)::int as notes, count(n.id) filter (where n.status = 'APPROVED')::int as approved, count(n.id) filter (where n.status = 'REJECTED')::int as rejected,
             coalesce(sum((select sum(dl.dispatched_cartons) from wms.delivery_line dl where dl.delivery_note_id = n.id)), 0)::int as cartons,
             count(distinct lower(n.buyer_name))::int as buyers,
             round(avg(extract(epoch from (n.approved_at - n.created_at)) / 3600)::numeric, 1) as hours,
             case when a.is_active and a.status = 'ACTIVE' then 'Yes' else 'No' end as active
        from wms.sales_agent a join wms.importer i on i.id = a.importer_id
        left join wms.delivery_note n on n.created_by = a.user_id and n.importer_id = a.importer_id and n.dn_date between ${f.from}::date and ${f.to}::date
       where a.deleted_at is null and ${impWhere(l, f, sql`a.importer_id`)}
         and ${l.kind === "warehouse" ? sql`exists (select 1 from wms.inward_request r where r.importer_id = a.importer_id and ${whWhere(l, null, sql`r.warehouse_id`)})` : sql`true`}
       group by a.id, a.code, a.first_name, a.last_name, i.company_name, a.is_active, a.status order by notes desc, agent`,
  },
];

export const reportByKey = (key: string) => REPORTS.find((r) => r.key === key) ?? null;
