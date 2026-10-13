import "server-only";

import { sql } from "drizzle-orm";

import type { Actor } from "@/lib/auth/guard";
import { InwardError } from "@/lib/inward/ops";

import { executive, inward, outward, pickpack, rows, storage, type Built } from "./dash-ops";
import { agent, expenses, importer, platform } from "./dash-people";
import { lensFor, staffLens, type Filters, type Lens } from "./lens";
import type { DashboardData, DashboardId, DashboardMeta, Option } from "./types";

/**
 * Who sees which dashboard — from the permissions they hold, so a role
 * edited in the role matrix changes its dashboards too:
 *
 *   executive  inward.goods.read + outward.order.read + package.read (beyond own) → super admin, warehouse admin
 *   inward     inward.goods.read (beyond own)       → + inward manager
 *   storage    storage.goods.read (beyond own)      → + storage manager
 *   pickpack   package.read (beyond own)            → + package, storage and dispatch manager
 *   outward    outward.order.read (beyond own)      → + package and dispatch manager, LR collector
 *   expenses   expense.read (beyond own)            → + expense admin and manager
 *   platform   importer.read and user.read at ALL   → super admin
 *   importer   inward.request.read, own company     → the importer
 *   agent      dispatch.order.read, own notes       → the sales agent
 */
export const DASHBOARDS: DashboardMeta[] = [
  { id: "executive", title: "Overview", subtitle: "Stock, flow and what needs attention", icon: "overview" },
  { id: "inward", title: "Inward", subtitle: "Requests, arrivals and the dock", icon: "inward" },
  { id: "storage", title: "Storage", subtitle: "Galas, space and stock age", icon: "storage" },
  { id: "pickpack", title: "Pick & pack", subtitle: "Notes in the warehouse and staff output", icon: "pick" },
  { id: "outward", title: "Outward", subtitle: "Vehicles out and Lorry Receipts", icon: "outward" },
  { id: "expenses", title: "Expenses", subtitle: "Where the money goes", icon: "expenses" },
  { id: "platform", title: "Platform", subtitle: "Importers, users and alerts", icon: "platform" },
  { id: "importer", title: "My stock", subtitle: "Your goods in the warehouse", icon: "stock" },
  { id: "agent", title: "My sales", subtitle: "Your delivery notes and buyers", icon: "sales" },
];

function lensOf(actor: Actor, id: DashboardId): Lens | null {
  switch (id) {
    case "executive":
      return staffLens(actor, ["inward.goods.read", "outward.order.read", "package.read"]);
    case "inward":
      return staffLens(actor, ["inward.goods.read"]);
    case "storage":
      return staffLens(actor, ["storage.goods.read"]);
    case "pickpack":
      return staffLens(actor, ["package.read"]);
    case "outward":
      return staffLens(actor, ["outward.order.read"]);
    case "expenses":
      return staffLens(actor, ["expense.read"]);
    case "platform": {
      const a = lensFor(actor, "importer.read", ["all"]);
      const b = lensFor(actor, "user.read", ["all"]);
      return a && b ? a : null;
    }
    case "importer":
      return lensFor(actor, "inward.request.read", ["importer"]);
    case "agent":
      return lensFor(actor, "dispatch.order.read", ["agent"]);
  }
}

/** The dashboards this person may open, in display order. */
export function dashboardsFor(actor: Actor): DashboardMeta[] {
  return DASHBOARDS.filter((d) => lensOf(actor, d.id) !== null);
}

export async function lensOptions(lens: Lens): Promise<{ warehouses: Option[]; importers: Option[] }> {
  if (lens.kind === "importer" || lens.kind === "agent") {
    const wh = await rows<{ id: number; name: string }>(sql`
      select distinct w.id, w.name from wms.warehouse w join wms.inward_request r on r.warehouse_id = w.id
       where r.importer_id = ${lens.importerId} and r.deleted_at is null order by w.name`);
    return { warehouses: wh.map((x) => ({ id: Number(x.id), label: x.name })), importers: [] };
  }
  const whWhere = lens.kind === "warehouse" ? sql`w.id in (${sql.join(lens.warehouseIds.map((v) => sql`${v}`), sql`, `)})` : sql`true`;
  const wh = await rows<{ id: number; name: string }>(sql`select w.id, w.name from wms.warehouse w where w.deleted_at is null and ${whWhere} order by w.name`);
  const imp = await rows<{ id: number; name: string }>(sql`
    select i.id, i.company_name as name from wms.importer i
     where i.deleted_at is null and i.status in ('ACTIVE','SUSPENDED')
       and ${lens.kind === "warehouse" ? sql`exists (select 1 from wms.inward_request r where r.importer_id = i.id and r.warehouse_id in (${sql.join(lens.warehouseIds.map((v) => sql`${v}`), sql`, `)}))` : sql`true`}
     order by i.company_name limit 500`);
  return { warehouses: wh.map((x) => ({ id: Number(x.id), label: x.name })), importers: imp.map((x) => ({ id: Number(x.id), label: x.name })) };
}

export async function loadDashboard(actor: Actor, id: DashboardId, f: Filters): Promise<DashboardData> {
  const meta = DASHBOARDS.find((d) => d.id === id);
  const lens = meta ? lensOf(actor, id) : null;
  if (!meta || !lens) throw new InwardError("NOT_FOUND", "No such dashboard");
  const opts = await lensOptions(lens);
  // A filter outside what the caller may see is dropped, not obeyed.
  const filters: Filters = {
    ...f,
    warehouseId: f.warehouseId && opts.warehouses.some((w) => w.id === f.warehouseId) ? f.warehouseId : null,
    importerId: f.importerId && opts.importers.some((i) => i.id === f.importerId) ? f.importerId : null,
  };
  let built: Built;
  switch (id) {
    case "executive":
      built = await executive(lens, filters, { expenses: staffLens(actor, ["expense.read"]), importers: lensFor(actor, "importer.read", ["all"]) !== null });
      break;
    case "inward":
      built = await inward(lens, filters);
      break;
    case "storage":
      built = await storage(lens, filters);
      break;
    case "pickpack":
      built = await pickpack(lens, filters);
      break;
    case "outward":
      built = await outward(lens, filters);
      break;
    case "expenses":
      built = await expenses(lens, filters);
      break;
    case "platform":
      built = await platform(filters);
      break;
    case "importer":
      built = await importer(lens, filters);
      break;
    case "agent":
      built = await agent(lens, filters);
      break;
  }
  return {
    meta,
    filters: { period: filters.period, from: filters.from, to: filters.to, warehouseId: filters.warehouseId, importerId: filters.importerId },
    options: id === "platform" ? { warehouses: [], importers: [] } : id === "expenses" ? { warehouses: opts.warehouses, importers: [] } : opts,
    ...built,
    generatedAt: new Date().toISOString(),
  };
}
