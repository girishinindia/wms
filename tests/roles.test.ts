import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Editing what a role means is the one screen where a mis-click changes
 * what forty people can do and tells nobody. These are the properties
 * that hold it shut, and every one of them fails silently rather than
 * loudly when it breaks.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Source with comments stripped, so a rule quoted in prose is not
 *  mistaken for the rule being implemented. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const actor = (
  perms: { permission: string; scope: string }[],
  roles: string[] = ["WAREHOUSE_ADMIN"],
) =>
  ({
    session: { userId: 9, email: "a@b.invalid", firstName: "A", lastName: "B" },
    roles: roles.map((role) => ({ role, warehouseId: 1, importerId: null })),
    permissions: perms,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

// ── Rule 1: you cannot give what you do not hold ────────────────────

describe("granting is bounded by what the grantor holds", () => {
  it("refuses a permission the caller does not hold at all", async () => {
    const { mayGrant } = await import("@/lib/roles/authority");
    const a = actor([{ permission: "expense.read", scope: "WAREHOUSE" }]);
    const verdict = mayGrant(a, "role.update", "ALL");
    expect(verdict).not.toBe(true);
    expect(verdict === true ? "" : verdict.reason).toContain("role.update");
  });

  it("refuses a scope wider than the caller's own", async () => {
    const { mayGrant } = await import("@/lib/roles/authority");
    const a = actor([{ permission: "expense.read", scope: "WAREHOUSE" }]);
    expect(mayGrant(a, "expense.read", "ALL")).not.toBe(true);
    expect(mayGrant(a, "expense.read", "WAREHOUSE")).toBe(true);
    // Narrower is always fine — that is a restriction, not a gift.
    expect(mayGrant(a, "expense.read", "OWN")).toBe(true);
  });

  it("reads effective permissions, so an ALLOW override counts", async () => {
    /**
     * `mayGrant` looks at `actor.permissions`, which the guard builds
     * from `user_effective_permission` — overrides included. Reading
     * `actor.roles` instead would mean a permission somebody holds only
     * by exception is one they can never pass on, which is not what
     * "what you hold" means.
     */
    expect(code("src/lib/roles/authority.ts")).toMatch(/actor\.permissions\.find/);
    expect(code("src/lib/roles/authority.ts")).not.toMatch(/mayGrant[\s\S]{0,400}actor\.roles/);
  });

  it("ranks scopes the same way the database does", async () => {
    const { scopeRank } = await import("@/lib/roles/authority");
    expect(scopeRank("ALL")).toBe(3);
    expect(scopeRank("WAREHOUSE")).toBe(2);
    expect(scopeRank("OWN")).toBe(1);
    // Anything else is not a scope, and must not outrank OWN.
    expect(scopeRank("EVERYTHING")).toBe(0);
    const fn = read("../sql/22_user_roles.sql") + read("../sql/25_role_admin.sql");
    expect(fn).toMatch(/access_rank/);
  });
});

// ── Rule 2: no sideways or upward edits, and none of the protected ──

describe("which roles are anybody's to redefine", () => {
  it("locks a role at or above the caller's own level", async () => {
    const src = code("src/lib/roles/authority.ts");
    // `>=`, not `>`: two warehouse admins must not be able to rewrite
    // each other's role between them.
    expect(src).toMatch(/level\s*>=\s*mine/);
  });

  it("locks the protected roles for everybody, super admin included", () => {
    const src = code("src/lib/roles/authority.ts");
    /**
     * `is_protected` is checked BEFORE the level comparison, so it
     * cannot be reasoned around by holding a higher level — there is no
     * higher level than SUPER_ADMIN.
     */
    const body = src.slice(src.indexOf("function lockReason"));
    expect(body.indexOf("protectedRole")).toBeLessThan(body.indexOf("level >= mine"));
  });

  it("marks Importer and Sales Agent protected in the schema", () => {
    /**
     * The customer-facing roles decide what every importer and every
     * sales agent can do, and were explicitly left alone. Flipping this
     * would change the product for people who never signed in to the
     * admin panel.
     */
    const sqlSrc = read("../sql/25_role_admin.sql");
    expect(sqlSrc).toMatch(/is_protected\s*=\s*true/);
    expect(sqlSrc).toMatch(/IMPORTER/);
    expect(sqlSrc).toMatch(/SALES_AGENT/);
  });

  it("lists locked roles rather than hiding them", () => {
    // "Why can I not see Warehouse Admin" is a worse question than
    // "why is it greyed out", and only one of them has an answer on
    // screen.
    const src = code("src/lib/roles/authority.ts");
    expect(src).toMatch(/lockedReason/);
    expect(src).not.toMatch(/filter\([^)]*lockReason/);
  });

  it("gives role.read and role.update to the super admin only", () => {
    const sqlSrc = read("../sql/25_role_admin.sql");
    // The pack sets a search_path, so the schema prefix is optional.
    const grants = sqlSrc.match(/insert into (?:wms\.)?role_permission[\s\S]*?;/g)?.join("\n") ?? "";
    expect(grants).not.toBe("");
    expect(grants).toMatch(/role\.update/);
    expect(grants).toMatch(/SUPER_ADMIN/);
    // No warehouse-level role gets it: `role_permission` has no
    // warehouse column, so a warehouse admin editing STORAGE_MANAGER
    // would change it at every site in the company.
    expect(grants).not.toMatch(/WAREHOUSE_ADMIN/);
  });
});

// ── The diff, and what it refuses ───────────────────────────────────

describe("applying a change to a role", () => {
  it("takes a diff, never the whole matrix", async () => {
    const { roleMatrixRequestSchema } = await import("@/lib/validation/api-admin");
    // A full matrix POST means two people saving a minute apart
    // silently undo each other's untouched rows.
    expect(roleMatrixRequestSchema.safeParse({ changes: [], reason: "because" }).success).toBe(
      false,
    );
    expect(
      roleMatrixRequestSchema.safeParse({
        changes: [{ permission: "expense.read", scope: "WAREHOUSE" }],
        reason: "cover for leave",
      }).success,
    ).toBe(true);
  });

  it("insists on a reason worth reading", async () => {
    const { roleMatrixRequestSchema } = await import("@/lib/validation/api-admin");
    const one = [{ permission: "expense.read", scope: "WAREHOUSE" as const }];
    expect(roleMatrixRequestSchema.safeParse({ changes: one, reason: "x" }).success).toBe(false);
    expect(roleMatrixRequestSchema.safeParse({ changes: one }).success).toBe(false);
  });

  it("accepts null as the way to take a permission away", async () => {
    const { roleMatrixRequestSchema } = await import("@/lib/validation/api-admin");
    const parsed = roleMatrixRequestSchema.safeParse({
      changes: [{ permission: "expense.delete", scope: null }],
      reason: "no longer theirs",
    });
    expect(parsed.success).toBe(true);
  });

  it("checks every line before it writes any line", () => {
    const src = code("src/lib/roles/matrix.ts");
    /**
     * All-or-nothing. A half-applied change is a role that means
     * something nobody chose, and nobody would know which half landed.
     *
     * Bounded to `applyMatrix` itself — `addOverride` further down the
     * file calls `mayGrant` too, and letting its call count here would
     * make this pass whatever order the writes are in.
     */
    const from = src.indexOf("export async function applyMatrix");
    const to = src.indexOf("export async function", from + 10);
    const body = src.slice(from, to > from ? to : undefined);
    const lastCheck = Math.max(body.lastIndexOf("mayGrant"), body.lastIndexOf("No such permission"));
    const firstWrite = Math.min(
      body.indexOf("insert into wms.role_permission"),
      body.indexOf("delete from wms.role_permission"),
    );
    expect(lastCheck).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(lastCheck);
  });

  it("refuses a diff that would leave a role with nothing", () => {
    const src = code("src/lib/roles/matrix.ts");
    // Holders of an empty role get a blank sidebar and no explanation,
    // which reads as a broken deployment rather than a decision.
    expect(src).toMatch(/CONFLICT/);
    expect(src).toMatch(/total\)\s*-\s*removing\s*\+\s*adding\s*===\s*0/);
  });

  it("skips the grant check for removals", () => {
    const src = code("src/lib/roles/matrix.ts");
    // Taking something away can never be an escalation, and requiring
    // the permission in order to remove it would mean a mistake could
    // only be corrected by the person who made it.
    expect(src).toMatch(/scope === null\) continue/);
  });
});

// ── The cache ───────────────────────────────────────────────────────

describe("a change reaches the people it affects", () => {
  it("clears every holder of the role, not just the caller", () => {
    const src = code("src/lib/roles/matrix.ts");
    /**
     * The actor cache is keyed per session and invalidated per USER, so
     * a role change has to fan out by hand. Miss this and the change
     * appears to do nothing until the TTL rolls over — which reads as
     * "the screen is broken", and the next thing that happens is
     * somebody clicks save a second time.
     */
    expect(src).toMatch(/user_role_assignment[\s\S]{0,120}revoked_at is null/);
    expect(src).toMatch(/invalidateUsers\(holders\.map/);
  });

  it("clears the one person an exception touches", () => {
    const src = code("src/lib/roles/matrix.ts");
    const add = src.slice(src.indexOf("export async function addOverride"));
    expect(add).toMatch(/invalidateUsers\(\[userId\]\)/);
    const lift = src.slice(src.indexOf("export async function liftOverride"));
    expect(lift).toMatch(/invalidateUsers/);
  });

  it("records both sides of the diff on the audit row", () => {
    const src = code("src/lib/roles/matrix.ts");
    // A diff that says every column changed says nothing, so both sides
    // are narrowed to the permissions this request actually touched.
    expect(src).toMatch(/before:\s*Object\.fromEntries\(changes\.map/);
    expect(src).toMatch(/after:\s*Object\.fromEntries\(changes\.map/);
  });
});

// ── Exceptions for one person ───────────────────────────────────────

describe("one person's exceptions", () => {
  it("requires a scope on an allowance and refuses one on a denial", async () => {
    const { overrideRequestSchema } = await import("@/lib/validation/api-admin");
    expect(
      overrideRequestSchema.safeParse({
        permission: "expense.delete",
        effect: "ALLOW",
        reason: "covering leave",
      }).success,
    ).toBe(false);
    expect(
      overrideRequestSchema.safeParse({
        permission: "expense.delete",
        effect: "DENY",
        reason: "on notice",
      }).success,
    ).toBe(true);
  });

  it("writes null as a denial's scope whatever the caller sent", () => {
    /**
     * A deny removes the permission however wide it was, so a scope on
     * one is meaningless. The column has a CHECK that says so; the
     * insert forces null rather than letting a stray field reach it and
     * come back as a 500 with a constraint name in it.
     */
    const src = code("src/lib/roles/matrix.ts");
    expect(src).toMatch(/effect === "ALLOW" \? sql`\$\{input\.scope\}::wms\.access_scope` : sql`null`/);
    const sqlSrc = read("../sql/25_role_admin.sql");
    expect(sqlSrc).toMatch(/effect\s*=\s*'DENY'\s+and\s+scope\s+is\s+null/);
    expect(sqlSrc).toMatch(/effect\s*=\s*'ALLOW'\s+and\s+scope\s+is\s+not\s+null/);
  });

  it("refuses to deny something the person does not have", () => {
    // An exception that does nothing is worse than no exception: it
    // sits on the record looking like a decision that took effect.
    expect(code("src/lib/roles/matrix.ts")).toMatch(/nothing to take away/i);
  });

  it("hides an exception once its end date passes", () => {
    const src = code("src/lib/roles/matrix.ts");
    expect(src).toMatch(/expires_at is null or po\.expires_at > now\(\)/);
    // …and the view agrees, or a lifted-by-time exception would keep
    // biting while the screen said it had gone.
    expect(read("../sql/25_role_admin.sql")).toMatch(/expires_at is null or po\.expires_at > now\(\)/);
  });

  it("treats the end date as the end of that day", () => {
    // "Until the 5th" means the 5th is a working day.
    expect(code("src/lib/roles/matrix.ts")).toMatch(/\+ interval '1 day'/);
  });

  it("asks the same reach question the role panel asks", () => {
    /**
     * Without `mayManageUser` a warehouse admin could grant themselves
     * anything by way of somebody at another branch, and an importer's
     * fixed roles would stop being fixed.
     */
    const route = code("src/app/api/v1/admin/users/[id]/overrides/route.ts");
    expect(route).toMatch(/requirePermission\("role\.assign"/);
    expect(route).toMatch(/mayManageUser\(actor, userId\)/);
  });
});

// ── The view ────────────────────────────────────────────────────────

describe("the effective-permission view", () => {
  const sqlSrc = read("../sql/25_role_admin.sql");

  it("lets a DENY beat the role that granted it", () => {
    // The role branch excludes anything a live DENY covers, rather than
    // subtracting afterwards — a permission held through two roles must
    // not survive on the second one.
    expect(sqlSrc).toMatch(/not exists[\s\S]{0,300}effect\s*=\s*'DENY'/);
  });

  it("adds an ALLOW that no role carries", () => {
    expect(sqlSrc).toMatch(/from_overrides/);
    expect(sqlSrc).toMatch(/union all/);
  });

  it("shows an allowance as belonging to no role", () => {
    /**
     * `granted_by_roles` comes back empty for an exception, which is
     * how the screen can say "beyond the role" honestly. `array_remove
     * (…, null)` is what keeps a null role out of the array instead of
     * showing `{NULL}`.
     */
    expect(sqlSrc).toMatch(/null::role_key as role|null::wms\.role_key as role/);
    expect(sqlSrc).toMatch(/array_remove\(array_agg\(distinct x\.role\), null\)/);
  });

  it("counts only live, active accounts", () => {
    expect(sqlSrc).toMatch(/revoked_at is null/);
    expect(sqlSrc).toMatch(/status\s*=\s*'ACTIVE'/);
  });
});

// ── The grid ────────────────────────────────────────────────────────

describe("the screen", () => {
  it("has a column for every action the schema allows", async () => {
    /**
     * The regression this exists for: the grid shipped with four verbs
     * while `permission_action_check` allows seven, so 40 of the 156
     * permissions — every approve, every export, and `role.assign` —
     * drew an unclickable dot and could not be granted at all.
     */
    const grid = code("src/components/admin/RoleMatrix.tsx");
    const verbs = grid.match(/const VERBS = \[([^\]]+)\]/)?.[1] ?? "";
    for (const action of ["read", "create", "update", "delete", "approve", "export", "assign"]) {
      expect(verbs, action).toContain(`"${action}"`);
    }
  });

  it("spans the module heading across every column", () => {
    // A hard-coded colSpan is how the heading quietly stops reaching
    // the last column the next time a verb is added.
    expect(code("src/components/admin/RoleMatrix.tsx")).toMatch(/colSpan=\{VERBS\.length \+ 2\}/);
  });

  it("disables what the caller may not give rather than hiding it", () => {
    // Seeing that `expense.delete` exists and is out of reach is
    // information; a grid with holes in it is a puzzle.
    const grid = code("src/components/admin/RoleMatrix.tsx");
    expect(grid).toMatch(/disabled=\{locked\}/);
    expect(grid).toMatch(/!matrix\.editable \|\| !p\.grantable/);
  });

  it("sends only what changed", () => {
    const grid = code("src/components/admin/RoleMatrix.tsx");
    expect(grid).toMatch(/\.filter\(\(\[key, scope\]\) => \(byKey\.get\(key\)\?\.scope \?\? null\) !== scope\)/);
  });

  it("will not save without a reason and a look at the diff", () => {
    const grid = code("src/components/admin/RoleMatrix.tsx");
    expect(grid).toMatch(/setReview\(true\)/);
    expect(grid).toMatch(/reason/);
  });

  it("offers a deny only from what they have, and an allow only from what you have", () => {
    const card = code("src/components/admin/UserOverrides.tsx");
    // Offering anything else is offering something the API will refuse.
    expect(card).toMatch(/open === "DENY"[\s\S]{0,200}held\.filter/);
    expect(card).toMatch(/grantable[\s\S]{0,160}!hasIt\.has\(g\.key\)/);
  });
});
