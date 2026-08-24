import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db";
import type { Actor } from "@/lib/auth/guard";
import { actorWarehouseIds } from "@/lib/users/authority";

/**
 * The same graph, read four ways.
 *
 * People, roles, sites and customers form one graph, and which axis you
 * put first decides which question it answers. A site-first tree answers
 * "who works at Nashik and what can they do?" and cannot answer "who
 * holds Storage Manager?" without reading every site. Worse, a
 * site-first tree structurally CANNOT show three things that exist:
 *
 *   · the platform-role assignments — Super Admin, Expense Admin,
 *     Transporter Admin — which carry no `warehouse_id` because they
 *     apply everywhere;
 *   · the importer-side assignments, which hang off a customer;
 *   · a role nobody holds. PACKAGE_MANAGER has 13 permissions and zero
 *     holders, and that is exactly the sort of thing worth seeing.
 *
 * So: four builders, one screen, and the view is in the URL.
 *
 * ── What is NOT here ──────────────────────────────────────────────
 *
 * Permissions. A super admin has 156 of them, and 22 users expanded at
 * once is several thousand nodes shipped to render the handful somebody
 * opens. The skeleton carries COUNTS; the list itself is fetched per
 * user on expand — see `api/v1/admin/org/user/[id]/permissions`.
 */

export const VIEWS = {
  site: "By site",
  role: "By role",
  line: "By reporting line",
  customer: "By customer",
} as const;

export type ViewKey = keyof typeof VIEWS;
export const DEFAULT_VIEW: ViewKey = "site";

export function isView(value: string): value is ViewKey {
  return Object.hasOwn(VIEWS, value);
}

/** One node, whatever the view. The renderer does not need to know
 *  which builder made it. */
export type OrgNode = {
  id: string;
  /** The main line. */
  label: string;
  /** Under it, smaller — an email, a code, a role key. */
  sub?: string | null;
  /** Right-hand side: "8 people · 5 roles", "level 40 · 14 perms". */
  meta?: string | null;
  kind: "site" | "role" | "user" | "importer" | "group";
  /** Set on a user node, so the leaf can fetch their permissions. */
  userId?: number;
  /** How many permissions this user holds, known without fetching them. */
  permissions?: number;
  /** Drawn in amber — a role nobody holds, a site nobody works at. */
  warn?: boolean;
  children?: OrgNode[];
};

/**
 * Which sites this caller may see.
 *
 * `null` means every one of them. Unlike the audit log — where the
 * column that would scope it is never written — `user_role_assignment`
 * carries a real `warehouse_id` on all fifteen warehouse assignments,
 * so a warehouse admin genuinely can be shown their own sites and no
 * others. Same pair the users list uses.
 */
function visibleSites(actor: Actor, scope: string): number[] | null {
  if (scope === "ALL") return null;
  const mine = actorWarehouseIds(actor);
  // A warehouse-scoped grant with no site attached sees nothing rather
  // than everything. Failing open here would be the whole point missed.
  return mine.length > 0 ? mine : [];
}

const person = (first: string, last: string, email: string) =>
  `${first} ${last}`.trim() || email;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

// ── shared reads ──────────────────────────────────────────────────

type Assignment = {
  user_id: number;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  role: string;
  role_name: string;
  domain: string;
  level: number;
  warehouse_id: number | null;
  warehouse_code: string | null;
  warehouse_name: string | null;
  importer_id: number | null;
  importer_code: string | null;
  importer_name: string | null;
  perms: number;
};

/**
 * Every live assignment, with the site or customer it applies to and the
 * holder's effective permission count.
 *
 * One query for all four views. The alternative — a query per view —
 * meant four places to get the `revoked_at is null` filter wrong, and a
 * tree that quietly lists somebody whose role was taken away.
 */
async function readAssignments(sites: number[] | null): Promise<Assignment[]> {
  const gate: SQL =
    sites === null
      ? sql``
      : sites.length === 0
        ? sql`and false`
        : sql`and (ura.warehouse_id in (${sql.join(
            sites.map((id) => sql`${id}`),
            sql`, `,
          )}))`;

  return getDb().execute<Assignment>(sql`
    select ura.user_id, u.first_name, u.last_name, u.email::text as email,
           u.status::text as status,
           ura.role::text as role, r.name as role_name,
           r.domain::text as domain, r.level,
           ura.warehouse_id, w.code as warehouse_code, w.name as warehouse_name,
           ura.importer_id, i.code as importer_code, i.company_name as importer_name,
           coalesce(pc.n, 0)::int as perms
      from wms.user_role_assignment ura
      join wms.users u on u.id = ura.user_id and u.deleted_at is null
      join wms.role r on r.key = ura.role
      left join wms.warehouse w on w.id = ura.warehouse_id
      left join wms.importer i on i.id = ura.importer_id
      left join (
        select user_id, count(*)::int as n
          from wms.user_effective_permission group by user_id
      ) pc on pc.user_id = ura.user_id
     where ura.revoked_at is null ${gate}
     order by r.level desc, r.name, u.first_name, u.last_name
  `);
}

// ── 1. by site ────────────────────────────────────────────────────

export async function siteTree(actor: Actor, scope: string): Promise<OrgNode[]> {
  const sites = visibleSites(actor, scope);
  const assignments = await readAssignments(sites);

  const gate: SQL =
    sites === null
      ? sql``
      : sites.length === 0
        ? sql`and false`
        : sql`and (w.id in (${sql.join(
            sites.map((id) => sql`${id}`),
            sql`, `,
          )}))`;

  const warehouses = await getDb().execute<{
    id: number;
    code: string;
    name: string;
  }>(sql`
    select w.id, w.code, w.name from wms.warehouse w
     where w.deleted_at is null ${gate}
     order by w.code
  `);

  const out: OrgNode[] = [];
  /** Sites with nobody on them collapse into one line at the end. Nine
   *  of the fourteen are empty today, and nine empty branches read as a
   *  broken page rather than as a fact about the business. */
  const empty: string[] = [];

  for (const w of warehouses) {
    const here = assignments.filter((a) => a.warehouse_id === Number(w.id));
    if (here.length === 0) {
      empty.push(`${w.code} · ${w.name}`);
      continue;
    }

    const byRole = new Map<string, Assignment[]>();
    for (const a of here) {
      if (!byRole.has(a.role)) byRole.set(a.role, []);
      byRole.get(a.role)!.push(a);
    }

    out.push({
      id: `site-${w.id}`,
      label: `${w.code} · ${w.name}`,
      kind: "site",
      meta: `${plural(new Set(here.map((a) => a.user_id)).size, "person", "people")} · ${plural(byRole.size, "role")}`,
      children: [...byRole.entries()].map(([role, rows]) => ({
        id: `site-${w.id}-role-${role}`,
        label: rows[0]!.role_name,
        sub: role,
        kind: "role" as const,
        meta: `level ${rows[0]!.level} · ${plural(rows.length, "person", "people")}`,
        children: rows.map((a) => userNode(`site-${w.id}-${role}`, a)),
      })),
    });
  }

  /**
   * The platform roles, which have no site to sit under and apply to
   * every one of them. Shown as their own branch rather than dropped —
   * a hierarchy that omits the super admin is not a hierarchy.
   */
  const platform = assignments.filter((a) => a.domain === "PLATFORM");
  if (platform.length > 0) {
    const byRole = new Map<string, Assignment[]>();
    for (const a of platform) {
      if (!byRole.has(a.role)) byRole.set(a.role, []);
      byRole.get(a.role)!.push(a);
    }
    out.unshift({
      id: "site-platform",
      label: "Platform-wide",
      sub: "roles that apply at every site",
      kind: "group",
      meta: `${plural(new Set(platform.map((a) => a.user_id)).size, "person", "people")} · ${plural(byRole.size, "role")}`,
      children: [...byRole.entries()].map(([role, rows]) => ({
        id: `platform-role-${role}`,
        label: rows[0]!.role_name,
        sub: role,
        kind: "role" as const,
        meta: `level ${rows[0]!.level} · ${plural(rows.length, "person", "people")}`,
        children: rows.map((a) => userNode(`platform-${role}`, a)),
      })),
    });
  }

  if (empty.length > 0) {
    out.push({
      id: "site-empty",
      label: `${plural(empty.length, "site")} with nobody assigned`,
      kind: "group",
      warn: true,
      meta: "no roles here yet",
      children: empty.map((label, i) => ({
        id: `site-empty-${i}`,
        label,
        kind: "site" as const,
        meta: "nobody assigned",
      })),
    });
  }

  return out;
}

function userNode(prefix: string, a: Assignment): OrgNode {
  return {
    id: `${prefix}-user-${a.user_id}`,
    label: person(a.first_name, a.last_name, a.email),
    sub: a.email,
    kind: "user",
    userId: Number(a.user_id),
    permissions: Number(a.perms),
    meta: `${plural(Number(a.perms), "permission")}${a.status === "ACTIVE" ? "" : ` · ${a.status.toLowerCase()}`}`,
    warn: a.status !== "ACTIVE",
    // The leaf the renderer fills in on expand.
    children: [],
  };
}

// ── 2. by role ────────────────────────────────────────────────────

export async function roleTree(actor: Actor, scope: string): Promise<OrgNode[]> {
  const sites = visibleSites(actor, scope);
  const assignments = await readAssignments(sites);

  /**
   * Every role, held or not.
   *
   * The point of this view: a role with permissions and no holders is
   * invisible in a site-first tree, and PACKAGE_MANAGER is exactly that
   * — thirteen permissions, nobody. Reading the roles table rather than
   * grouping the assignments is what surfaces it.
   */
  const roles = await getDb().execute<{
    key: string;
    name: string;
    domain: string;
    level: number;
    perms: number;
  }>(sql`
    select r.key::text as key, r.name, r.domain::text as domain, r.level,
           (select count(*)::int from wms.role_permission rp where rp.role = r.key) as perms
      from wms.role r
     order by r.level desc, r.name
  `);

  return roles.map((r) => {
    const held = assignments.filter((a) => a.role === r.key);

    /** Grouped by where it applies, so one person holding the same role
     *  at two sites reads as two placements rather than a duplicate. */
    const byPlace = new Map<string, { label: string; rows: Assignment[] }>();
    for (const a of held) {
      const key = a.warehouse_id
        ? `w${a.warehouse_id}`
        : a.importer_id
          ? `i${a.importer_id}`
          : "platform";
      const label = a.warehouse_id
        ? `${a.warehouse_code} · ${a.warehouse_name}`
        : a.importer_id
          ? `${a.importer_code} · ${a.importer_name}`
          : "Platform-wide";
      if (!byPlace.has(key)) byPlace.set(key, { label, rows: [] });
      byPlace.get(key)!.rows.push(a);
    }

    return {
      id: `role-${r.key}`,
      label: r.name,
      sub: r.key,
      kind: "role" as const,
      warn: held.length === 0,
      meta:
        `${r.domain.toLowerCase()} · level ${r.level} · ${plural(Number(r.perms), "permission")} · ` +
        (held.length === 0 ? "nobody holds it" : plural(held.length, "holder")),
      children: [...byPlace.values()].map((place, i) => ({
        id: `role-${r.key}-place-${i}`,
        label: place.label,
        kind: "site" as const,
        meta: plural(place.rows.length, "person", "people"),
        children: place.rows.map((a) => userNode(`role-${r.key}-${i}`, a)),
      })),
    };
  });
}

// ── 3. by reporting line ──────────────────────────────────────────

export async function lineTree(actor: Actor, scope: string): Promise<OrgNode[]> {
  const sites = visibleSites(actor, scope);

  /**
   * `users.path` is the ltree the `set_user_path` trigger maintains, and
   * it is fully populated — every account carries its ancestry. Nothing
   * else in the panel shows it.
   *
   * Read flat and nested in memory rather than recursed in SQL: the
   * whole table is a few dozen rows, and one query beats a recursive CTE
   * that has to be re-explained every time somebody reads it.
   */
  const rows = await getDb().execute<{
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    status: string;
    created_by: number | null;
    depth: number;
    roles: string | null;
    perms: number;
  }>(sql`
    select u.id, u.first_name, u.last_name, u.email::text as email,
           u.status::text as status, u.created_by,
           extensions.nlevel(u.path) as depth,
           (select string_agg(
                     r.name || coalesce(' @ ' || w.code, '') ||
                     coalesce(' @ ' || i.code, ''), ', ' order by r.level desc)
              from wms.user_role_assignment ura
              join wms.role r on r.key = ura.role
              left join wms.warehouse w on w.id = ura.warehouse_id
              left join wms.importer i on i.id = ura.importer_id
             where ura.user_id = u.id and ura.revoked_at is null) as roles,
           (select count(*)::int from wms.user_effective_permission p
             where p.user_id = u.id) as perms
      from wms.users u
     where u.deleted_at is null
     order by u.path
  `);

  /**
   * A warehouse admin sees their own line: themselves, and everybody
   * whose account descends from theirs. Not the whole company, and not
   * the accounts above them.
   */
  const reachable =
    sites === null
      ? null
      : new Set<number>(
          (() => {
            const mine = new Set<number>([actor.session.userId]);
            // One pass down the list is enough because it is ordered by
            // path, so a parent is always seen before its children.
            for (const r of rows) {
              if (r.created_by !== null && mine.has(Number(r.created_by))) mine.add(Number(r.id));
            }
            return mine;
          })(),
        );

  const visible = rows.filter((r) => reachable === null || reachable.has(Number(r.id)));
  const byId = new Map<number, OrgNode>();
  const created = new Map<number, number>();
  for (const r of visible) created.set(Number(r.id), 0);
  for (const r of visible) {
    if (r.created_by !== null && created.has(Number(r.created_by))) {
      created.set(Number(r.created_by), (created.get(Number(r.created_by)) ?? 0) + 1);
    }
  }

  for (const r of visible) {
    const madeCount = created.get(Number(r.id)) ?? 0;
    byId.set(Number(r.id), {
      id: `line-${r.id}`,
      label: person(r.first_name, r.last_name, r.email),
      sub: r.roles ?? "no role",
      kind: "user",
      userId: Number(r.id),
      permissions: Number(r.perms),
      warn: r.status !== "ACTIVE",
      meta:
        `${plural(Number(r.perms), "permission")}` +
        (madeCount > 0 ? ` · created ${plural(madeCount, "account")}` : "") +
        (r.status === "ACTIVE" ? "" : ` · ${r.status.toLowerCase()}`),
      children: [],
    });
  }

  const roots: OrgNode[] = [];
  for (const r of visible) {
    const node = byId.get(Number(r.id))!;
    const parent = r.created_by === null ? undefined : byId.get(Number(r.created_by));
    if (parent) parent.children!.push(node);
    else roots.push(node);
  }
  return roots;
}

// ── 4. by customer ────────────────────────────────────────────────

export async function customerTree(actor: Actor, scope: string): Promise<OrgNode[]> {
  // The importer side is not scoped by warehouse — a customer belongs to
  // the platform, not to a site. A warehouse-scoped caller gets nothing
  // here rather than a partial answer.
  if (scope !== "ALL") return [];
  void actor;

  const assignments = await readAssignments(null);
  const importers = await getDb().execute<{
    id: number;
    code: string;
    company_name: string;
    status: string;
  }>(sql`
    select id, code, company_name, status::text as status
      from wms.importer where deleted_at is null order by code
  `);

  const out: OrgNode[] = [];
  const empty: string[] = [];

  for (const imp of importers) {
    const here = assignments.filter((a) => a.importer_id === Number(imp.id));
    if (here.length === 0) {
      empty.push(`${imp.code} · ${imp.company_name}`);
      continue;
    }
    const byRole = new Map<string, Assignment[]>();
    for (const a of here) {
      if (!byRole.has(a.role)) byRole.set(a.role, []);
      byRole.get(a.role)!.push(a);
    }
    out.push({
      id: `imp-${imp.id}`,
      label: `${imp.code} · ${imp.company_name}`,
      kind: "importer",
      warn: imp.status !== "ACTIVE",
      meta:
        `${plural(new Set(here.map((a) => a.user_id)).size, "person", "people")}` +
        (imp.status === "ACTIVE" ? "" : ` · ${imp.status.toLowerCase()}`),
      children: [...byRole.entries()].map(([role, rows]) => ({
        id: `imp-${imp.id}-role-${role}`,
        label: rows[0]!.role_name,
        sub: role,
        kind: "role" as const,
        meta: plural(rows.length, "person", "people"),
        children: rows.map((a) => userNode(`imp-${imp.id}-${role}`, a)),
      })),
    });
  }

  if (empty.length > 0) {
    out.push({
      id: "imp-empty",
      label: `${plural(empty.length, "customer")} with no accounts`,
      kind: "group",
      warn: true,
      meta: "registered, nobody signed up",
      children: empty.map((label, i) => ({
        id: `imp-empty-${i}`,
        label,
        kind: "importer" as const,
        meta: "no accounts",
      })),
    });
  }

  return out;
}

export async function buildTree(
  view: ViewKey,
  actor: Actor,
  scope: string,
): Promise<OrgNode[]> {
  if (view === "role") return roleTree(actor, scope);
  if (view === "line") return lineTree(actor, scope);
  if (view === "customer") return customerTree(actor, scope);
  return siteTree(actor, scope);
}

// ── the permissions leaf ──────────────────────────────────────────

export type PermissionGroup = {
  module: string;
  /** `resource → the verbs held on it`, already sorted. */
  rows: { resource: string; verbs: string[]; scope: string; fromRole: boolean }[];
};

/**
 * One person's effective permissions, grouped for reading.
 *
 * A super admin holds 156. As a flat list that is a wall, so it comes
 * back as module → resource → verbs, which is the shape of the question
 * ("can they delete an expense?") rather than the shape of the table.
 *
 * `fromRole` is false when the only thing granting it is an exception —
 * `granted_by_roles` comes back empty for those, which is precisely how
 * the view distinguishes an allowance from a role.
 */
export async function readUserPermissions(userId: number): Promise<PermissionGroup[]> {
  const rows = await getDb().execute<{
    module: string;
    resource: string;
    action: string;
    scope: string;
    from_role: boolean;
  }>(sql`
    select p.module, p.resource, p.action,
           uep.scope::text as scope,
           coalesce(array_length(uep.granted_by_roles, 1), 0) > 0 as from_role
      from wms.user_effective_permission uep
      join wms.permission p on p.key = uep.permission
     where uep.user_id = ${userId}
     order by p.module, p.resource, p.action
  `);

  const VERB_ORDER = ["read", "create", "update", "delete", "approve", "export", "assign"];
  const byModule = new Map<string, Map<string, { verbs: string[]; scope: string; fromRole: boolean }>>();

  for (const r of rows) {
    if (!byModule.has(r.module)) byModule.set(r.module, new Map());
    const res = byModule.get(r.module)!;
    if (!res.has(r.resource)) {
      res.set(r.resource, { verbs: [], scope: r.scope, fromRole: Boolean(r.from_role) });
    }
    const entry = res.get(r.resource)!;
    entry.verbs.push(r.action);
    // A resource whose verbs disagree on scope shows the widest, which
    // is the one that decides what the person can actually reach.
    if (rank(r.scope) > rank(entry.scope)) entry.scope = r.scope;
    // One verb held only by exception marks the row: that is the part
    // worth noticing on a page about who can do what.
    if (!r.from_role) entry.fromRole = false;
  }

  return [...byModule.entries()].map(([module, res]) => ({
    module,
    rows: [...res.entries()].map(([resource, v]) => ({
      resource,
      verbs: [...v.verbs].sort((a, b) => VERB_ORDER.indexOf(a) - VERB_ORDER.indexOf(b)),
      scope: v.scope,
      fromRole: v.fromRole,
    })),
  }));
}

const rank = (s: string) => (s === "ALL" ? 3 : s === "WAREHOUSE" ? 2 : 1);
