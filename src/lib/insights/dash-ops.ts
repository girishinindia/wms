import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db";

import { align, bucketLabel, bucketSql, bucketsOf, unitOf } from "./buckets";
import { inPeriod, scopeWhere, todayIST, whWhere, type Filters, type Lens } from "./lens";
import type { Chart, Color, List, Series, Tile } from "./types";

export type Built = { tiles: Tile[]; charts: Chart[]; lists: List[] };

export async function rows<T extends Record<string, unknown>>(q: SQL): Promise<T[]> {
  return (await getDb().execute<T>(q)) as unknown as T[];
}
export async function one<T extends Record<string, unknown>>(q: SQL): Promise<T> {
  return ((await rows<T>(q))[0] ?? {}) as T;
}
export const n = (v: unknown) => Number(v ?? 0) || 0;

/** Report link with the same filters. */
export function rep(key: string, f: Filters, extra: Record<string, string | number> = {}): string {
  const p = new URLSearchParams({ period: f.period, from: f.from, to: f.to });
  if (f.warehouseId) p.set("warehouseId", String(f.warehouseId));
  if (f.importerId) p.set("importerId", String(f.importerId));
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return `/admin/reports/${key}?${p.toString()}`;
}

/** Cartons of the lens: `inward_carton c join inward_request r`. */
const C = (lens: Lens, f: Filters) => sql`
  wms.inward_carton c join wms.inward_request r on r.id = c.inward_request_id
  where ${scopeWhere(lens, f, sql`r.warehouse_id`, sql`r.importer_id`)}`;

const N = (lens: Lens, f: Filters) => sql`${scopeWhere(lens, f, sql`n.warehouse_id`, sql`n.importer_id`)}`;
const O = (lens: Lens, f: Filters) => sql`${scopeWhere(lens, f, sql`o.warehouse_id`, sql`o.importer_id`)}`;

const LIVE_NOTE = sql`n.status in ('PENDING','APPROVED') and n.short_closed_at is null and n.work_status not in ('DISPATCHED','CANCELLED','RETURNING')`;

const AGE = sql`case when c.received_at > now() - interval '30 days' then 0 when c.received_at > now() - interval '60 days' then 1
                     when c.received_at > now() - interval '90 days' then 2 else 3 end`;
const AGE_LABELS = ["0–30 days", "31–60 days", "61–90 days", "90+ days"];

async function ageChart(lens: Lens, f: Filters, key = "age"): Promise<Chart> {
  const r = await rows<{ b: number; n: number }>(sql`select ${AGE} as b, count(*)::int as n from ${C(lens, f)} and c.status = 'RECEIVED' group by 1`);
  const data = [0, 1, 2, 3].map((i) => n(r.find((x) => Number(x.b) === i)?.n));
  return { key, title: "Stock age (cartons)", kind: "bar", labels: AGE_LABELS, series: [{ name: "Cartons", data, color: "amber" }], format: "int", href: rep("stock-ageing", f) };
}

async function inOut(lens: Lens, f: Filters, title = "Inward vs outward (cartons)"): Promise<Chart> {
  const unit = unitOf(f);
  const bs = bucketsOf(f, unit);
  const rec = await rows<{ b: string; n: number }>(sql`
    select ${bucketSql(sql`c.received_at`, unit)} as b, count(*)::int as n from ${C(lens, f)} and ${inPeriod(f, sql`c.received_at`)} group by 1`);
  const out = await rows<{ b: string; n: number }>(sql`
    select ${bucketSql(sql`c.dispatched_at`, unit)} as b, count(*)::int as n from ${C(lens, f)} and c.status = 'DISPATCHED' and ${inPeriod(f, sql`c.dispatched_at`)} group by 1`);
  return {
    key: "inout",
    title,
    kind: "line",
    labels: bs.map((b) => bucketLabel(b, unit)),
    series: [
      { name: "Received", data: align(bs, rec), color: "teal" },
      { name: "Dispatched", data: align(bs, out), color: "blue" },
    ],
    format: "int",
    wide: true,
    note: unit === "day" ? null : `One point per ${unit}.`,
  };
}

/** Delivery-note steps, in order. */
const STEPS: { label: string; statuses: string[] }[] = [
  { label: "To pick", statuses: ["NEW", "ASSIGNED"] },
  { label: "Picking", statuses: ["PARTIALLY_PICKED"] },
  { label: "Packing", statuses: ["PICKED", "PACKAGING_IN_PROGRESS", "PARTIALLY_PACKAGED", "PACKAGED"] },
  { label: "To verify", statuses: ["VERIFICATION_PENDING"] },
  { label: "Ready for outward", statuses: ["READY_FOR_DISPATCH"] },
  { label: "Partly dispatched", statuses: ["PARTIALLY_DISPATCHED"] },
];

async function pipeline(lens: Lens, f: Filters): Promise<{ chart: Chart; byStep: Record<string, number>; onHold: number }> {
  const r = await rows<{ s: string; n: number; h: number }>(sql`
    select n.work_status as s, count(*)::int as n, count(*) filter (where n.on_hold)::int as h
      from wms.delivery_note n where ${N(lens, f)} and n.status in ('PENDING','APPROVED') and n.short_closed_at is null group by 1`);
  const byStep: Record<string, number> = {};
  for (const s of STEPS) byStep[s.label] = r.filter((x) => s.statuses.includes(x.s)).reduce((a, x) => a + n(x.n), 0);
  return {
    chart: {
      key: "pipeline",
      title: "Delivery notes by step",
      kind: "funnel",
      labels: STEPS.map((s) => s.label),
      series: [{ name: "Notes", data: STEPS.map((s) => byStep[s.label]!), color: "violet" }],
      format: "int",
      href: "/admin/dispatch",
    },
    byStep,
    onHold: r.reduce((a, x) => a + n(x.h), 0),
  };
}

// ── 1. Executive ──────────────────────────────────────────────────

export async function executive(lens: Lens, f: Filters, extra: { expenses: Lens | null; importers: boolean }): Promise<Built> {
  const t = await one<Record<string, number>>(sql`
    select count(*) filter (where c.status = 'RECEIVED')::int as stock,
           count(*) filter (where c.status = 'HOLD')::int as hold,
           count(*) filter (where ${inPeriod(f, sql`c.received_at`)})::int as rec,
           count(*) filter (where c.status = 'DISPATCHED' and ${inPeriod(f, sql`c.dispatched_at`)})::int as out
      from ${C(lens, f)}`);
  const pipe = await pipeline(lens, f);
  const inWork = Object.values(pipe.byStep).reduce((a, v) => a + v, 0);
  const lr = await one<{ n: number; missing: number }>(sql`
    select count(*) filter (where o.lr_status <> 'VERIFIED')::int as n,
           count(*) filter (where o.lr_status in ('PENDING','COLLECTED','SUBMITTED','REJECTED') and o.dispatched_at < now() - interval '2 days')::int as missing
      from wms.dispatch_order o where ${O(lens, f)} and o.status = 'DISPATCHED'`);
  const tiles: Tile[] = [
    { key: "stock", label: "Cartons in stock", value: n(t.stock), format: "int", href: rep("stock-summary", f) },
    { key: "received", label: "Received", value: n(t.rec), format: "int", href: rep("carton-receipts", f) },
    { key: "dispatched", label: "Dispatched", value: n(t.out), format: "int", href: rep("dispatch-register", f) },
    { key: "inwork", label: "Notes in work", value: inWork, format: "int", note: pipe.onHold ? `${pipe.onHold} on hold` : null, href: "/admin/dispatch" },
    { key: "lr", label: "LR not verified", value: n(lr.n), format: "int", tone: n(lr.missing) ? "danger" : n(lr.n) ? "warn" : "default", note: n(lr.missing) ? `${n(lr.missing)} missing 2+ days` : null, href: rep("lr-pending", f) },
  ];
  if (extra.expenses) {
    const e = await one<{ v: number }>(sql`
      select coalesce(sum(x.amount_paise), 0)::bigint as v from wms.expense x
       where x.deleted_at is null and x.is_active and x.approval_status <> 'REJECTED' and ${whWhere(extra.expenses, f, sql`x.warehouse_id`)}
         and x.spent_on between ${f.from}::date and ${f.to}::date`);
    tiles.push({ key: "expenses", label: "Expenses", value: n(e.v) / 100, format: "money", href: rep("expense-register", f) });
  } else {
    tiles.push({ key: "hold", label: "Cartons on hold", value: n(t.hold), format: "int", tone: n(t.hold) ? "warn" : "default", href: rep("holds", f) });
  }

  const wh = await rows<{ name: string; n: number }>(sql`
    select w.name, count(c.id)::int as n
      from wms.inward_carton c join wms.inward_request r on r.id = c.inward_request_id join wms.warehouse w on w.id = r.warehouse_id
     where ${scopeWhere(lens, f, sql`r.warehouse_id`, sql`r.importer_id`)} and c.status = 'RECEIVED'
     group by w.name order by n desc limit 12`);
  const imp = await rows<{ name: string; n: number }>(sql`
    select i.company_name as name, count(c.id)::int as n
      from wms.inward_carton c join wms.inward_request r on r.id = c.inward_request_id join wms.importer i on i.id = r.importer_id
     where ${scopeWhere(lens, f, sql`r.warehouse_id`, sql`r.importer_id`)} and c.status = 'RECEIVED'
     group by i.company_name order by n desc limit 10`);

  const charts: Chart[] = [
    await inOut(lens, f),
    { key: "bywh", title: "Stock by warehouse (cartons)", kind: "bar", labels: wh.map((x) => x.name), series: [{ name: "Cartons", data: wh.map((x) => n(x.n)), color: "teal" }], format: "int", href: rep("stock-summary", f) },
    pipe.chart,
    { key: "byimp", title: "Top importers by stock (cartons)", kind: "hbar", labels: imp.map((x) => x.name), series: [{ name: "Cartons", data: imp.map((x) => n(x.n)), color: "cyan" }], format: "int", href: rep("stock-summary", f) },
    await ageChart(lens, f),
  ];

  const alerts: List["rows"] = [];
  if (n(t.hold)) alerts.push({ title: `${n(t.hold)} carton${n(t.hold) === 1 ? "" : "s"} on hold at the dock`, subtitle: "Check the reason and release or return them", tone: "warn", href: rep("holds", f) });
  if (n(lr.missing)) alerts.push({ title: `${n(lr.missing)} LR missing for 2+ days`, subtitle: "Vehicles left without a Lorry Receipt attached", tone: "danger", href: rep("lr-pending", f) });
  const urgent = await one<{ n: number }>(sql`
    select count(*)::int as n from wms.delivery_note n where ${N(lens, f)} and ${LIVE_NOTE} and n.priority = 'URGENT' and n.work_status <> 'READY_FOR_DISPATCH'`);
  if (n(urgent.n)) alerts.push({ title: `${n(urgent.n)} urgent note${n(urgent.n) === 1 ? "" : "s"} not ready yet`, subtitle: "Waiting in pick & pack", tone: "warn", href: "/admin/dispatch" });
  if (extra.importers) {
    const p = await one<{ n: number }>(sql`select count(*)::int as n from wms.importer where status = 'PENDING' and deleted_at is null`);
    if (n(p.n)) alerts.push({ title: `${n(p.n)} importer${n(p.n) === 1 ? "" : "s"} waiting for approval`, subtitle: "Registered; submitted profiles first", tone: "warn", href: "/admin/importers" });
  }
  return { tiles, charts, lists: [{ key: "alerts", title: "Needs attention", rows: alerts, empty: "Nothing needs attention right now." }] };
}

// ── 2. Inward and dock ────────────────────────────────────────────

const R = (lens: Lens, f: Filters) => sql`${scopeWhere(lens, f, sql`r.warehouse_id`, sql`r.importer_id`)} and r.deleted_at is null`;
const STATUS_WORD: Record<string, string> = {
  SUBMITTED: "Waiting acknowledgement",
  NEEDS_CHANGES: "Needs changes",
  ACKNOWLEDGED: "Acknowledged",
  IN_PROCESS: "In process",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export async function inward(lens: Lens, f: Filters): Promise<Built> {
  const today = todayIST();
  const t = await one<Record<string, number>>(sql`
    select count(*) filter (where r.status in ('SUBMITTED','NEEDS_CHANGES','ACKNOWLEDGED','IN_PROCESS'))::int as open,
           count(*) filter (where r.status in ('SUBMITTED','ACKNOWLEDGED','IN_PROCESS') and r.expected_arrival between ${today}::date and ${today}::date + 6)::int as week,
           coalesce(avg(extract(epoch from (r.acknowledged_at - r.submitted_at)) / 3600) filter (where ${inPeriod(f, sql`r.acknowledged_at`)}), 0)::float as ack
      from wms.inward_request r where ${R(lens, f)}`);
  const c = await one<Record<string, number>>(sql`
    select count(*) filter (where ${inPeriod(f, sql`c.received_at`)})::int as rec,
           count(*) filter (where c.status = 'HOLD')::int as hold,
           count(*) filter (where c.status = 'RECEIVED' and c.gala_id is null and c.area is null)::int as waiting
      from ${C(lens, f)}`);
  const tiles: Tile[] = [
    { key: "open", label: "Open requests", value: n(t.open), format: "int", href: "/admin/inward" },
    { key: "week", label: "Arriving this week", value: n(t.week), format: "int", href: rep("pending-arrivals", f) },
    { key: "received", label: "Cartons received", value: n(c.rec), format: "int", href: rep("carton-receipts", f) },
    { key: "hold", label: "On hold", value: n(c.hold), format: "int", tone: n(c.hold) ? "warn" : "default", href: rep("holds", f) },
    { key: "waiting", label: "Waiting to store", value: n(c.waiting), format: "int", tone: n(c.waiting) ? "warn" : "default", href: "/admin/storage" },
    { key: "ack", label: "Avg hours to acknowledge", value: Math.round(n(t.ack) * 10) / 10, format: "hours", href: rep("inward-register", f) },
  ];
  const byStatus = await rows<{ s: string; n: number }>(sql`
    select r.status as s, count(*)::int as n from wms.inward_request r
     where ${R(lens, f)} and r.status <> 'DRAFT' and ${inPeriod(f, sql`coalesce(r.submitted_at, r.created_at)`)} group by 1 order by 2 desc`);
  const unit = unitOf(f);
  const bs = bucketsOf(f, unit);
  const rec = await rows<{ b: string; n: number }>(sql`
    select ${bucketSql(sql`c.received_at`, unit)} as b, count(*)::int as n from ${C(lens, f)} and ${inPeriod(f, sql`c.received_at`)} group by 1`);
  const next = await rows<{ d: string; n: number }>(sql`
    select to_char(r.expected_arrival, 'YYYY-MM-DD') as d, count(*)::int as n from wms.inward_request r
     where ${R(lens, f)} and r.status in ('SUBMITTED','ACKNOWLEDGED','IN_PROCESS') and r.expected_arrival between ${today}::date and ${today}::date + 13 group by 1`);
  const days14 = Array.from({ length: 14 }, (_, i) => new Date(Date.parse(`${today}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
  const top = await rows<{ d: string; n: number }>(sql`
    select coalesce(li.item_code || ' · ', '') || li.description as d, count(*)::int as n
      from wms.inward_carton c join wms.inward_request r on r.id = c.inward_request_id join wms.inward_request_item li on li.id = c.inward_request_item_id
     where ${scopeWhere(lens, f, sql`r.warehouse_id`, sql`r.importer_id`)} and ${inPeriod(f, sql`c.received_at`)}
     group by 1 order by 2 desc limit 10`);
  const charts: Chart[] = [
    { key: "status", title: "Requests by status", kind: "donut", labels: byStatus.map((x) => STATUS_WORD[x.s] ?? x.s), series: [{ name: "Requests", data: byStatus.map((x) => n(x.n)) }], format: "int", href: rep("inward-register", f) },
    { key: "received", title: "Cartons received", kind: "bar", labels: bs.map((b) => bucketLabel(b, unit)), series: [{ name: "Cartons", data: align(bs, rec), color: "teal" }], format: "int", wide: true },
    { key: "arrivals", title: "Arrivals in the next 14 days", kind: "bar", labels: days14.map((d) => bucketLabel(d, "day")), series: [{ name: "Requests", data: align(days14, next.map((x) => ({ b: x.d, n: x.n }))), color: "violet" }], format: "int", href: rep("pending-arrivals", f) },
    { key: "items", title: "Top items received (cartons)", kind: "hbar", labels: top.map((x) => x.d), series: [{ name: "Cartons", data: top.map((x) => n(x.n)), color: "cyan" }], format: "int", href: rep("inward-items", f) },
  ];
  const soon = await rows<{ id: number; code: string; imp: string; d: string; wh: string; s: string }>(sql`
    select r.id, r.code, i.company_name as imp, to_char(r.expected_arrival, 'DD Mon') as d, w.name as wh, r.status as s
      from wms.inward_request r join wms.importer i on i.id = r.importer_id join wms.warehouse w on w.id = r.warehouse_id
     where ${R(lens, f)} and r.status in ('SUBMITTED','ACKNOWLEDGED','IN_PROCESS') and r.expected_arrival between ${today}::date and ${today}::date + 1
     order by r.expected_arrival, r.id limit 10`);
  const changes = await rows<{ id: number; code: string; imp: string; note: string | null }>(sql`
    select r.id, r.code, i.company_name as imp, r.needs_changes_note as note
      from wms.inward_request r join wms.importer i on i.id = r.importer_id where ${R(lens, f)} and r.status = 'NEEDS_CHANGES' order by r.last_status_at desc nulls last limit 10`);
  return {
    tiles,
    charts,
    lists: [
      { key: "soon", title: "Expected today and tomorrow", rows: soon.map((x) => ({ title: `${x.code} · ${x.imp}`, subtitle: `${x.d} · ${x.wh}`, badge: STATUS_WORD[x.s] ?? x.s, href: `/admin/inward/${x.id}` })), empty: "Nothing expected today or tomorrow." },
      { key: "changes", title: "Needs changes", rows: changes.map((x) => ({ title: `${x.code} · ${x.imp}`, subtitle: x.note, tone: "warn" as const, href: `/admin/inward/${x.id}` })), empty: "No request is waiting for changes." },
    ],
  };
}

// ── 3. Storage and space ──────────────────────────────────────────

export async function storage(lens: Lens, f: Filters): Promise<Built> {
  const g = await one<Record<string, number>>(sql`
    with g as (
      select gl.id, (select count(*) from wms.inward_carton c where c.gala_id = gl.id and c.status = 'RECEIVED' and c.area is null) as n
        from wms.warehouse_gala gl where gl.deleted_at is null and gl.is_active and ${whWhere(lens, f, sql`gl.warehouse_id`)})
    select count(*)::int as total, count(*) filter (where n > 0)::int as used from g`);
  const c = await one<Record<string, number>>(sql`
    select count(*) filter (where c.status = 'RECEIVED' and c.gala_id is not null and c.area is null)::int as stored,
           count(*) filter (where c.status = 'RECEIVED' and c.gala_id is null and c.area is null)::int as waiting,
           count(*) filter (where c.status = 'RECEIVED' and c.area = 'RETURN')::int as back,
           coalesce(max(extract(day from now() - c.received_at)) filter (where c.status = 'RECEIVED'), 0)::int as oldest
      from ${C(lens, f)}`);
  const total = n(g.total);
  const used = n(g.used);
  const tiles: Tile[] = [
    { key: "stored", label: "Cartons in galas", value: n(c.stored), format: "int", href: rep("gala-stock", f) },
    { key: "used", label: "Galas in use", value: total ? Math.round((used / total) * 100) : 0, format: "pct", note: `${used} of ${total} galas`, href: "/admin/locations" },
    { key: "empty", label: "Empty galas", value: total - used, format: "int", href: "/admin/locations" },
    { key: "waiting", label: "Waiting to store", value: n(c.waiting), format: "int", tone: n(c.waiting) ? "warn" : "default", href: "/admin/storage" },
    { key: "back", label: "Put-back pending", value: n(c.back), format: "int", tone: n(c.back) ? "warn" : "default", href: rep("put-back", f) },
    { key: "oldest", label: "Oldest carton", value: n(c.oldest), format: "days", tone: n(c.oldest) > 90 ? "warn" : "default", href: rep("stock-ageing", f) },
  ];
  const cells = await rows<{ id: number; code: string; grp: string; n: number; active: boolean }>(sql`
    select gl.id, gl.code, w.name || ' · ' || coalesce(fl.name, 'Floor ' || fl.floor_no) as grp, gl.is_active as active,
           (select count(*) from wms.inward_carton c where c.gala_id = gl.id and c.status = 'RECEIVED' and c.area is null)::int as n
      from wms.warehouse_gala gl join wms.warehouse_floor fl on fl.id = gl.floor_id join wms.warehouse w on w.id = gl.warehouse_id
     where gl.deleted_at is null and fl.deleted_at is null and ${whWhere(lens, f, sql`gl.warehouse_id`)}
     order by w.name, fl.floor_no, gl.gala_no limit 800`);
  const max = Math.max(1, ...cells.map((x) => n(x.n)));
  const floors = await rows<{ floor: string; imp: string; n: number }>(sql`
    select w.code || ' ' || coalesce(fl.code, 'F' || fl.floor_no) as floor, i.company_name as imp, count(*)::int as n
      from wms.inward_carton c join wms.inward_request r on r.id = c.inward_request_id join wms.importer i on i.id = r.importer_id
      join wms.warehouse_gala gl on gl.id = c.gala_id join wms.warehouse_floor fl on fl.id = gl.floor_id join wms.warehouse w on w.id = gl.warehouse_id
     where ${scopeWhere(lens, f, sql`r.warehouse_id`, sql`r.importer_id`)} and c.status = 'RECEIVED' and c.area is null
     group by 1, 2`);
  const floorNames = [...new Set(floors.map((x) => x.floor))].sort();
  const impTotals = new Map<string, number>();
  for (const x of floors) impTotals.set(x.imp, (impTotals.get(x.imp) ?? 0) + n(x.n));
  const topImp = [...impTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
  const palette: Color[] = ["teal", "blue", "violet", "amber", "cyan"];
  const stackSeries: Series[] = topImp.map((imp, i) => ({ name: imp, color: palette[i], data: floorNames.map((fl) => n(floors.find((x) => x.floor === fl && x.imp === imp)?.n)) }));
  const others = floorNames.map((fl) => floors.filter((x) => x.floor === fl && !topImp.includes(x.imp)).reduce((a, x) => a + n(x.n), 0));
  if (others.some((v) => v > 0)) stackSeries.push({ name: "Others", color: "slate", data: others });
  const unit = unitOf(f);
  const bs = bucketsOf(f, unit);
  const stored = await rows<{ b: string; n: number }>(sql`
    select ${bucketSql(sql`m.moved_at`, unit)} as b, count(*)::int as n
      from wms.carton_movement m join wms.inward_carton c on c.id = m.carton_id join wms.inward_request r on r.id = c.inward_request_id
     where ${scopeWhere(lens, f, sql`r.warehouse_id`, sql`r.importer_id`)} and m.action in ('STORED','RESTORED') and ${inPeriod(f, sql`m.moved_at`)} group by 1`);
  const charts: Chart[] = [
    {
      key: "heat",
      title: "Gala occupancy",
      kind: "heatmap",
      labels: [],
      series: [],
      cells: cells.map((x) => ({ label: x.code, value: n(x.n), max, group: x.grp, href: `/admin/locations/galas/${x.id}`, note: x.active ? null : "switched off" })),
      note: `Darker = more cartons (the fullest gala holds ${max}).`,
      wide: true,
    },
    { key: "floors", title: "Stock by floor and importer (cartons)", kind: "stacked", labels: floorNames, series: stackSeries, format: "int", href: rep("gala-stock", f) },
    await ageChart(lens, f),
    { key: "stored", title: "Cartons stored", kind: "line", labels: bs.map((b) => bucketLabel(b, unit)), series: [{ name: "Stored", data: align(bs, stored), color: "teal" }], format: "int", href: rep("carton-movements", f) },
  ];
  const fullest = [...cells].sort((a, b) => n(b.n) - n(a.n)).slice(0, 8).filter((x) => n(x.n) > 0);
  const off = cells.filter((x) => !x.active && n(x.n) > 0).slice(0, 8);
  return {
    tiles,
    charts,
    lists: [
      { key: "fullest", title: "Fullest galas", rows: fullest.map((x) => ({ title: x.code, subtitle: x.grp, badge: `${n(x.n)} ctn`, href: `/admin/locations/galas/${x.id}` })), empty: "No carton is stored yet." },
      { key: "off", title: "Switched-off galas still holding cartons", rows: off.map((x) => ({ title: x.code, subtitle: x.grp, badge: `${n(x.n)} ctn`, tone: "warn" as const, href: `/admin/locations/galas/${x.id}` })), empty: "None — every switched-off gala is empty." },
    ],
  };
}

// ── 4. Pick and pack ──────────────────────────────────────────────

export async function pickpack(lens: Lens, f: Filters): Promise<Built> {
  const pipe = await pipeline(lens, f);
  const avg = await one<{ h: number }>(sql`
    select coalesce(avg(extract(epoch from (n.ready_at - n.approved_at)) / 3600), 0)::float as h
      from wms.delivery_note n where ${N(lens, f)} and n.approved_at is not null and n.ready_at > n.approved_at and ${inPeriod(f, sql`n.ready_at`)}`);
  const s = pipe.byStep;
  const tiles: Tile[] = [
    { key: "topick", label: "Notes to pick", value: s["To pick"]!, format: "int", href: "/admin/dispatch" },
    { key: "picking", label: "Picking now", value: s["Picking"]!, format: "int", href: "/admin/dispatch" },
    { key: "packing", label: "Packing", value: s["Packing"]!, format: "int", href: "/admin/dispatch" },
    { key: "verify", label: "To verify", value: s["To verify"]!, format: "int", href: "/admin/dispatch" },
    { key: "ready", label: "Ready for outward", value: s["Ready for outward"]!, format: "int", tone: "good", href: "/admin/outward" },
    { key: "hold", label: "On hold", value: pipe.onHold, format: "int", tone: pipe.onHold ? "warn" : "default", href: "/admin/dispatch" },
    { key: "avg", label: "Avg hours approval → ready", value: Math.round(n(avg.h) * 10) / 10, format: "hours", href: rep("note-register", f) },
  ];
  const unit = unitOf(f);
  const bs = bucketsOf(f, unit);
  const scans = await rows<{ b: string; step: string; n: number }>(sql`
    select ${bucketSql(sql`s.scanned_at`, unit)} as b, s.step, count(*)::int as n
      from wms.delivery_scan s join wms.delivery_note n on n.id = s.note_id
     where ${N(lens, f)} and s.result = 'OK' and s.step in ('PICK','PACK') and ${inPeriod(f, sql`s.scanned_at`)} group by 1, 2`);
  const staff = await rows<{ who: string; n: number }>(sql`
    select trim(u.first_name || ' ' || coalesce(u.last_name, '')) as who, count(*)::int as n
      from wms.delivery_scan s join wms.delivery_note n on n.id = s.note_id join wms.users u on u.id = s.scanned_by
     where ${N(lens, f)} and s.result = 'OK' and ${inPeriod(f, sql`s.scanned_at`)} group by 1 order by 2 desc limit 10`);
  const wait = await rows<{ p: string; h: number }>(sql`
    select n.priority as p, coalesce(avg(extract(epoch from (now() - coalesce(n.approved_at, n.created_at))) / 3600), 0)::float as h
      from wms.delivery_note n where ${N(lens, f)} and ${LIVE_NOTE} and n.work_status <> 'READY_FOR_DISPATCH' group by 1`);
  const charts: Chart[] = [
    pipe.chart,
    {
      key: "scans",
      title: "Cartons picked and packed",
      kind: "line",
      labels: bs.map((b) => bucketLabel(b, unit)),
      series: [
        { name: "Picked", data: align(bs, scans.filter((x) => x.step === "PICK")), color: "teal" },
        { name: "Packed", data: align(bs, scans.filter((x) => x.step === "PACK")), color: "violet" },
      ],
      format: "int",
      wide: true,
    },
    { key: "staff", title: "Staff output (good scans)", kind: "hbar", labels: staff.map((x) => x.who), series: [{ name: "Scans", data: staff.map((x) => n(x.n)), color: "blue" }], format: "int", href: rep("staff-productivity", f) },
    {
      key: "wait",
      title: "Average wait of open notes (hours)",
      kind: "bar",
      labels: ["Urgent", "Normal"],
      series: [{ name: "Hours", data: ["URGENT", "NORMAL"].map((p) => Math.round(n(wait.find((x) => x.p === p)?.h) * 10) / 10), color: "amber" }],
      format: "hours",
    },
  ];
  const oldest = await rows<{ id: number; dn: string; buyer: string; h: number; ws: string; urgent: boolean; hold: boolean }>(sql`
    select n.id, n.dn_no as dn, n.buyer_name as buyer, n.work_status as ws, n.priority = 'URGENT' as urgent, n.on_hold as hold,
           extract(epoch from (now() - coalesce(n.approved_at, n.created_at))) / 3600 as h
      from wms.delivery_note n where ${N(lens, f)} and ${LIVE_NOTE} and n.work_status <> 'READY_FOR_DISPATCH'
     order by n.priority = 'URGENT' desc, coalesce(n.approved_at, n.created_at) limit 8`);
  const red = await rows<{ id: number; dn: string; code: string; msg: string | null; who: string; step: string }>(sql`
    select n.id, n.dn_no as dn, split_part(s.code, E'\\n', 1) as code, s.message as msg, s.step,
           trim(u.first_name || ' ' || coalesce(u.last_name, '')) as who
      from wms.delivery_scan s join wms.delivery_note n on n.id = s.note_id left join wms.users u on u.id = s.scanned_by
     where ${N(lens, f)} and s.result = 'REJECTED' and s.scanned_at >= (${todayIST()}::date)::timestamp at time zone 'Asia/Kolkata'
     order by s.scanned_at desc limit 8`);
  const W: Record<string, string> = { NEW: "New", ASSIGNED: "Assigned", PARTIALLY_PICKED: "Picking", PICKED: "Picked", PACKAGING_IN_PROGRESS: "Packing", PARTIALLY_PACKAGED: "Partly packed", PACKAGED: "Packed", VERIFICATION_PENDING: "Verifying", PARTIALLY_DISPATCHED: "Partly dispatched" };
  return {
    tiles,
    charts,
    lists: [
      {
        key: "oldest",
        title: "Oldest waiting notes",
        rows: oldest.map((x) => ({
          title: `${x.dn} · ${x.buyer}`,
          subtitle: `${Math.round(n(x.h))} h waiting${x.hold ? " · on hold" : ""}`,
          badge: x.urgent ? "Urgent" : W[x.ws] ?? x.ws,
          tone: x.urgent || x.hold ? ("warn" as const) : ("default" as const),
          href: `/admin/dispatch/${x.id}`,
        })),
        empty: "Nothing is waiting.",
      },
      { key: "red", title: "Red scans today", rows: red.map((x) => ({ title: `${x.code} · ${x.dn}`, subtitle: `${x.step.toLowerCase()} · ${x.who}: ${x.msg ?? ""}`, tone: "danger" as const, href: `/admin/dispatch/${x.id}` })), empty: "No red scan today.", href: rep("scan-exceptions", f) },
    ],
  };
}

// ── 5. Outward and LR ─────────────────────────────────────────────

export async function outward(lens: Lens, f: Filters): Promise<Built> {
  const ready = await one<{ n: number }>(sql`
    select count(distinct n.id)::int as n from wms.delivery_note n join wms.delivery_package p on p.note_id = n.id
     where ${N(lens, f)} and n.status = 'APPROVED' and n.short_closed_at is null and p.status = 'VERIFIED'
       and not exists (select 1 from wms.dispatch_order_package dp where dp.package_id = p.id and dp.live)`);
  const t = await one<Record<string, number>>(sql`
    select count(*) filter (where o.status in ('PENDING_VERIFICATION','READY_FOR_OUTWARD','LOADING_IN_PROGRESS','LOADED','ON_HOLD'))::int as loading,
           count(*) filter (where o.status = 'DISPATCHED' and ${inPeriod(f, sql`o.dispatched_at`)})::int as out,
           count(*) filter (where o.status = 'DISPATCHED' and o.lr_status in ('PENDING','COLLECTED','SUBMITTED','REJECTED'))::int as pending,
           count(*) filter (where o.status = 'DISPATCHED' and o.lr_status in ('PENDING','COLLECTED','SUBMITTED','REJECTED') and o.dispatched_at < now() - interval '2 days')::int as missing,
           count(*) filter (where o.status = 'DISPATCHED' and o.lr_status = 'UPLOADED')::int as verify
      from wms.dispatch_order o where ${O(lens, f)}`);
  const cartonsOut = await one<{ n: number }>(sql`select count(*)::int as n from ${C(lens, f)} and c.status = 'DISPATCHED' and ${inPeriod(f, sql`c.dispatched_at`)}`);
  const tiles: Tile[] = [
    { key: "ready", label: "Notes ready to load", value: n(ready.n), format: "int", href: "/admin/outward" },
    { key: "loading", label: "Dispatch orders in loading", value: n(t.loading), format: "int", href: "/admin/outward" },
    { key: "out", label: "Vehicles left", value: n(t.out), format: "int", note: `${n(cartonsOut.n).toLocaleString("en-IN")} cartons`, href: rep("dispatch-register", f) },
    { key: "pending", label: "LR pending", value: n(t.pending), format: "int", tone: n(t.pending) ? "warn" : "default", href: rep("lr-pending", f) },
    { key: "missing", label: "LR missing (2+ days)", value: n(t.missing), format: "int", tone: n(t.missing) ? "danger" : "default", href: rep("lr-pending", f) },
    { key: "verify", label: "LR to verify", value: n(t.verify), format: "int", tone: n(t.verify) ? "warn" : "default", href: "/admin/outward" },
  ];
  const unit = unitOf(f);
  const bs = bucketsOf(f, unit);
  const veh = await rows<{ b: string; n: number }>(sql`
    select ${bucketSql(sql`o.dispatched_at`, unit)} as b, count(*)::int as n from wms.dispatch_order o
     where ${O(lens, f)} and o.status = 'DISPATCHED' and ${inPeriod(f, sql`o.dispatched_at`)} group by 1`);
  const ctn = await rows<{ b: string; n: number }>(sql`
    select ${bucketSql(sql`c.dispatched_at`, unit)} as b, count(*)::int as n from ${C(lens, f)} and c.status = 'DISPATCHED' and ${inPeriod(f, sql`c.dispatched_at`)} group by 1`);
  const doStatus = await rows<{ s: string; n: number }>(sql`
    select o.status as s, count(*)::int as n from wms.dispatch_order o where ${O(lens, f)} and ${inPeriod(f, sql`o.created_at`)} group by 1 order by 2 desc`);
  const lrStatus = await rows<{ s: string; n: number }>(sql`
    select case when o.lr_status in ('PENDING','COLLECTED','SUBMITTED','REJECTED') and o.dispatched_at < now() - interval '2 days' then 'MISSING' else o.lr_status end as s,
           count(*)::int as n
      from wms.dispatch_order o where ${O(lens, f)} and o.status = 'DISPATCHED' and ${inPeriod(f, sql`o.dispatched_at`)} group by 1 order by 2 desc`);
  const lag = await rows<{ b: string; n: number }>(sql`
    with first as (
      select o.id, (select min(l.uploaded_at) from wms.dispatch_lr l where l.do_id = o.id) as at, o.dispatched_at
        from wms.dispatch_order o where ${O(lens, f)} and o.status = 'DISPATCHED' and ${inPeriod(f, sql`o.dispatched_at`)})
    select case when at is null then 'Not yet' else
                case floor(extract(epoch from (at - dispatched_at)) / 86400)::int when 0 then 'Same day' when 1 then '1 day' when 2 then '2 days'
                     else case when at - dispatched_at < interval '8 days' then '3–7 days' else '7+ days' end end end as b,
           count(*)::int as n from first group by 1`);
  const LAGS = ["Same day", "1 day", "2 days", "3–7 days", "7+ days", "Not yet"];
  const tr = await rows<{ name: string; trips: number; days: number | null }>(sql`
    select coalesce(o.transport_name, 'Not named') as name, count(*)::int as trips,
           avg(extract(epoch from ((select min(l.uploaded_at) from wms.dispatch_lr l where l.do_id = o.id) - o.dispatched_at)) / 86400)::float as days
      from wms.dispatch_order o where ${O(lens, f)} and o.status = 'DISPATCHED' and ${inPeriod(f, sql`o.dispatched_at`)}
     group by 1 order by 2 desc limit 8`);
  const DO_W: Record<string, string> = { PENDING_VERIFICATION: "Needs details", READY_FOR_OUTWARD: "Ready to load", LOADING_IN_PROGRESS: "Loading", LOADED: "Loaded", DISPATCHED: "Dispatched", ON_HOLD: "On hold", CANCELLED: "Cancelled", DRAFT: "Draft" };
  const LR_W: Record<string, string> = { PENDING: "Pending", COLLECTED: "Collected", SUBMITTED: "With manager", UPLOADED: "Attached", VERIFIED: "Verified", REJECTED: "Rejected", MISSING: "Missing" };
  const charts: Chart[] = [
    {
      key: "out",
      title: "Vehicles and cartons out",
      kind: "combo",
      labels: bs.map((b) => bucketLabel(b, unit)),
      series: [
        { name: "Vehicles", data: align(bs, veh), kind: "bar", color: "blue" },
        { name: "Cartons", data: align(bs, ctn), kind: "line", right: true, color: "teal" },
      ],
      format: "int",
      wide: true,
    },
    { key: "dostatus", title: "Dispatch orders by status", kind: "donut", labels: doStatus.map((x) => DO_W[x.s] ?? x.s), series: [{ name: "DOs", data: doStatus.map((x) => n(x.n)) }], format: "int", href: rep("dispatch-register", f) },
    { key: "lrstatus", title: "LR of vehicles that left", kind: "donut", labels: lrStatus.map((x) => LR_W[x.s] ?? x.s), series: [{ name: "DOs", data: lrStatus.map((x) => n(x.n)) }], format: "int", href: rep("lr-register", f) },
    { key: "lag", title: "Days from departure to LR", kind: "bar", labels: LAGS, series: [{ name: "DOs", data: LAGS.map((l) => n(lag.find((x) => x.b === l)?.n)), color: "amber" }], format: "int", href: rep("lr-register", f) },
    {
      key: "transporters",
      title: "Transporters: trips",
      kind: "hbar",
      labels: tr.map((x) => x.name),
      series: [{ name: "Trips", data: tr.map((x) => n(x.trips)), color: "violet" }],
      format: "int",
      note: tr.length ? `Average days to LR: ${tr.map((x) => `${x.name} ${x.days === null ? "—" : n(x.days).toFixed(1)}`).join(" · ")}` : null,
      href: rep("transporters", f),
    },
  ];
  const missing = await rows<{ id: number; no: string; v: string | null; t: string | null; d: number }>(sql`
    select o.id, o.do_no as no, o.vehicle_no as v, o.transport_name as t, floor(extract(epoch from (now() - o.dispatched_at)) / 86400)::int as d
      from wms.dispatch_order o where ${O(lens, f)} and o.status = 'DISPATCHED' and o.lr_status in ('PENDING','COLLECTED','SUBMITTED','REJECTED')
     order by o.dispatched_at limit 8`);
  const loading = await rows<{ id: number; no: string; v: string | null; s: string; l: number; p: number }>(sql`
    select o.id, o.do_no as no, o.vehicle_no as v, o.status as s,
           (select count(*) from wms.dispatch_order_package dp where dp.do_id = o.id and dp.live and dp.loaded_at is not null)::int as l,
           (select count(*) from wms.dispatch_order_package dp where dp.do_id = o.id and dp.live)::int as p
      from wms.dispatch_order o where ${O(lens, f)} and o.status in ('READY_FOR_OUTWARD','LOADING_IN_PROGRESS','LOADED','ON_HOLD','PENDING_VERIFICATION')
     order by o.created_at limit 8`);
  return {
    tiles,
    charts,
    lists: [
      { key: "lrwait", title: "LR not attached yet", rows: missing.map((x) => ({ title: `${x.no} · ${x.v ?? "no vehicle"}`, subtitle: `${x.t ?? ""} · left ${x.d} day${x.d === 1 ? "" : "s"} ago`, tone: x.d >= 2 ? ("danger" as const) : ("warn" as const), badge: x.d >= 2 ? "Missing" : "Pending", href: `/admin/outward/${x.id}` })), empty: "Every vehicle that left has its LR.", href: rep("lr-pending", f) },
      { key: "loading", title: "On the loading bay", rows: loading.map((x) => ({ title: `${x.no} · ${x.v ?? "no vehicle"}`, subtitle: `${x.l} of ${x.p} packages loaded`, badge: DO_W[x.s] ?? x.s, tone: x.s === "ON_HOLD" ? ("warn" as const) : ("default" as const), href: `/admin/outward/${x.id}` })), empty: "No vehicle is loading." },
    ],
  };
}

