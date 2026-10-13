import "server-only";

import { sql } from "drizzle-orm";

import { align, bucketLabel, bucketSql, bucketsOf, unitOf } from "./buckets";
import { n, one, rep, rows, type Built } from "./dash-ops";
import { agentWhere, impWhere, inPeriod, scopeWhere, todayIST, whWhere, type Filters, type Lens } from "./lens";
import type { Chart, Tile } from "./types";

const money = (paise: unknown) => Math.round(n(paise)) / 100;
const MODE: Record<string, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card", BANK_TRANSFER: "Bank transfer", CHEQUE: "Cheque" };

// ── 6. Expenses ───────────────────────────────────────────────────

export async function expenses(lens: Lens, f: Filters): Promise<Built> {
  const X = sql`x.deleted_at is null and x.is_active and ${whWhere(lens, f, sql`x.warehouse_id`)}`;
  const inP = sql`x.spent_on between ${f.from}::date and ${f.to}::date`;
  const today = todayIST();
  const month = `${today.slice(0, 7)}-01`;
  const t = await one<Record<string, number>>(sql`
    select coalesce(sum(x.amount_paise) filter (where ${inP} and x.approval_status <> 'REJECTED'), 0)::bigint as spend,
           count(*) filter (where x.approval_status = 'PENDING')::int as wait,
           coalesce(sum(x.amount_paise) filter (where x.approval_status = 'PENDING'), 0)::bigint as wait_amt,
           coalesce(sum(x.amount_paise) filter (where x.spent_on >= ${month}::date and x.approval_status <> 'REJECTED'), 0)::bigint as this_m,
           coalesce(sum(x.amount_paise) filter (where x.spent_on >= ${month}::date - interval '1 month' and x.spent_on < ${month}::date - interval '1 month' + (${today}::date - ${month}::date + 1) * interval '1 day' and x.approval_status <> 'REJECTED'), 0)::bigint as last_m
      from wms.expense x where ${X}`);
  const cats = await rows<{ c: string; v: number }>(sql`
    select coalesce(k.name, 'Other') as c, sum(x.amount_paise)::bigint as v from wms.expense x left join wms.expense_category k on k.id = x.expense_category_id
     where ${X} and ${inP} and x.approval_status <> 'REJECTED' group by 1 order by 2 desc`);
  const change = n(t.last_m) ? Math.round(((n(t.this_m) - n(t.last_m)) / n(t.last_m)) * 100) : 0;
  const tiles: Tile[] = [
    { key: "spend", label: "Spent in period", value: money(t.spend), format: "money", href: rep("expense-register", f) },
    { key: "wait", label: "Waiting approval", value: n(t.wait), format: "int", note: `₹${money(t.wait_amt).toLocaleString("en-IN")}`, tone: n(t.wait) ? "warn" : "default", href: rep("expense-approvals", f, { status: "PENDING" }) },
    { key: "month", label: "This month so far", value: money(t.this_m), format: "money", note: n(t.last_m) ? `${change >= 0 ? "+" : ""}${change}% vs same days last month` : null, tone: change > 20 ? "warn" : "default", href: rep("expense-categories", f) },
    { key: "top", label: "Biggest category", value: money(cats[0]?.v), format: "money", note: cats[0]?.c ?? "—", href: rep("expense-categories", f) },
  ];
  const unit = unitOf(f) === "day" ? "day" : "month";
  const bs = bucketsOf(f, unit);
  const trend = await rows<{ b: string; n: number }>(sql`
    select ${bucketSql(sql`(x.spent_on::timestamp at time zone 'Asia/Kolkata')`, unit)} as b, (sum(x.amount_paise) / 100.0)::float as n
      from wms.expense x where ${X} and ${inP} and x.approval_status <> 'REJECTED' group by 1`);
  const wh = await rows<{ w: string; v: number }>(sql`
    select w.name as w, sum(x.amount_paise)::bigint as v from wms.expense x join wms.warehouse w on w.id = x.warehouse_id
     where ${X} and ${inP} and x.approval_status <> 'REJECTED' group by 1 order by 2 desc limit 12`);
  const modes = await rows<{ m: string; v: number }>(sql`
    select x.payment_mode as m, sum(x.amount_paise)::bigint as v from wms.expense x where ${X} and ${inP} and x.approval_status <> 'REJECTED' group by 1 order by 2 desc`);
  const charts: Chart[] = [
    { key: "cats", title: "By category (₹)", kind: "donut", labels: cats.map((x) => x.c), series: [{ name: "₹", data: cats.map((x) => money(x.v)) }], format: "money", href: rep("expense-categories", f) },
    { key: "trend", title: `Spend per ${unit} (₹)`, kind: "bar", labels: bs.map((b) => bucketLabel(b, unit)), series: [{ name: "₹", data: align(bs, trend), color: "amber" }], format: "money", wide: true },
    { key: "wh", title: "By warehouse (₹)", kind: "bar", labels: wh.map((x) => x.w), series: [{ name: "₹", data: wh.map((x) => money(x.v)), color: "teal" }], format: "money", href: rep("expense-warehouses", f) },
    { key: "modes", title: "By payment mode (₹)", kind: "donut", labels: modes.map((x) => MODE[x.m] ?? x.m), series: [{ name: "₹", data: modes.map((x) => money(x.v)) }], format: "money" },
  ];
  const big = await rows<{ id: number; c: string | null; to: string | null; v: number; d: string; w: string }>(sql`
    select x.id, k.name as c, x.paid_to as to, x.amount_paise as v, to_char(x.spent_on, 'DD Mon') as d, w.name as w
      from wms.expense x left join wms.expense_category k on k.id = x.expense_category_id join wms.warehouse w on w.id = x.warehouse_id
     where ${X} and ${inP} and x.approval_status <> 'REJECTED' order by x.amount_paise desc limit 8`);
  const wait = await rows<{ id: number; c: string | null; to: string | null; v: number; d: string; w: string }>(sql`
    select x.id, k.name as c, x.paid_to as to, x.amount_paise as v, to_char(x.spent_on, 'DD Mon') as d, w.name as w
      from wms.expense x left join wms.expense_category k on k.id = x.expense_category_id join wms.warehouse w on w.id = x.warehouse_id
     where ${X} and x.approval_status = 'PENDING' order by x.spent_on limit 8`);
  const row = (x: (typeof big)[number]) => ({ title: `₹${money(x.v).toLocaleString("en-IN")} · ${x.c ?? "Other"}`, subtitle: `${x.d} · ${x.w}${x.to ? ` · ${x.to}` : ""}`, href: `/admin/expenses?id=${x.id}` });
  return {
    tiles,
    charts,
    lists: [
      { key: "big", title: "Largest expenses", rows: big.map(row), empty: "No expense in this period." },
      { key: "wait", title: "Waiting approval", rows: wait.map((x) => ({ ...row(x), tone: "warn" as const })), empty: "Nothing is waiting for approval." },
    ],
  };
}

// ── 7. Platform and people ────────────────────────────────────────

export async function platform(f: Filters): Promise<Built> {
  const today = todayIST();
  const t = await one<Record<string, number>>(sql`
    select (select count(*) from wms.importer where status = 'ACTIVE' and deleted_at is null)::int as imp,
           (select count(*) from wms.importer where status = 'PENDING' and deleted_at is null)::int as wait,
           (select count(*) from wms.users where status = 'ACTIVE' and deleted_at is null)::int as users,
           (select count(distinct user_id) from wms.user_session where issued_at >= (${today}::date)::timestamp at time zone 'Asia/Kolkata')::int as signins,
           (select count(*) from wms.notification_delivery d where d.status = 'FAILED' and ${inPeriod(f, sql`d.created_at`)})::int as failed,
           (select count(*) from wms.enquiry where read_at is null and deleted_at is null)::int as unread`);
  const tiles: Tile[] = [
    { key: "imp", label: "Active importers", value: n(t.imp), format: "int", href: "/admin/importers" },
    { key: "wait", label: "Importers waiting", value: n(t.wait), format: "int", tone: n(t.wait) ? "warn" : "default", href: "/admin/importers" },
    { key: "users", label: "Active users", value: n(t.users), format: "int", href: "/admin/users" },
    { key: "signins", label: "Signed in today", value: n(t.signins), format: "int", href: rep("users", f) },
    { key: "failed", label: "Alerts failed", value: n(t.failed), format: "int", tone: n(t.failed) ? "danger" : "default", href: rep("alerts", f) },
    { key: "unread", label: "Unread enquiries", value: n(t.unread), format: "int", tone: n(t.unread) ? "warn" : "default", href: "/admin/enquiries" },
  ];
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 12 + i, 1));
    return d.toISOString().slice(0, 10);
  });
  const joined = await rows<{ b: string; n: number }>(sql`
    select to_char(date_trunc('month', created_at at time zone 'Asia/Kolkata'), 'YYYY-MM-DD') as b, count(*)::int as n
      from wms.importer where deleted_at is null and created_at >= ${months[0]}::date group by 1`);
  const roles = await rows<{ r: string; n: number }>(sql`
    select a.role::text as r, count(distinct a.user_id)::int as n from wms.user_role_assignment a join wms.users u on u.id = a.user_id
     where a.revoked_at is null and u.deleted_at is null and u.status = 'ACTIVE' group by 1 order by 2 desc`);
  const unit = unitOf(f);
  const bs = bucketsOf(f, unit);
  const sign = await rows<{ b: string; n: number }>(sql`
    select ${bucketSql(sql`issued_at`, unit)} as b, count(*)::int as n from wms.user_session where ${inPeriod(f, sql`issued_at`)} group by 1`);
  const ch = await rows<{ c: string; ok: number; bad: number }>(sql`
    select d.channel::text as c, count(*) filter (where d.status in ('SENT','DELIVERED','READ'))::int as ok, count(*) filter (where d.status = 'FAILED')::int as bad
      from wms.notification_delivery d where ${inPeriod(f, sql`d.created_at`)} group by 1 order by 1`);
  const RW: Record<string, string> = { SUPER_ADMIN: "Super admin", WAREHOUSE_ADMIN: "Warehouse admin", INWARD_MANAGER: "Inward manager", STORAGE_MANAGER: "Storage manager", PACKAGE_MANAGER: "Package manager", DISPATCH_MANAGER: "Dispatch manager", LR_COLLECTOR: "LR collector", IMPORTER: "Importer", SALES_AGENT: "Sales agent", EXPENSE_ADMIN: "Expense admin", EXPENSE_MANAGER: "Expense manager", TRANSPORTER_ADMIN: "Transporter admin", TRANSPORTER_MANAGER: "Transporter manager" };
  const CW: Record<string, string> = { IN_APP: "In app", EMAIL: "Email", SMS: "SMS", PUSH: "Push", WHATSAPP: "WhatsApp" };
  const charts: Chart[] = [
    { key: "joined", title: "Importers joined per month", kind: "bar", labels: months.map((b) => bucketLabel(b, "month")), series: [{ name: "Importers", data: align(months, joined), color: "teal" }], format: "int", href: rep("importers", f) },
    { key: "roles", title: "Active users by role", kind: "hbar", labels: roles.map((x) => RW[x.r] ?? x.r), series: [{ name: "Users", data: roles.map((x) => n(x.n)), color: "violet" }], format: "int", href: rep("users", f) },
    { key: "signins", title: "Sign-ins", kind: "line", labels: bs.map((b) => bucketLabel(b, unit)), series: [{ name: "Sign-ins", data: align(bs, sign), color: "blue" }], format: "int", wide: true },
    {
      key: "alerts",
      title: "Alerts sent and failed",
      kind: "stacked",
      labels: ch.map((x) => CW[x.c] ?? x.c),
      series: [
        { name: "Sent", data: ch.map((x) => n(x.ok)), color: "teal" },
        { name: "Failed", data: ch.map((x) => n(x.bad)), color: "rose" },
      ],
      format: "int",
      href: rep("alerts", f),
    },
  ];
  const kyc = await rows<{ id: number; code: string; name: string; person: string; kyc: string }>(sql`
    select id, code, company_name as name, contact_person as person, kyc_status as kyc from wms.importer
     where status = 'PENDING' and deleted_at is null order by (kyc_status = 'SUBMITTED') desc, created_at limit 8`);
  const enq = await rows<{ id: number; name: string; subject: string | null; d: string }>(sql`
    select id, name, subject, to_char(created_at at time zone 'Asia/Kolkata', 'DD Mon') as d from wms.enquiry where read_at is null and deleted_at is null order by created_at desc limit 8`);
  return {
    tiles,
    charts,
    lists: [
      { key: "kyc", title: "Waiting for review", rows: kyc.map((x) => ({ title: `${x.code} · ${x.name}`, subtitle: x.person, badge: x.kyc === "SUBMITTED" ? "Profile submitted" : x.kyc.toLowerCase().replace(/_/g, " "), tone: x.kyc === "SUBMITTED" ? ("warn" as const) : ("default" as const), href: `/admin/importers/${x.id}` })), empty: "Nothing waiting.", href: "/admin/importers" },
      { key: "enq", title: "Unread enquiries", rows: enq.map((x) => ({ title: x.name, subtitle: `${x.d}${x.subject ? ` · ${x.subject}` : ""}`, href: `/admin/enquiries?id=${x.id}` })), empty: "No unread enquiry.", href: "/admin/enquiries" },
    ],
  };
}

// ── 8. My stock (importer) ────────────────────────────────────────

export async function importer(lens: Lens, f: Filters): Promise<Built> {
  const C = sql`wms.inward_carton c join wms.inward_request r on r.id = c.inward_request_id where ${scopeWhere(lens, f, sql`r.warehouse_id`, sql`r.importer_id`)}`;
  const t = await one<Record<string, number>>(sql`
    select count(*) filter (where c.status = 'RECEIVED')::int as stock,
           count(distinct c.inward_request_item_id) filter (where c.status = 'RECEIVED')::int as lines,
           count(*) filter (where ${inPeriod(f, sql`c.received_at`)})::int as rec,
           count(*) filter (where c.status = 'DISPATCHED' and ${inPeriod(f, sql`c.dispatched_at`)})::int as out
      from ${C}`);
  const items = await one<{ n: number }>(sql`
    select count(distinct coalesce(li.item_id::text, li.description))::int as n
      from wms.inward_carton c join wms.inward_request r on r.id = c.inward_request_id join wms.inward_request_item li on li.id = c.inward_request_item_id
     where ${scopeWhere(lens, f, sql`r.warehouse_id`, sql`r.importer_id`)} and c.status = 'RECEIVED'`);
  const notes = await one<{ open: number }>(sql`
    select count(*)::int as open from wms.delivery_note n where ${impWhere(lens, f, sql`n.importer_id`)} and ${whWhere(lens, f, sql`n.warehouse_id`)}
       and n.status in ('PENDING','APPROVED') and n.short_closed_at is null and n.work_status not in ('DISPATCHED','CANCELLED','RETURNING')`);
  const lr = await one<{ all: number; ok: number }>(sql`
    select count(*)::int as all, count(*) filter (where o.lr_status = 'VERIFIED')::int as ok from wms.dispatch_order o
     where ${impWhere(lens, f, sql`o.importer_id`)} and ${whWhere(lens, f, sql`o.warehouse_id`)} and o.status = 'DISPATCHED' and ${inPeriod(f, sql`o.dispatched_at`)}`);
  const tiles: Tile[] = [
    { key: "stock", label: "Cartons in stock", value: n(t.stock), format: "int", href: rep("stock-summary", f) },
    { key: "items", label: "Items in stock", value: n(items.n), format: "int", href: rep("stock-summary", f) },
    { key: "received", label: "Received", value: n(t.rec), format: "int", href: rep("inward-register", f) },
    { key: "dispatched", label: "Dispatched", value: n(t.out), format: "int", href: rep("dispatch-register", f) },
    { key: "open", label: "Open delivery notes", value: n(notes.open), format: "int", href: "/admin/delivery-notes" },
    { key: "lr", label: "LR verified", value: n(lr.all) ? Math.round((n(lr.ok) / n(lr.all)) * 100) : 0, format: "pct", note: `${n(lr.ok)} of ${n(lr.all)} vehicles`, href: rep("lr-register", f) },
  ];
  const top = await rows<{ d: string; n: number }>(sql`
    select coalesce(li.item_code || ' · ', '') || li.description as d, count(*)::int as n
      from wms.inward_carton c join wms.inward_request r on r.id = c.inward_request_id join wms.inward_request_item li on li.id = c.inward_request_item_id
     where ${scopeWhere(lens, f, sql`r.warehouse_id`, sql`r.importer_id`)} and c.status = 'RECEIVED' group by 1 order by 2 desc limit 10`);
  const unit = unitOf(f);
  const bs = bucketsOf(f, unit);
  const rec = await rows<{ b: string; n: number }>(sql`select ${bucketSql(sql`c.received_at`, unit)} as b, count(*)::int as n from ${C} and ${inPeriod(f, sql`c.received_at`)} group by 1`);
  const out = await rows<{ b: string; n: number }>(sql`select ${bucketSql(sql`c.dispatched_at`, unit)} as b, count(*)::int as n from ${C} and c.status = 'DISPATCHED' and ${inPeriod(f, sql`c.dispatched_at`)} group by 1`);
  const age = await rows<{ b: number; n: number }>(sql`
    select case when c.received_at > now() - interval '30 days' then 0 when c.received_at > now() - interval '60 days' then 1
                when c.received_at > now() - interval '90 days' then 2 else 3 end as b, count(*)::int as n
      from ${C} and c.status = 'RECEIVED' group by 1`);
  const st = await rows<{ s: string; n: number }>(sql`
    select n.status as s, count(*)::int as n from wms.delivery_note n
     where ${impWhere(lens, f, sql`n.importer_id`)} and ${whWhere(lens, f, sql`n.warehouse_id`)} and n.dn_date between ${f.from}::date and ${f.to}::date group by 1`);
  const SW: Record<string, string> = { PENDING: "Waiting approval", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled" };
  const charts: Chart[] = [
    {
      key: "inout",
      title: "Received vs dispatched (cartons)",
      kind: "line",
      labels: bs.map((b) => bucketLabel(b, unit)),
      series: [
        { name: "Received", data: align(bs, rec), color: "teal" },
        { name: "Dispatched", data: align(bs, out), color: "blue" },
      ],
      format: "int",
      wide: true,
    },
    { key: "items", title: "Stock by item, top 10 (cartons)", kind: "hbar", labels: top.map((x) => x.d), series: [{ name: "Cartons", data: top.map((x) => n(x.n)), color: "cyan" }], format: "int", href: rep("stock-summary", f) },
    { key: "age", title: "Stock age (cartons)", kind: "bar", labels: ["0–30 days", "31–60 days", "61–90 days", "90+ days"], series: [{ name: "Cartons", data: [0, 1, 2, 3].map((i) => n(age.find((x) => Number(x.b) === i)?.n)), color: "amber" }], format: "int", href: rep("stock-ageing", f) },
    { key: "notes", title: "My delivery notes", kind: "donut", labels: st.map((x) => SW[x.s] ?? x.s), series: [{ name: "Notes", data: st.map((x) => n(x.n)) }], format: "int", href: rep("note-register", f) },
  ];
  const recent = await rows<{ id: number; no: string; buyer: string | null; v: string | null; lr: string; d: string }>(sql`
    select o.id, o.do_no as no, o.buyer_name as buyer, o.vehicle_no as v, o.lr_status as lr, to_char(o.dispatched_at at time zone 'Asia/Kolkata', 'DD Mon') as d
      from wms.dispatch_order o where ${impWhere(lens, f, sql`o.importer_id`)} and ${whWhere(lens, f, sql`o.warehouse_id`)} and o.status = 'DISPATCHED'
     order by o.dispatched_at desc limit 8`);
  const inwards = await rows<{ id: number; code: string; s: string; d: string | null }>(sql`
    select r.id, r.code, r.status as s, to_char(r.expected_arrival, 'DD Mon') as d from wms.inward_request r
     where ${scopeWhere(lens, f, sql`r.warehouse_id`, sql`r.importer_id`)} and r.deleted_at is null and r.status in ('DRAFT','SUBMITTED','NEEDS_CHANGES','ACKNOWLEDGED','IN_PROCESS')
     order by r.created_at desc limit 8`);
  const LR: Record<string, string> = { PENDING: "LR pending", COLLECTED: "LR collected", SUBMITTED: "LR with manager", UPLOADED: "LR attached", VERIFIED: "LR verified", REJECTED: "LR rejected" };
  const IW: Record<string, string> = { DRAFT: "Draft", SUBMITTED: "Submitted", NEEDS_CHANGES: "Needs changes", ACKNOWLEDGED: "Acknowledged", IN_PROCESS: "In process" };
  return {
    tiles,
    charts,
    lists: [
      { key: "recent", title: "Recent dispatches", rows: recent.map((x) => ({ title: `${x.no} · ${x.buyer ?? ""}`, subtitle: `${x.d} · ${x.v ?? ""}`, badge: LR[x.lr] ?? x.lr, tone: x.lr === "VERIFIED" ? ("good" as const) : ("default" as const), href: `/admin/outward/${x.id}` })), empty: "Nothing dispatched yet." },
      { key: "inward", title: "My inward requests", rows: inwards.map((x) => ({ title: x.code, subtitle: x.d ? `Expected ${x.d}` : null, badge: IW[x.s] ?? x.s, tone: x.s === "NEEDS_CHANGES" ? ("warn" as const) : ("default" as const), href: `/admin/inward/${x.id}` })), empty: "No open inward request." },
    ],
  };
}

// ── 9. My sales (agent) ───────────────────────────────────────────

export async function agent(lens: Lens, f: Filters): Promise<Built> {
  const NW = sql`${impWhere(lens, f, sql`n.importer_id`)} and ${agentWhere(lens, sql`n.created_by`)}`;
  const t = await one<Record<string, number>>(sql`
    select count(*) filter (where n.dn_date between ${f.from}::date and ${f.to}::date)::int as made,
           count(*) filter (where n.status = 'PENDING')::int as wait,
           count(distinct lower(n.buyer_name)) filter (where n.dn_date between ${f.from}::date and ${f.to}::date)::int as buyers
      from wms.delivery_note n where ${NW}`);
  const out = await one<{ n: number }>(sql`
    select count(*)::int as n from wms.inward_carton c join wms.delivery_note n on n.id = c.dn_id
     where ${NW} and c.status = 'DISPATCHED' and ${inPeriod(f, sql`c.dispatched_at`)}`);
  const tiles: Tile[] = [
    { key: "made", label: "Notes made", value: n(t.made), format: "int", href: rep("note-register", f) },
    { key: "wait", label: "Waiting approval", value: n(t.wait), format: "int", tone: n(t.wait) ? "warn" : "default", href: "/admin/delivery-notes" },
    { key: "out", label: "Cartons dispatched", value: n(out.n), format: "int", href: rep("dispatch-register", f) },
    { key: "buyers", label: "Buyers served", value: n(t.buyers), format: "int", href: rep("buyers", f) },
  ];
  const unit = unitOf(f);
  const bs = bucketsOf(f, unit);
  const by = await rows<{ b: string; s: string; n: number }>(sql`
    select ${bucketSql(sql`(n.dn_date::timestamp at time zone 'Asia/Kolkata')`, unit)} as b, n.status as s, count(*)::int as n
      from wms.delivery_note n where ${NW} and n.dn_date between ${f.from}::date and ${f.to}::date group by 1, 2`);
  const buyers = await rows<{ b: string; n: number }>(sql`
    select n.buyer_name as b, coalesce(sum(l.cartons), 0)::int as n from wms.delivery_note n join wms.delivery_line l on l.delivery_note_id = n.id
     where ${NW} and n.status in ('PENDING','APPROVED') and n.dn_date between ${f.from}::date and ${f.to}::date group by 1 order by 2 desc limit 8`);
  const appr = await rows<{ b: string; n: number }>(sql`
    select ${bucketSql(sql`n.approved_at`, unit)} as b, avg(extract(epoch from (n.approved_at - n.created_at)) / 3600)::float as n
      from wms.delivery_note n where ${NW} and n.approved_at is not null and ${inPeriod(f, sql`n.approved_at`)} group by 1`);
  const S = [
    ["PENDING", "Waiting", "amber"],
    ["APPROVED", "Approved", "teal"],
    ["REJECTED", "Rejected", "rose"],
    ["CANCELLED", "Cancelled", "slate"],
  ] as const;
  const charts: Chart[] = [
    { key: "notes", title: "Notes made", kind: "stacked", labels: bs.map((b) => bucketLabel(b, unit)), series: S.map(([s, name, color]) => ({ name, color, data: align(bs, by.filter((x) => x.s === s)) })), format: "int", wide: true },
    { key: "buyers", title: "Top buyers (cartons)", kind: "hbar", labels: buyers.map((x) => x.b), series: [{ name: "Cartons", data: buyers.map((x) => n(x.n)), color: "violet" }], format: "int", href: rep("buyers", f) },
    { key: "appr", title: "Hours to approval", kind: "line", labels: bs.map((b) => bucketLabel(b, unit)), series: [{ name: "Hours", data: align(bs, appr).map((v) => Math.round(v * 10) / 10), color: "amber" }], format: "hours" },
  ];
  const mine = await rows<{ id: number; dn: string; buyer: string; s: string; ws: string }>(sql`
    select n.id, n.dn_no as dn, n.buyer_name as buyer, n.status as s, n.work_status as ws from wms.delivery_note n
     where ${NW} and n.status in ('PENDING','APPROVED') and n.short_closed_at is null and n.work_status not in ('DISPATCHED','CANCELLED','RETURNING')
     order by n.created_at desc limit 10`);
  const WW: Record<string, string> = { NEW: "New", ASSIGNED: "Assigned", PARTIALLY_PICKED: "Picking", PICKED: "Picked", PACKAGING_IN_PROGRESS: "Packing", PARTIALLY_PACKAGED: "Packing", PACKAGED: "Packed", VERIFICATION_PENDING: "Verifying", READY_FOR_DISPATCH: "Ready for outward", PARTIALLY_DISPATCHED: "Partly dispatched" };
  return {
    tiles,
    charts,
    lists: [{ key: "mine", title: "My notes in progress", rows: mine.map((x) => ({ title: `${x.dn} · ${x.buyer}`, badge: x.s === "PENDING" ? "Waiting approval" : WW[x.ws] ?? x.ws, tone: x.s === "PENDING" ? ("warn" as const) : ("default" as const), href: `/admin/delivery-notes/${x.id}` })), empty: "No note in progress." }],
  };
}
