import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { grantFor, importerIdOf, type Actor } from "@/lib/auth/guard";
import { InwardError } from "@/lib/inward/ops";
import { isAgentOnly } from "@/lib/sales-agents/scope";

/**
 * What a dashboard or report may look at, decided from the caller's grant
 * — never from the request. A filter can only narrow it.
 *
 *   all        super admin (any warehouse, any importer)
 *   warehouse  warehouse staff: their warehouses, every importer there
 *   importer   the importer: their company, every warehouse
 *   agent      a sales agent: their company, only the notes they made
 */
export type Lens =
  | { kind: "all" }
  | { kind: "warehouse"; warehouseIds: number[] }
  | { kind: "importer"; importerId: number }
  | { kind: "agent"; importerId: number; userId: number };

export type LensKind = Lens["kind"];

/** The lens a permission gives, or null when the caller lacks it (or only has an empty warehouse list). */
export function lensFor(actor: Actor, permission: string, allowed: LensKind[] = ["all", "warehouse", "importer", "agent"]): Lens | null {
  const g = grantFor(actor, permission);
  if (!g) return null;
  let lens: Lens | null = null;
  if (g.scope === "ALL") lens = { kind: "all" };
  else if (g.scope === "WAREHOUSE") lens = g.warehouseIds.length ? { kind: "warehouse", warehouseIds: [...new Set(g.warehouseIds)] } : null;
  else {
    const importerId = importerIdOf(actor);
    if (importerId !== null) lens = isAgentOnly(actor) ? { kind: "agent", importerId, userId: actor.session.userId } : { kind: "importer", importerId };
  }
  return lens && allowed.includes(lens.kind) ? lens : null;
}

/** Staff (all / warehouse) lens of the narrowest of several permissions — every one must be held. */
export function staffLens(actor: Actor, permissions: string[]): Lens | null {
  let ids: number[] | null = null;
  for (const p of permissions) {
    const l = lensFor(actor, p, ["all", "warehouse"]);
    if (!l) return null;
    if (l.kind === "warehouse") ids = ids === null ? l.warehouseIds : ids.filter((w) => l.warehouseIds.includes(w));
  }
  if (ids === null) return { kind: "all" };
  return ids.length ? { kind: "warehouse", warehouseIds: ids } : null;
}

// ── Filters ───────────────────────────────────────────────────────

export type Period = "today" | "7d" | "30d" | "90d" | "month" | "fy" | "custom";

export type Filters = {
  period: Period;
  /** YYYY-MM-DD, India time, both ends included. */
  from: string;
  to: string;
  warehouseId: number | null;
  importerId: number | null;
  /** Free extras a report understands (status, transporter…). */
  extra: Record<string, string>;
};

const IST_MS = 330 * 60 * 1000;
export const todayIST = (now = Date.now()) => new Date(now + IST_MS).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function periodRange(period: Period, from?: string | null, to?: string | null): { from: string; to: string } {
  const today = todayIST();
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "90d":
      return { from: addDays(today, -89), to: today };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "fy": {
      const y = Number(today.slice(0, 4));
      const start = Number(today.slice(5, 7)) >= 4 ? y : y - 1;
      return { from: `${start}-04-01`, to: today };
    }
    case "custom": {
      const f = from && DATE.test(from) ? from : addDays(today, -29);
      let t = to && DATE.test(to) ? to : today;
      if (t < f) t = f;
      // A year at most — longer ranges are what the FY preset and reports are for.
      if (Date.parse(t) - Date.parse(f) > 731 * 86_400_000) return { from: f, to: addDays(f, 730) };
      return { from: f, to: t };
    }
    default:
      return { from: addDays(today, -29), to: today };
  }
}

const PERIODS: Period[] = ["today", "7d", "30d", "90d", "month", "fy", "custom"];

export function filtersFrom(params: URLSearchParams, defaultPeriod: Period = "30d"): Filters {
  const p = (params.get("period") ?? defaultPeriod) as Period;
  const period = PERIODS.includes(p) ? p : defaultPeriod;
  const { from, to } = periodRange(period, params.get("from"), params.get("to"));
  const num = (k: string) => {
    const v = Number(params.get(k));
    return Number.isInteger(v) && v > 0 ? v : null;
  };
  const extra: Record<string, string> = {};
  for (const [k, v] of params.entries()) {
    if (!["period", "from", "to", "warehouseId", "importerId", "format", "page", "sort", "dir"].includes(k) && v.trim()) extra[k] = v.trim().slice(0, 100);
  }
  return { period, from, to, warehouseId: num("warehouseId"), importerId: num("importerId"), extra };
}

/** Days in the range (for per-day charts). */
export function daysOf(f: Filters): string[] {
  const out: string[] = [];
  for (let d = f.from; d <= f.to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

// ── SQL pieces ────────────────────────────────────────────────────

const ids = (list: number[]) => sql.join(list.map((v) => sql`${v}`), sql`, `);

/** `col in (warehouses I may see)` and the chosen warehouse, if any. */
export function whWhere(lens: Lens, f: Filters | null, col: SQL): SQL {
  const parts: SQL[] = [];
  if (lens.kind === "warehouse") parts.push(sql`${col} in (${ids(lens.warehouseIds)})`);
  if (f?.warehouseId) parts.push(sql`${col} = ${f.warehouseId}`);
  return parts.length ? sql.join(parts, sql` and `) : sql`true`;
}

/** `col = my importer` (importer / agent) and the chosen importer, if any. */
export function impWhere(lens: Lens, f: Filters | null, col: SQL): SQL {
  const parts: SQL[] = [];
  if (lens.kind === "importer" || lens.kind === "agent") parts.push(sql`${col} = ${lens.importerId}`);
  if (f?.importerId && (lens.kind === "all" || lens.kind === "warehouse")) parts.push(sql`${col} = ${f.importerId}`);
  return parts.length ? sql.join(parts, sql` and `) : sql`true`;
}

/** Both, for a table with warehouse and importer columns. */
export function scopeWhere(lens: Lens, f: Filters | null, wh: SQL, imp: SQL): SQL {
  return sql`(${whWhere(lens, f, wh)}) and (${impWhere(lens, f, imp)})`;
}

/** A sales agent sees only the notes they made. */
export function agentWhere(lens: Lens, createdBy: SQL): SQL {
  return lens.kind === "agent" ? sql`${createdBy} = ${lens.userId}` : sql`true`;
}

/** `ts` falls inside the period (India days, both ends included). */
export function inPeriod(f: Filters, ts: SQL): SQL {
  return sql`(${ts} >= (${f.from}::date)::timestamp at time zone 'Asia/Kolkata' and ${ts} < (${f.to}::date + 1)::timestamp at time zone 'Asia/Kolkata')`;
}

/** The India date of a timestamp. */
export const istDay = (ts: SQL) => sql`(${ts} at time zone 'Asia/Kolkata')::date`;

export function lensError(): never {
  throw new InwardError("FORBIDDEN", "You do not have permission to see this.");
}
