import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The governance GET endpoints — users, audit, roles, org. Each one is
 * a read of the most sensitive tables in the system, so what these pin
 * is who sees what:
 *
 *   - users: the web page's visibility rule verbatim — ALL sees
 *     everyone; narrower grants see themselves plus users WHOLLY within
 *     their own sites, so a warehouse admin can never enumerate the
 *     platform's operators (the not-exists half is the property);
 *   - audit + roles: hard FORBIDDEN below ALL, as the sidebar gates
 *     them;
 *   - the audit list reuses readAuditPage — the search that refuses to
 *     look inside before/after lives THERE, and a hand-rolled query
 *     here would quietly reopen that oracle;
 *   - roles detail reuses readMatrix; org reuses buildTree with the
 *     caller's own grant scope.
 */

function code(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const users = code("../src/app/api/v1/admin/users/route.ts");
const userOne = code("../src/app/api/v1/admin/users/[id]/route.ts");
const audit = code("../src/app/api/v1/admin/audit/route.ts");
const roles = code("../src/app/api/v1/admin/roles/route.ts");
const roleOne = code("../src/app/api/v1/admin/roles/[key]/route.ts");
const org = code("../src/app/api/v1/admin/org/route.ts");

describe("GET /admin/users (+/[id])", () => {
  it("keeps the wholly-within-my-sites rule, both halves", () => {
    for (const src of [users, userOne]) {
      expect(src).toMatch(/actorWarehouseIds\(actor\)/);
      expect(src).toMatch(/a\.warehouse_id in \(\$\{siteList\}\)/);
      // The half that keeps site-less users (super admins) invisible.
      expect(src).toMatch(
        /a\.warehouse_id is null or a\.warehouse_id not in \(\$\{siteList\}\)/,
      );
    }
  });

  /**
   * The phone cannot draw "Add user" from anything it knows: which
   * roles a caller may hand out lives in `role_creation_rule`, and the
   * portal computed it inside its own page. So the list carries it —
   * worked out from the CALLER, never from the request.
   */
  it("carries what Add user may offer, computed from the caller", () => {
    expect(users).toMatch(/creatableRoles\(actor\)/);
    expect(users).toMatch(/creatableRoles:/);
    // Gated on the caller's own create grant: no grant, no lists.
    expect(users).toMatch(/grantFor\(actor, "user\.create"\)/);
    expect(users).toMatch(/createGrant \? await creatableRoles\(actor\) : \[\]/);
  });

  it("narrows the site list the way the portal's page does", () => {
    // ALL sees every active site; anyone narrower sees only the sites
    // they are actually assigned to — never a site named by the client.
    expect(users).toMatch(/wide = createGrant\?\.scope === "ALL"/);
    expect(users).toMatch(/\$\{wide\} or id in \(\$\{siteList\}\)/);
    expect(users).toMatch(/is_active and deleted_at is null/);
    // And only when a role that needs one is on offer.
    expect(users).toMatch(/r\.domain === "WAREHOUSE"/);
  });

  it("the detail answers NOT_FOUND, never FORBIDDEN, for an out-of-scope id", () => {
    const getBody = userOne.slice(
      userOne.indexOf("export async function GET"),
      userOne.indexOf("export async function DELETE"),
    );
    expect(getBody).toMatch(/NOT_FOUND/);
    expect(getBody).not.toMatch(/"FORBIDDEN"/);
  });

  it("overrides come from the web drawer's own loader", () => {
    expect(userOne).toMatch(/listOverrides\(targetUserId\)/);
  });
});

describe("GET /admin/audit", () => {
  it("is ALL-only and reuses readAuditPage", () => {
    expect(audit).toMatch(/grant\.scope !== "ALL"/);
    expect(audit).toMatch(/readAuditPage\(/);
    // No hand-rolled query that could search before/after.
    expect(audit).not.toMatch(/from wms\.audit_log/);
  });
});

describe("GET /admin/roles (+/[key])", () => {
  it("both are ALL-only", () => {
    expect(roles).toMatch(/grant\.scope !== "ALL"/);
    expect(roleOne.slice(roleOne.indexOf("export async function GET")))
      .toMatch(/grant\.scope !== "ALL"/);
  });

  it("the matrix comes from readMatrix, not a second query", () => {
    const getBody = roleOne.slice(
      roleOne.indexOf("export async function GET"),
      roleOne.indexOf("export async function PUT"),
    );
    expect(getBody).toMatch(/readMatrix\(actor, key\)/);
    expect(getBody).not.toMatch(/from wms\.role_permission/);
  });
});

describe("GET /admin/org", () => {
  it("hands buildTree the caller's own grant scope", () => {
    expect(org).toMatch(/buildTree\(view, actor, grant\.scope\)/);
    expect(org).toMatch(/isView\(raw\)/);
  });
});
