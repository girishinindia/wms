/**
 * The inward list's search, filters and sort — pure, so they run on the
 * screen as the person types (no trip to the server) and the tests can
 * check them without a browser.
 */

import type { BoardRow } from "@/lib/inward/ops";

export type StatusChip = "OPEN" | "DRAFT" | "SUBMITTED" | "NEEDS_CHANGES" | "ACKNOWLEDGED" | "IN_PROCESS" | "COMPLETED" | "CANCELLED" | "ALL";

export const OPEN: readonly string[] = ["DRAFT", "SUBMITTED", "NEEDS_CHANGES", "ACKNOWLEDGED", "IN_PROCESS"];

export type ArrivalFilter = "" | "overdue" | "today" | "tomorrow" | "week" | "next7" | "range";
export type StageFilter = "" | "not_numbered" | "print_pending" | "receiving" | "all_received" | "not_stored";
export type SortKey = "action" | "arrival" | "newest" | "number" | "cartons";

export type BoardFilters = {
  status: StatusChip;
  q: string;
  warehouseId: number | null;
  importerId: number | null;
  transporterId: number | null;
  portId: number | null;
  containerTypeId: number | null;
  arrival: ArrivalFilter;
  from: string; // YYYY-MM-DD, with arrival = "range"
  to: string;
  stage: StageFilter;
  sort: SortKey;
};

export const EMPTY_FILTERS: BoardFilters = {
  status: "OPEN",
  q: "",
  warehouseId: null,
  importerId: null,
  transporterId: null,
  portId: null,
  containerTypeId: null,
  arrival: "",
  from: "",
  to: "",
  stage: "",
  sort: "action",
};

export const ARRIVAL_OPTIONS: { value: ArrivalFilter; label: string }[] = [
  { value: "", label: "Any arrival date" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Arriving today" },
  { value: "tomorrow", label: "Arriving tomorrow" },
  { value: "week", label: "This week" },
  { value: "next7", label: "Next 7 days" },
  { value: "range", label: "Between dates…" },
];

export const STAGE_OPTIONS: { value: StageFilter; label: string }[] = [
  { value: "", label: "Any carton stage" },
  { value: "not_numbered", label: "Not numbered yet" },
  { value: "print_pending", label: "Stickers to print" },
  { value: "receiving", label: "Receiving at the dock" },
  { value: "all_received", label: "All received" },
  { value: "not_stored", label: "Received, not stored" },
];

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "action", label: "Needs action first" },
  { value: "arrival", label: "Arrival date" },
  { value: "newest", label: "Newest first" },
  { value: "number", label: "Request number" },
  { value: "cartons", label: "Most cartons" },
];

/** Today in India, YYYY-MM-DD — "overdue" and "today" are counted there. */
export function todayIST(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday–Sunday of the week `day` falls in. */
function weekOf(day: string): [string, string] {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = addDays(day, -dow);
  return [monday, addDays(monday, 6)];
}

export function matchesStatus(r: { status: string }, chip: StatusChip): boolean {
  if (chip === "ALL") return true;
  if (chip === "OPEN") return OPEN.includes(r.status);
  return r.status === chip;
}

export function matchesStage(r: BoardRow, stage: StageFilter): boolean {
  if (!stage) return true;
  const c = r.cartonCounts;
  const working = r.status === "ACKNOWLEDGED" || r.status === "IN_PROCESS";
  const inside = c.received + c.hold;
  switch (stage) {
    case "not_numbered":
      return working && c.generated === 0;
    case "print_pending":
      return c.generated > 0 && c.printed < c.generated;
    case "receiving":
      return c.generated > 0 && inside > 0 && inside < c.generated;
    case "all_received":
      return c.generated > 0 && inside >= c.generated;
    case "not_stored":
      return c.received > c.stored;
  }
}

export function matchesArrival(r: { expectedArrival: string | null; status: string }, f: BoardFilters, today: string): boolean {
  if (!f.arrival) return true;
  const day = r.expectedArrival;
  if (!day) return false;
  switch (f.arrival) {
    case "overdue":
      return day < today && OPEN.includes(r.status);
    case "today":
      return day === today;
    case "tomorrow":
      return day === addDays(today, 1);
    case "week": {
      const [a, b] = weekOf(today);
      return day >= a && day <= b;
    }
    case "next7":
      return day >= today && day <= addDays(today, 7);
    case "range":
      return (!f.from || day >= f.from) && (!f.to || day <= f.to);
  }
}

/** Every filter except the status chip — the chips count over this. */
export function matchesOthers(r: BoardRow, f: BoardFilters, today: string): boolean {
  const words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length && !words.every((w) => r.find.includes(w))) return false;
  if (f.warehouseId !== null && r.warehouse.id !== f.warehouseId) return false;
  if (f.importerId !== null && r.importer.id !== f.importerId) return false;
  if (f.transporterId !== null && r.transporter?.id !== f.transporterId) return false;
  if (f.portId !== null && r.port?.id !== f.portId) return false;
  if (f.containerTypeId !== null && r.containerType?.id !== f.containerTypeId) return false;
  if (!matchesArrival(r, f, today)) return false;
  return matchesStage(r, f.stage);
}

const ACTION_RANK: Record<string, number> = { SUBMITTED: 0, NEEDS_CHANGES: 1, DRAFT: 2, ACKNOWLEDGED: 3, IN_PROCESS: 4 };

function sortRows(rows: BoardRow[], key: SortKey): BoardRow[] {
  const far = "9999-12-31";
  const byArrival = (a: BoardRow, b: BoardRow) => (a.expectedArrival ?? far).localeCompare(b.expectedArrival ?? far);
  const copy = [...rows];
  switch (key) {
    case "action":
      return copy.sort(
        (a, b) => (ACTION_RANK[a.status] ?? 9) - (ACTION_RANK[b.status] ?? 9) || byArrival(a, b) || b.updatedAt.localeCompare(a.updatedAt),
      );
    case "arrival":
      return copy.sort((a, b) => byArrival(a, b) || a.code.localeCompare(b.code));
    case "newest":
      return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case "number":
      return copy.sort((a, b) => b.code.localeCompare(a.code));
    case "cartons":
      return copy.sort((a, b) => b.totals.cartons - a.totals.cartons || a.code.localeCompare(b.code));
  }
}

/** The rows to show, and how many each status chip would show. */
export function applyBoard(rows: BoardRow[], f: BoardFilters, today: string = todayIST()) {
  const others = rows.filter((r) => matchesOthers(r, f, today));
  const counts: Record<StatusChip, number> = {
    OPEN: 0, DRAFT: 0, SUBMITTED: 0, NEEDS_CHANGES: 0, ACKNOWLEDGED: 0, IN_PROCESS: 0, COMPLETED: 0, CANCELLED: 0, ALL: others.length,
  };
  for (const r of others) {
    if (r.status in counts) counts[r.status as StatusChip] += 1;
    if (OPEN.includes(r.status)) counts.OPEN += 1;
  }
  return { rows: sortRows(others.filter((r) => matchesStatus(r, f.status)), f.sort), counts };
}

/** How many filters (besides status and search) are set — for the "Clear" button. */
export function activeFilterCount(f: BoardFilters): number {
  return [f.warehouseId, f.importerId, f.transporterId, f.portId, f.containerTypeId].filter((v) => v !== null).length
    + (f.arrival ? 1 : 0)
    + (f.stage ? 1 : 0)
    + (f.sort !== "action" ? 1 : 0);
}

// ── The address bar keeps the view (copy the link, press Back) ──

const NUM_KEYS = ["warehouseId", "importerId", "transporterId", "portId", "containerTypeId"] as const;

export function filtersFromParams(p: URLSearchParams | Record<string, string | string[] | undefined>): BoardFilters {
  const get = (k: string) => {
    if (p instanceof URLSearchParams) return p.get(k) ?? "";
    const v = p[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const f: BoardFilters = { ...EMPTY_FILTERS };
  const status = get("status");
  if (["OPEN", "DRAFT", "SUBMITTED", "NEEDS_CHANGES", "ACKNOWLEDGED", "IN_PROCESS", "COMPLETED", "CANCELLED", "ALL"].includes(status)) {
    f.status = status as StatusChip;
  }
  f.q = get("q").slice(0, 60);
  for (const k of NUM_KEYS) {
    const n = Number(get(k));
    f[k] = Number.isInteger(n) && n > 0 ? n : null;
  }
  const arrival = get("arrival");
  if (ARRIVAL_OPTIONS.some((o) => o.value === arrival)) f.arrival = arrival as ArrivalFilter;
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (date.test(get("from"))) f.from = get("from");
  if (date.test(get("to"))) f.to = get("to");
  const stage = get("stage");
  if (STAGE_OPTIONS.some((o) => o.value === stage)) f.stage = stage as StageFilter;
  const sort = get("sort");
  if (SORT_OPTIONS.some((o) => o.value === sort)) f.sort = sort as SortKey;
  return f;
}

export function filtersToParams(f: BoardFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status !== "OPEN") p.set("status", f.status);
  if (f.q.trim()) p.set("q", f.q.trim());
  for (const k of NUM_KEYS) if (f[k] !== null) p.set(k, String(f[k]));
  if (f.arrival) p.set("arrival", f.arrival);
  if (f.arrival === "range" && f.from) p.set("from", f.from);
  if (f.arrival === "range" && f.to) p.set("to", f.to);
  if (f.stage) p.set("stage", f.stage);
  if (f.sort !== "action") p.set("sort", f.sort);
  return p;
}

/** The choices for a filter box, from the rows themselves (only what exists). */
export function optionsOf<T extends { id: number; name: string }>(rows: BoardRow[], pick: (r: BoardRow) => T | null): T[] {
  const seen = new Map<number, T>();
  for (const r of rows) {
    const v = pick(r);
    if (v && !seen.has(v.id)) seen.set(v.id, v);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
