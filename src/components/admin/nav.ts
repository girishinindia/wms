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
   * wrong let a customer into the admin area. The obvious key for the
   * cities screen is `master.city.read` — and every role in the matrix
   * holds that at ALL scope, because everyone filling in an address
   * needs to see the list. Keyed on read, the sidebar admitted an
   * IMPORTER. The screen exists to ADD cities, so it is keyed on
   * `master.city.create`, which only a super admin holds.
   *
   * `null` means the entry has no permission of its own and is shown
   * whenever anything else is — the dashboard, which is a summary of the
   * other screens and grants nothing by itself.
   */
  permission: string | null;
  icon: "chart" | "box" | "shield" | "pin";
};

export const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin", label: "Dashboard", permission: null, icon: "chart" },
  { href: "/admin/importers", label: "Importers", permission: "importer.read", icon: "box" },
  { href: "/admin/users", label: "Users", permission: "user.read", icon: "shield" },
  { href: "/admin/master/cities", label: "Cities", permission: "master.city.create", icon: "pin" },
];

/**
 * The entries this permission set can see.
 *
 * OWN scope never counts. An IMPORTER genuinely holds `importer.read`
 * and `user.read` — over their own record and their own account — and
 * that is not what these screens are. The admin area is for people
 * acting across a warehouse or the whole platform.
 */
export function visibleNav(
  permissions: { permission: string; scope: "OWN" | "WAREHOUSE" | "ALL" }[],
): AdminNavItem[] {
  const wide = new Set(
    permissions.filter((p) => p.scope !== "OWN").map((p) => p.permission),
  );

  const earned = ADMIN_NAV.filter((item) => item.permission !== null && wide.has(item.permission));
  if (earned.length === 0) return [];

  // The dashboard rides along, but never on its own.
  return ADMIN_NAV.filter((item) => item.permission === null || earned.includes(item));
}
