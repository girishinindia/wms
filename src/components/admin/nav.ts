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
  /**
   * Whether ONLY an ALL-scoped grant earns this entry.
   *
   * The mirror image of `own`, and set for the same reason: the sidebar
   * must ask the question the route asks. The warehouse endpoints go
   * through `requirePlatformWarehouse`, which refuses a WAREHOUSE-scoped
   * grant outright — so a WAREHOUSE-scoped `warehouse.create` would earn
   * a link onto a screen that answers 403 to everything on it.
   *
   * Nothing in the shipped matrix holds `warehouse.create` at anything
   * but ALL, so this changes no behaviour today. It is here because the
   * exclusion is one `delete from role_permission` in `09_seed.sql`, and
   * the day that line moves the sidebar should not be what decides.
   */
  allOnly?: boolean;
  icon: AdminNavIcon;
  /**
   * A live counter to draw beside the label.
   *
   * A NAME, not a number: this file is imported by the server layout and
   * has to stay free of JSX and of anything that reads state. The shell
   * maps the name onto a hook and renders the pill; here it is only the
   * statement that this entry has something to count.
   */
  badge?: "notifications";
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
  | "bell"
  | "warehouse"
  | "image"
  | "help"
  | "rupee"
  | "key"
  | "clock";

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
  {
    href: "/admin/master/expense-categories",
    label: "Expense categories",
    permission: "master.expense_category.create",
    // `.read` is granted to the three roles that record expenses,
    // because they need the picker. `.create` is the super admin's
    // alone, which is what this entry is keyed on.
    allOnly: true,
    icon: "rupee",
  },
  {
    href: "/admin/master/faq-categories",
    label: "FAQ categories",
    permission: "master.faq_category.create",
    allOnly: true,
    icon: "help",
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

/**
 * "Warehouses". The sites themselves, and a gallery per site.
 *
 * Keyed on `warehouse.create`, not `warehouse.read` — which SEVEN roles
 * hold at WAREHOUSE scope, every manager on the floor. Only a super
 * admin holds `.create`, at any scope. Same reasoning as the master
 * entries above, and the same trap: the obvious permission is the one
 * that opens the door to everybody.
 */
export const WAREHOUSE_ITEMS: AdminNavItem[] = [
  {
    href: "/admin/warehouses",
    label: "Warehouse",
    permission: "warehouse.create",
    allOnly: true,
    icon: "warehouse",
  },
  {
    href: "/admin/warehouses/gallery",
    label: "Gallery",
    permission: "warehouse.create",
    allOnly: true,
    icon: "image",
  },
];

/**
 * "Transporters & Vehicles". The carriers, and their lorries.
 *
 * Keyed on `.create`, and the reason is the same trap the master
 * entries fell into one table over: `transporter.read` and
 * `vehicle.read` were granted to IMPORTER and SALES_AGENT at ALL scope
 * by the seed, so an entry keyed on read would have put the carrier
 * register — contact mobiles, GSTIN, PAN — in every customer's sidebar.
 * (Migration 24 revokes those two grants as well; the menu is not the
 * control, the grant is. This is the second line of the same defence.)
 *
 * NOT `allOnly`, unlike Warehouses and the master entries: two of the
 * four roles that are meant to be here hold their grant at WAREHOUSE
 * scope, and `allOnly` would shut out exactly the people it is for.
 */
export const TRANSPORT_ITEMS: AdminNavItem[] = [
  {
    href: "/admin/transporters",
    label: "Transporters",
    permission: "transporter.create",
    icon: "truck",
  },
  {
    href: "/admin/vehicles",
    label: "Vehicles",
    permission: "vehicle.create",
    icon: "truck",
  },
];

/**
 * "Users & Roles". The accounts, and what the roles they hold mean.
 *
 * One section because they are one job: you arrive at Roles from a
 * question about a person, and at a person from a question about a
 * role. Two top-level entries side by side said they were unrelated.
 *
 * `allOnly` on `role.read`, and not on `user.read`: `role_permission`
 * has no warehouse column, so editing STORAGE_MANAGER changes it at
 * every site in the company. That is a platform decision. Managing a
 * user is not — a warehouse admin does it for their own people — so the
 * two entries in this one section are deliberately keyed differently.
 */
export const USERS_ITEMS: AdminNavItem[] = [
  { href: "/admin/users", label: "Users", permission: "user.read", icon: "shield" },
  {
    href: "/admin/roles",
    label: "Roles",
    permission: "role.read",
    allOnly: true,
    icon: "key",
  },
  /**
   * The audit log, `allOnly` — and for once not because of seniority.
   *
   * `audit_log.read` is granted at WAREHOUSE to a warehouse admin and at
   * OWN to an importer. Both grants are currently unusable: the columns
   * that would scope the log to a branch or a person —
   * `actor_warehouse_id` and `actor_path` — are never written, so there
   * is nothing to narrow by. Until the writer fills them in, a
   * WAREHOUSE-scoped grant would open the whole log, contact details
   * and all. The page checks the same thing again.
   */
  {
    href: "/admin/audit",
    label: "Audit log",
    permission: "audit_log.read",
    allOnly: true,
    icon: "clock",
  },
];

/**
 * The sidebar, in order.
 *
 * The order is the customer's, and it is only an ordering: every
 * `permission`, `own` and `allOnly` below is unchanged from where it
 * sat before. Worth saying because `visibleNav` derives from this array
 * and three callers outside the sidebar read it — but all three ask
 * only whether the result is EMPTY, never what comes first, so moving
 * rows around cannot change who is admitted or where signing in lands.
 */
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
  {
    href: "/admin/notifications",
    label: "Notifications",
    permission: null,
    icon: "bell",
    badge: "notifications",
  },
  {
    label: "Users & Roles",
    icon: "shield",
    match: "/admin/(users|roles|audit)",
    children: USERS_ITEMS,
  },
  {
    label: "Master",
    icon: "database",
    match: "/admin/master",
    children: MASTER_ITEMS,
  },
  {
    label: "Warehouses",
    icon: "warehouse",
    match: "/admin/warehouses",
    children: WAREHOUSE_ITEMS,
  },
  {
    label: "Transporters & Vehicles",
    icon: "truck",
    match: "/admin/(transporters|vehicles)",
    children: TRANSPORT_ITEMS,
  },
  {
    label: "Importers & agents",
    icon: "box",
    match: "/admin/(importers|sales-agents)",
    children: IMPORTER_ITEMS,
  },
  /**
   * Expenses, above FAQs and outside Master.
   *
   * Keyed on plain `expense.read` and deliberately NOT `allOnly`: four
   * roles are meant to see this one, two of them at WAREHOUSE scope.
   * The page narrows what they see to their own sites; the entry only
   * decides whether the door is there at all.
   */
  {
    href: "/admin/expenses",
    label: "Expenses",
    permission: "expense.read",
    icon: "rupee",
  },
  /**
   * FAQs, last.
   *
   * Keyed on `faq.create`, and `allOnly` like the Warehouses section:
   * the permission is held by the super admin alone, and the route
   * behind the link asks the same question the link does.
   */
  {
    href: "/admin/faqs",
    label: "FAQs",
    permission: "faq.create",
    allOnly: true,
    icon: "help",
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
  options: { agentOnly?: boolean } = {},
): AdminNavItem[] {
  /**
   * A sales agent has no list to be given. The only screen about them is
   * their own record, and that record IS the dashboard — a "Sales
   * agents" page holding a single row of yourself is a page pretending
   * to be a list.
   *
   * Answered here rather than by filtering the entry out below, because
   * `sales_agent.read` is the ONLY permission an agent earns an entry
   * from: filter it away and `earned` is empty, which
   * `admin/layout.tsx` reads as "this account holds nothing" and turns
   * into a locked-out screen. Tidying a sidebar must not revoke
   * admission. Same shape the unverified-importer path already uses.
   */
  if (options.agentOnly) {
    return ADMIN_NAV_ITEMS.filter((item) => item.permission === null);
  }

  const wide = new Set(
    permissions.filter((p) => p.scope !== "OWN").map((p) => p.permission),
  );
  const all = new Set(permissions.filter((p) => p.scope === "ALL").map((p) => p.permission));
  const own = new Set(permissions.map((p) => p.permission));

  const earned = ADMIN_NAV_ITEMS.filter((item) => {
    if (item.permission === null) return false;
    if (item.allOnly === true) return all.has(item.permission);
    return wide.has(item.permission) || (item.own === true && own.has(item.permission));
  });
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
