/**
 * The admin navigation, and the permission each entry needs.
 *
 * One list, used twice: the sidebar renders from it, and the layout
 * decides who may enter the admin area at all from it. That is
 * deliberate — "which links do I see" and "am I allowed in here" are the
 * same question, and answering them from two lists is how a route ends
 * up reachable by someone who cannot see its link.
 *
 * Kept free of JSX and of `server-only` so both the server layout and
 * the client sidebar can import it.
 */

export type AdminNavItem = {
  href: string;
  label: string;
  /**
   * The permission the SCREEN'S PURPOSE needs, not the weakest one that
   * touches the same table.
   *
   * This distinction is the whole design of this file, and getting it
   * wrong let a customer into the admin area. The obvious key for a
   * master screen is `master.<thing>.read` — and every role in the
   * matrix holds those at ALL scope, because anyone filling in an
   * address needs the list. Keyed on read, the sidebar admitted an
   * IMPORTER. Every master entry is therefore keyed on `.create`, which
   * only a super admin holds.
   *
   * `null` means the entry has no permission of its own and is shown
   * whenever anything else is — the dashboard, which is a summary of the
   * other screens and grants nothing by itself.
   */
  permission: string | null;
  /**
   * Whether an OWN-scoped grant is enough to earn this entry.
   *
   * Off by default — see `visibleNav`. On for the importer's own
   * screens: "Sales agents" is precisely the thing an
   * IMPORTER does over their own record, so OWN is the scope that means
   * yes there, not the scope that means no.
   */
  own?: boolean;
  icon: AdminNavIcon;
};

export type AdminNavIcon =
  | "chart"
  | "box"
  | "shield"
  | "pin"
  | "database"
  | "globe"
  | "map"
  | "grid"
  | "truck"
  | "users"
  | "building"
  | "bell";

/** A collapsible section. Its children are ordinary items and are what
 *  `visibleNav` returns — the group itself grants nothing. */
export type AdminNavGroup = {
  label: string;
  icon: AdminNavIcon;
  /** Regex source (anchored at the start of the path) used to decide
   *  whether the group is the current section. */
  match: string;
  children: AdminNavItem[];
};

export type AdminNavNode = AdminNavItem | AdminNavGroup;

export function isGroup(node: AdminNavNode): node is AdminNavGroup {
  return (node as AdminNavGroup).children !== undefined;
}

/** Whether the current path is inside a group's section. */
export function inSection(match: string, pathname: string): boolean {
  return new RegExp(`^${match}(/|$)`).test(pathname);
}

export const MASTER_ITEMS: AdminNavItem[] = [
  {
    href: "/admin/master/countries",
    label: "Countries",
    permission: "master.country.create",
    icon: "globe",
  },
  {
    href: "/admin/master/states",
    label: "States",
    permission: "master.state.create",
    icon: "map",
  },
  {
    href: "/admin/master/cities",
    label: "Cities",
    permission: "master.city.create",
    icon: "pin",
  },
  {
    href: "/admin/master/warehouse-types",
    label: "Warehouse types",
    permission: "master.warehouse_type.create",
    icon: "grid",
  },
  {
    href: "/admin/master/vehicle-types",
    label: "Vehicle types",
    permission: "master.vehicle_type.create",
    icon: "truck",
  },
];

/**
 * "Importers & agents". The super admin sees both lists; an importer sees
 * only their own sales agents — their company profile is their dashboard,
 * not a menu entry. Same section, different leaves.
 */
export const IMPORTER_ITEMS: AdminNavItem[] = [
  { href: "/admin/importers", label: "Importers", permission: "importer.read", icon: "box" },
  {
    href: "/admin/sales-agents",
    label: "Sales agents",
    permission: "sales_agent.read",
    own: true,
    icon: "users",
  },
];

export const ADMIN_NAV: AdminNavNode[] = [
  { href: "/admin", label: "Dashboard", permission: null, icon: "chart" },
  /**
   * Notifications, like the dashboard, has NO permission of its own.
   *
   * Keying it on `notification.read` would be the old bug back again:
   * every role in the matrix holds that at OWN scope, so the entry would
   * admit anybody with an account to the admin area. It rides along with
   * whatever else the user earned instead — and everyone who is already
   * inside can see their own bell.
   */
  { href: "/admin/notifications", label: "Notifications", permission: null, icon: "bell" },
  {
    label: "Importers & agents",
    icon: "box",
    match: "/admin/(importers|sales-agents)",
    children: IMPORTER_ITEMS,
  },
  { href: "/admin/users", label: "Users", permission: "user.read", icon: "shield" },
  {
    label: "Master",
    icon: "database",
    match: "/admin/master",
    children: MASTER_ITEMS,
  },
];

/** Every leaf, groups flattened. The order the sidebar renders in. */
export const ADMIN_NAV_ITEMS: AdminNavItem[] = ADMIN_NAV.flatMap((node) =>
  isGroup(node) ? node.children : [node],
);

/**
 * The entries this permission set can see, flat.
 *
 * Returns leaves and not groups on purpose. Three callers outside the
 * sidebar — `admin/layout.tsx`, `sign-in/page.tsx` and `SignInForm` —
 * only ask whether the result is empty, to decide admission and where
 * signing in lands you. Changing the return type to a tree would quietly
 * change all three. Grouping is a rendering concern; see `groupNav`.
 *
 * OWN scope never counts, except on an entry that says `own: true`. An
 * IMPORTER genuinely holds `importer.read` and `user.read` — over their
 * own record and their own account — and the Importers and Users lists
 * are not that. Their "Sales agents" screen is, and
 * only those entries opt in.
 */
export function visibleNav(
  permissions: { permission: string; scope: "OWN" | "WAREHOUSE" | "ALL" }[],
): AdminNavItem[] {
  const wide = new Set(
    permissions.filter((p) => p.scope !== "OWN").map((p) => p.permission),
  );
  const own = new Set(permissions.map((p) => p.permission));

  const earned = ADMIN_NAV_ITEMS.filter(
    (item) =>
      item.permission !== null &&
      (wide.has(item.permission) || (item.own === true && own.has(item.permission))),
  );
  if (earned.length === 0) return [];

  // The dashboard rides along, but never on its own.
  return ADMIN_NAV_ITEMS.filter(
    (item) => item.permission === null || earned.includes(item),
  );
}

/**
 * The same set, re-nested for the sidebar.
 *
 * A group with no visible children disappears entirely rather than
 * rendering as an empty expander — a section header that opens onto
 * nothing reads as a broken page, not as a permission boundary.
 */
export function groupNav(visible: AdminNavItem[]): AdminNavNode[] {
  const allowed = new Set(visible.map((i) => i.href));
  const out: AdminNavNode[] = [];

  for (const node of ADMIN_NAV) {
    if (!isGroup(node)) {
      if (allowed.has(node.href)) out.push(node);
      continue;
    }
    const children = node.children.filter((c) => allowed.has(c.href));
    if (children.length > 0) out.push({ ...node, children });
  }
  return out;
}
