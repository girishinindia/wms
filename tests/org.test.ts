import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The business hierarchy: four readings of one graph.
 *
 * What is worth pinning here is not the shape of the tree — that will
 * change — but the four things that make it either honest or misleading,
 * each of which fails silently:
 *
 *   · a branch of the org that the chosen axis cannot represent, and so
 *     drops entirely;
 *   · a role nobody holds, which is invisible in a site-first tree;
 *   · a warehouse admin shown somebody else's branch;
 *   · every permission list shipped with the page, which is correct and
 *     unusably slow.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const code = (path: string) =>
  read(path)
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const tree = code("src/lib/org/tree.ts");
const view = code("src/components/admin/OrgTree.tsx");

describe("the four axes", () => {
  it("offers all four, and defaults to the one people ask for", async () => {
    const { VIEWS, DEFAULT_VIEW, isView } = await import("@/lib/org/tree");
    expect(Object.keys(VIEWS)).toEqual(["site", "role", "line", "customer"]);
    expect(DEFAULT_VIEW).toBe("site");
    // Off the address bar, so it is narrowed rather than trusted.
    expect(isView("site")).toBe(true);
    expect(isView("../etc/passwd")).toBe(false);
    expect(isView("")).toBe(false);
  });

  it("gives the platform roles a branch of their own", () => {
    /**
     * Three live assignments — Super Admin, Expense Admin, Transporter
     * Admin — carry no `warehouse_id`, because they apply at every site.
     * A site-first tree has nowhere to put them, and a hierarchy that
     * omits the super admin is not a hierarchy.
     */
    expect(tree).toMatch(/Platform-wide/);
    expect(tree).toMatch(/domain === "PLATFORM"/);
  });

  it("reads the roles table, so a role nobody holds still appears", () => {
    /**
     * PACKAGE_MANAGER has thirteen permissions and zero holders.
     * Grouping the ASSIGNMENTS would make it vanish; reading `wms.role`
     * and joining the holders on is what surfaces it, flagged.
     */
    const byRole = tree.slice(tree.indexOf("export async function roleTree"));
    expect(byRole).toMatch(/from wms\.role r/);
    expect(byRole).toMatch(/warn: held\.length === 0/);
    expect(byRole).toMatch(/nobody holds it/);
  });

  it("nests the reporting line from users.path, not from a guess", () => {
    const byLine = tree.slice(
      tree.indexOf("export async function lineTree"),
      tree.indexOf("export async function customerTree"),
    );
    expect(byLine).toMatch(/nlevel\(u\.path\)/);
    expect(byLine).toMatch(/order by u\.path/);
    // Nested in memory off `created_by`, which the path ordering
    // guarantees arrives parent-first.
    expect(byLine).toMatch(/byId\.get\(Number\(r\.created_by\)\)/);
  });

  it("counts only live assignments, everywhere it reads them", () => {
    /**
     * A revoked role still has a row; forgetting the filter lists
     * somebody whose role was taken away, and it reads as correct.
     *
     * Asserted per READ rather than by counting queries: the shared
     * `readAssignments` covers three views, and the line tree has a
     * subquery of its own for the role labels. Both must filter.
     */
    const reads = tree.split("from wms.user_role_assignment ura").slice(1);
    expect(reads.length).toBeGreaterThanOrEqual(2);
    for (const [i, chunk] of reads.entries()) {
      // Within the same statement — before the next `select`/`from` of a
      // different table runs away with it.
      expect(chunk.slice(0, 700), `read ${i}`).toMatch(/revoked_at is null/);
    }
  });
});

describe("who sees what", () => {
  it("scopes by warehouse, which this screen genuinely can", () => {
    /**
     * Unlike the audit log — where the column that would scope it is
     * never written — `user_role_assignment.warehouse_id` is populated
     * on all fifteen warehouse assignments. So a warehouse admin is
     * shown their own sites, and the nav entry is deliberately NOT
     * `allOnly`.
     */
    expect(tree).toMatch(/function visibleSites/);
    expect(tree).toMatch(/if \(scope === "ALL"\) return null/);
  });

  it("shows nothing rather than everything to a scoped caller with no site", () => {
    // Failing open here would hand the whole company to somebody whose
    // warehouse grant happens to carry no warehouse.
    expect(tree).toMatch(/mine\.length > 0 \? mine : \[\]/);
    expect(tree).toMatch(/sql`and false`/);
  });

  it("keeps the customer tree to platform-level callers", () => {
    // A customer belongs to the platform, not to a site, so there is no
    // honest way to narrow it — better empty than partial.
    const byCustomer = tree.slice(tree.indexOf("export async function customerTree"));
    expect(byCustomer.slice(0, 400)).toMatch(/if \(scope !== "ALL"\) return \[\]/);
  });

  it("asks the same question again on the permissions endpoint", async () => {
    /**
     * The tree would not offer a node outside the caller's reach, but
     * "the UI did not show it" is not a control. The endpoint checks
     * `mayActOnUser` itself, so asking for an id directly is refused.
     */
    const route = code("src/app/api/v1/admin/org/user/[id]/permissions/route.ts");
    expect(route).toMatch(/requirePermission\("user\.read"/);
    expect(route).toMatch(/mayActOnUser\(actor, userId/);
    // Compared inside the handler, not across the whole file — the
    // import block would otherwise decide the answer.
    const body = route.slice(route.indexOf("export async function GET"));
    expect(body.indexOf("mayActOnUser")).toBeLessThan(body.indexOf("readUserPermissions"));
  });

  it("is keyed on user.read and is not allOnly", async () => {
    const { USERS_ITEMS } = await import("@/components/admin/nav");
    const entry = USERS_ITEMS.find((i) => i.href === "/admin/org");
    expect(entry).toBeDefined();
    expect(entry!.label).toBe("Business hierarchy");
    expect(entry!.permission).toBe("user.read");
    // A branch manager reviewing their own people is the ordinary use of
    // this screen, not an exception to it.
    expect(entry!.allOnly).toBeUndefined();
  });
});

describe("what the tree ships and what it fetches", () => {
  it("keeps permission lists out of the page", () => {
    /**
     * A super admin holds 156 permissions and the tree carries 22
     * people. Shipping every list to render the two somebody opens is
     * thousands of nodes for nothing — so the skeleton carries COUNTS
     * and the list is fetched per user.
     */
    const skeleton = tree.slice(0, tree.indexOf("export async function readUserPermissions"));
    expect(skeleton).toMatch(/permissions\?: number/);
    expect(skeleton).not.toMatch(/from wms\.permission\b/);
    expect(view).toMatch(/OrgNodePermissions/);
  });

  it("fetches a person's permissions only once somebody clicks", () => {
    /**
     * The regression this guards. Top-level branches open themselves,
     * and in the reporting-line view every root is a PERSON — so a leaf
     * hung off `open` would fire four permission fetches on arrival,
     * which is the exact thing the lazy leaf exists to avoid. It hangs
     * off `touched` instead.
     */
    expect(view).toMatch(/const \[touched, setTouched\] = useState\(false\)/);
    expect(view).toMatch(/\(touched \|\| openAll\)/);
    expect(view).toMatch(/setTouched\(true\)/);
  });

  it("opens its top level whatever kind the roots are", () => {
    // `depth === 0 && node.kind !== "user"` left the reporting-line view
    // showing four collapsed names and nothing else.
    expect(view).toMatch(/useState\(depth === 0\)/);
    expect(view).not.toMatch(/depth === 0 && node\.kind !== "user"/);
  });

  it("puts a count on every branch, so a collapsed tree still answers", () => {
    // A branch that says nothing until you open it makes you open all of
    // them.
    expect(tree).toMatch(/meta:/);
    expect(tree).toMatch(/plural\(new Set\(here\.map\(\(a\) => a\.user_id\)\)\.size, "person", "people"\)/);
  });

  it("collapses the sites and customers nobody is on", () => {
    // Twenty-four of the warehouses have no assignments. Twenty-four
    // empty branches read as a broken page, not as a fact.
    expect(tree).toMatch(/with nobody assigned/);
    expect(tree).toMatch(/with no accounts/);
  });

  it("keeps a searched match's ancestry rather than hiding the parent", () => {
    // Filtering by hiding rows leaves a parent whose own label does not
    // match looking like an empty branch.
    expect(view).toMatch(/function matches\(node: OrgNode, needle: string\)/);
    expect(view).toMatch(/\(node\.children \?\? \[\]\)\.some\(\(c\) => matches\(c, needle\)\)/);
    expect(view).toMatch(/openAll=\{Boolean\(needle\)\}/);
  });
});

describe("the permission leaf", () => {
  it("groups by module and resource rather than listing 156 keys", () => {
    const leaf = tree.slice(tree.indexOf("export async function readUserPermissions"));
    expect(leaf).toMatch(/byModule/);
    expect(leaf).toMatch(/VERB_ORDER/);
    // read before create before delete, not alphabetical.
    expect(leaf).toMatch(/\["read", "create", "update", "delete", "approve", "export", "assign"\]/);
  });

  it("marks a permission that no role explains", () => {
    /**
     * `granted_by_roles` comes back empty for anything held only through
     * an ALLOW override, which is exactly how the view tells an
     * exception from a role. On a screen about who can do what, that is
     * the line worth noticing.
     */
    expect(tree).toMatch(/array_length\(uep\.granted_by_roles, 1\), 0\) > 0 as from_role/);
    expect(code("src/components/admin/OrgNodePermissions.tsx")).toMatch(/exception/);
  });

  it("shows the widest scope when a resource's verbs disagree", () => {
    // The widest is the one that decides what the person can reach.
    expect(tree).toMatch(/if \(rank\(r\.scope\) > rank\(entry\.scope\)\) entry\.scope = r\.scope/);
  });
});
