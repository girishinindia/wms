import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Creating staff logins, and who is allowed to.
 *
 * The rules themselves live in `wms.role_creation_rule`, so there is no
 * point asserting them here — a row would change and the test would be
 * asserting a copy. What IS worth pinning is the machinery around the
 * rules: the parts that are easy to get wrong and silent when they are.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Comments talk about the traps they exist for, and a test searching
 *  source for a forbidden call matches its own explanation otherwise. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the temporary password", () => {
  it("leaves out the characters that are the same shape as each other", async () => {
    const { temporaryPassword } = await import("@/lib/users/create");

    /**
     * O/0 and I/L/1 are the pairs worth removing: in most fonts they are
     * not merely similar, they are identical. The alphabet keeps B, 8,
     * S, 5, Z and 2 on purpose — removing every arguable pair leaves too
     * few symbols to be worth having, and the comment in create.ts says
     * exactly this much and no more.
     */
    for (let i = 0; i < 400; i += 1) {
      expect(temporaryPassword()).not.toMatch(/[OIL01l]/);
    }
  });

  it("is three groups of four, which is what makes it readable aloud", async () => {
    const { temporaryPassword } = await import("@/lib/users/create");
    expect(temporaryPassword()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("is different every time", async () => {
    const { temporaryPassword } = await import("@/lib/users/create");
    const seen = new Set(Array.from({ length: 200 }, () => temporaryPassword()));
    expect(seen.size).toBe(200);
  });

  it("comes from the CSPRNG, not from Math.random", () => {
    const source = code("src/lib/users/invite.ts");
    expect(source).toContain("randomInt");
    expect(source).not.toContain("Math.random");
  });
});

describe("the password never comes back out of the server", () => {
  /**
   * It used to. `createUser` returned it, the API put it in the
   * response body, and the drawer printed it in a dialog with a Copy
   * button — so it sat in the browser's network tab, in whatever logs
   * the response passed through, and on screen in front of whoever
   * happened to be standing behind the person creating the account.
   *
   * It now leaves the server once, inside an email addressed to the
   * person it belongs to. These tests are the fence around that.
   */
  it("is not in the create response contract", async () => {
    const { createUserResponseSchema } = await import("@/lib/validation/api-admin");
    const shape = Object.keys(createUserResponseSchema.shape);
    expect(shape).not.toContain("temporaryPassword");
    // Replaced by what actually happened to the email, which is the
    // thing the screen needs in order to say something true.
    expect(shape).toContain("emailStatus");
  });

  it("is not in what createUser returns", () => {
    const source = code("src/lib/users/create.ts");
    const returned = source.slice(source.lastIndexOf("return {"));
    expect(returned).not.toMatch(/temporaryPassword/);
    expect(returned).not.toMatch(/\btemp\b/);
    expect(returned).toContain("emailStatus");
  });

  it("is not rendered anywhere in the create drawer", () => {
    const drawer = code("src/components/admin/UserCreateDrawer.tsx");
    expect(drawer).not.toMatch(/temporaryPassword/);
    // And no clipboard write, which is what the Copy button was.
    expect(drawer).not.toMatch(/clipboard/);
  });

  it("is not in the invite response either", async () => {
    const { inviteResponseSchema } = await import("@/lib/validation/api-admin");
    expect(Object.keys(inviteResponseSchema.shape)).toEqual(["email", "emailStatus"]);
  });

  it("does not reach the audit trail on a resend", () => {
    const source = code("src/lib/users/invite.ts");
    const audit = source.slice(source.lastIndexOf("auditQuietly({"));
    expect(audit).not.toMatch(/\btemp\b/);
    expect(audit).not.toMatch(/\bhash\b/);
    expect(audit).toContain("emailStatus");
  });
});

describe("sending the sign-in details again", () => {
  const source = code("src/lib/users/invite.ts");
  const route = code("src/app/api/v1/admin/users/[id]/invite/route.ts");

  it("mints a new password rather than repeating the old one", () => {
    /**
     * The old one exists only as an argon2 hash, and that is the point:
     * a system that can tell you a password back is a system that
     * stored it. So a resend is a rotation, not a reminder.
     */
    expect(source).toContain("temporaryPassword()");
    expect(source).toContain("hashPassword(temp)");
    expect(source).toContain("password_hash =");
  });

  it("puts the account back behind a change-password screen", () => {
    expect(source).toContain("must_change_password = true");
  });

  it("clears the login lockout it would otherwise trip over", () => {
    // A fresh password is also the answer to "locked out after five bad
    // guesses". Leaving the lock on makes the resend look like it
    // worked and then refuses the new password.
    expect(source).toContain("failed_login_count = 0");
    expect(source).toContain("locked_until = null");
  });

  it("drops the account's cached actor", () => {
    // Their rights have not changed but their credentials have, and a
    // stale cache entry is the wrong answer to both.
    expect(source).toContain("invalidateUsers([userId])");
  });

  it("refuses an account that is not active", () => {
    // Sending working credentials to a suspended login reads as
    // reinstatement, which is exactly the confusion worth refusing.
    expect(source).toMatch(/status !== "ACTIVE"/);
  });

  it("asks for user.create, not user.update", () => {
    /**
     * It hands over a working credential, which is the same act as
     * creating the account. Being allowed to correct somebody's phone
     * number is not the same permission.
     */
    expect(route).toContain('requirePermission("user.create"');
    expect(route).not.toContain('requirePermission("user.update"');
  });

  it("narrows to the caller's own people", () => {
    /**
     * Without this a warehouse admin could re-issue a SUPER_ADMIN's
     * password and read it out of their own inbox — a complete
     * takeover through an endpoint that looks like a convenience.
     */
    expect(route).toContain("mayActOnUser(");
    // And the reach check comes BEFORE anything is written.
    expect(route.indexOf("mayActOnUser(")).toBeLessThan(route.indexOf("resendInvite("));
  });

  it("is rate-limited on the recipient, not the caller", () => {
    // Every send replaces the password and lands in somebody's inbox.
    // Keyed on the admin, two admins could send four between them.
    expect(route).toContain("limitInviteSend(targetUserId)");
    const limiter = code("src/lib/auth/ratelimit.ts");
    expect(limiter).toMatch(/limitInviteSend\(userId: number\)/);
  });

  it("uses one email body for both the first send and the resend", () => {
    // Two copies drift, and the one that drifts is the one nobody
    // reads until somebody cannot sign in.
    expect(source).toContain("inviteMessage(");
    expect(code("src/lib/users/create.ts")).toContain("sendInvite({");
  });

  it("does put the password in the email, which is the whole point", async () => {
    /**
     * The other half of "it never leaves the server". Every test above
     * proves the password is absent from somewhere; without this one
     * they would all still pass if the email stopped carrying it, and
     * the first anybody knew would be an account nobody could open.
     */
    const { inviteMessage, temporaryPassword } = await import("@/lib/users/invite");
    const temp = temporaryPassword();
    const body = inviteMessage(" as Storage Manager at WH-0001", temp);
    expect(body).toContain(temp);
    expect(body).toContain("Storage Manager at WH-0001");
    // And it tells them what happens next, because a password with no
    // instructions is a support call.
    expect(body).toMatch(/choose your own password/i);
  });
});

describe("the password never reaches a stored notification", () => {
  /**
   * The single most damaging mistake this feature could make.
   *
   * `announce` renders its templates and writes the rendered body into
   * `wms.notification`, where it is readable by anyone who can open the
   * notifications screen. A temporary password put through it would be
   * sitting in the database in plain text — worse than the email it was
   * trying to replace. It travels by a direct `sendEmail` instead, and
   * is returned once to the caller.
   */
  it("passes no password-bearing value to announce", () => {
    const source = code("src/lib/users/create.ts");
    const announceCall = source.slice(source.indexOf("announce({"), source.indexOf("dedupeSuffix"));
    expect(announceCall).not.toMatch(/\btemp\b/);
    expect(announceCall).not.toMatch(/password/i);
  });

  it("does not put the password, or its hash, in the audit trail", () => {
    const source = code("src/lib/users/create.ts");
    const audit = source.slice(source.lastIndexOf("auditQuietly({"), source.indexOf("announce({"));
    expect(audit).not.toMatch(/\btemp\b/);
    expect(audit).not.toMatch(/\bhash\b/);
  });

  it("writes a DENIED row when an attempt is refused on authority", () => {
    /**
     * `requirePermission` audits the refusals it makes, and a warehouse
     * admin reaching for another branch sails past it — they do hold
     * `user.create`. The attempt would otherwise leave no trace.
     */
    const source = code("src/lib/users/create.ts");
    const refusal = source.slice(0, source.indexOf("const [role]"));
    expect(refusal).toContain('result: "DENIED"');
    expect(refusal).toContain('operation: "DENY"');
  });

  it("stores a hash rather than the password itself", () => {
    const source = code("src/lib/users/create.ts");
    expect(source).toContain("hashPassword(temp)");
    expect(source).toContain("password_hash");
    // The account is stopped at a change-password screen on first use.
    expect(source).toContain("must_change_password");
  });
});

describe("a login and its role are written together", () => {
  /**
   * Two statements would let an account exist with no role if the second
   * one failed — a login that can sign in and see nothing, with nobody
   * told. One CTE, one round trip, one outcome.
   */
  it("inserts the user and the assignment in a single statement", () => {
    const source = code("src/lib/users/create.ts");
    const statement = source.slice(source.indexOf("with new_user as"), source.indexOf("`)", source.indexOf("with new_user as")));
    expect(statement).toContain("insert into wms.users");
    expect(statement).toContain("insert into wms.user_role_assignment");
  });

  it("checks for a duplicate inside the insert, not before it", () => {
    // `select … where not exists` is the check and the write at once.
    // Checking first and inserting after is a race that two people
    // adding the same person at once can lose.
    const source = code("src/lib/users/create.ts");
    expect(source).toContain("where not exists");
  });
});

describe("who may create whom", () => {
  /**
   * `mayAssign` is the one place the question is answered, so the create
   * route and the assign route cannot drift apart. The rulebook rows are
   * faked here; what is under test is what this module does with them.
   */
  const actorWith = (roles: { role: string; warehouseId: number | null }[]) => ({
    session: { userId: 7, email: "a@b.c", firstName: "A", lastName: "B" },
    roles: roles.map((r) => ({ ...r, importerId: null })),
    permissions: [{ permission: "role.assign", scope: "WAREHOUSE" }],
  });

  const withRules = async (
    rows: { target_role: string; domain: string; name: string; scope: string }[],
  ) => {
    vi.resetModules();
    vi.doMock("@/db", () => ({ getDb: () => ({ execute: async () => rows }) }));
    return import("@/lib/users/authority");
  };

  it("refuses the immutable roles before it looks at any rule", async () => {
    // No rule row is supplied at all: if this reached the database the
    // answer would be "you cannot assign that role", not this sentence.
    const { mayAssign } = await withRules([]);
    for (const role of ["IMPORTER", "SALES_AGENT"]) {
      const verdict = await mayAssign(
        actorWith([{ role: "SUPER_ADMIN", warehouseId: null }]) as never,
        role,
        null,
      );
      expect(verdict.ok).toBe(false);
      expect((verdict as { reason: string }).reason).toMatch(/cannot be assigned or changed/i);
    }
  });

  it("lets a warehouse admin staff a site they hold", async () => {
    const { mayAssign } = await withRules([
      { target_role: "STORAGE_MANAGER", domain: "WAREHOUSE", name: "Storage Manager", scope: "SAME_WAREHOUSE" },
    ]);
    const verdict = await mayAssign(
      actorWith([{ role: "WAREHOUSE_ADMIN", warehouseId: 4 }]) as never,
      "STORAGE_MANAGER",
      4,
    );
    expect(verdict).toEqual({ ok: true, domain: "WAREHOUSE", warehouseId: 4 });
  });

  it("stops a warehouse admin staffing somebody else's site", async () => {
    const { mayAssign } = await withRules([
      { target_role: "STORAGE_MANAGER", domain: "WAREHOUSE", name: "Storage Manager", scope: "SAME_WAREHOUSE" },
    ]);
    const verdict = await mayAssign(
      actorWith([{ role: "WAREHOUSE_ADMIN", warehouseId: 4 }]) as never,
      "STORAGE_MANAGER",
      9,
    );
    expect(verdict.ok).toBe(false);
    expect((verdict as { field?: string }).field).toBe("warehouseId");
    /**
     * A 403, not a 422. Reaching for another branch's staff is an
     * authorisation decision, and it is the audit log's business — the
     * first cut of this returned "please check the highlighted fields",
     * which both misdescribed it and left no DENIED row behind.
     */
    expect((verdict as { kind?: string }).kind).toBe("FORBIDDEN");
  });

  it("holds two sites for somebody assigned to two", async () => {
    const { mayAssign, actorWarehouseIds } = await withRules([
      { target_role: "INWARD_MANAGER", domain: "WAREHOUSE", name: "Inward Manager", scope: "SAME_WAREHOUSE" },
    ]);
    const actor = actorWith([
      { role: "WAREHOUSE_ADMIN", warehouseId: 4 },
      { role: "WAREHOUSE_ADMIN", warehouseId: 5 },
    ]);
    expect(actorWarehouseIds(actor as never)).toEqual([4, 5]);
    for (const id of [4, 5]) {
      expect((await mayAssign(actor as never, "INWARD_MANAGER", id)).ok).toBe(true);
    }
  });

  it("asks for a warehouse when the role needs one", async () => {
    const { mayAssign } = await withRules([
      { target_role: "INWARD_MANAGER", domain: "WAREHOUSE", name: "Inward Manager", scope: "ANY" },
    ]);
    const verdict = await mayAssign(
      actorWith([{ role: "SUPER_ADMIN", warehouseId: null }]) as never,
      "INWARD_MANAGER",
      null,
    );
    expect(verdict.ok).toBe(false);
    expect((verdict as { field?: string }).field).toBe("warehouseId");
    // An empty box, not a refusal: highlight the field and carry on.
    expect((verdict as { kind?: string }).kind).toBe("VALIDATION_FAILED");
  });

  it("drops a warehouse a platform role was given by mistake", async () => {
    const { mayAssign } = await withRules([
      { target_role: "EXPENSE_ADMIN", domain: "PLATFORM", name: "Expense Admin", scope: "ANY" },
    ]);
    const verdict = await mayAssign(
      actorWith([{ role: "SUPER_ADMIN", warehouseId: null }]) as never,
      "EXPENSE_ADMIN",
      4,
    );
    expect(verdict).toEqual({ ok: true, domain: "PLATFORM", warehouseId: null });
  });

  it("refuses a role no rule offers the caller", async () => {
    // A warehouse admin's rulebook has no WAREHOUSE_ADMIN row, which is
    // what stops one appointing another.
    const { mayAssign } = await withRules([
      { target_role: "STORAGE_MANAGER", domain: "WAREHOUSE", name: "Storage Manager", scope: "SAME_WAREHOUSE" },
    ]);
    for (const role of ["WAREHOUSE_ADMIN", "SUPER_ADMIN"]) {
      const verdict = await mayAssign(
        actorWith([{ role: "WAREHOUSE_ADMIN", warehouseId: 4 }]) as never,
        role,
        4,
      );
      expect(verdict.ok, role).toBe(false);
    }
  });
});

describe("reaching another branch's people", () => {
  /**
   * The gap this closes, found by pressing the buttons rather than by
   * reading the code: `requirePermission` lets a WAREHOUSE-scoped grant
   * through when the request names no warehouse — correct for a list or
   * a create, and wide open for "suspend user 151", where the warehouse
   * is a property of the TARGET. A warehouse admin could suspend another
   * branch's admin, rename an importer, and saw every login on the
   * platform with a live Active switch beside it.
   */
  const actorWith = (
    roles: { role: string; warehouseId: number | null }[],
    scope: string,
  ) => ({
    session: { userId: 7, email: "a@b.c", firstName: "A", lastName: "B" },
    roles: roles.map((r) => ({ ...r, importerId: null })),
    permissions: [{ permission: "user.update", scope }],
  });

  const withAssignments = async (rows: { role: string; warehouse_id: number | null }[]) => {
    vi.resetModules();
    vi.doMock("@/db", () => ({ getDb: () => ({ execute: async () => rows }) }));
    return import("@/lib/users/authority");
  };

  it("lets an ALL grant reach anyone, importers included", async () => {
    const { mayActOnUser } = await withAssignments([{ role: "IMPORTER", warehouse_id: null }]);
    // A super admin suspending an importer is existing behaviour and
    // must stay working — the importer RULE is about roles, not reach.
    expect(await mayActOnUser(actorWith([], "ALL") as never, 2, "user.update")).toBe(true);
  });

  it("stops a warehouse grant reaching another branch", async () => {
    const { mayActOnUser } = await withAssignments([
      { role: "WAREHOUSE_ADMIN", warehouse_id: 2 },
    ]);
    const verdict = await mayActOnUser(
      actorWith([{ role: "WAREHOUSE_ADMIN", warehouseId: 1 }], "WAREHOUSE") as never,
      151,
      "user.update",
      "suspend it",
    );
    expect(verdict).not.toBe(true);
    expect((verdict as { reason: string }).reason).toContain("suspend it");
  });

  it("lets a warehouse grant reach its own site's people", async () => {
    const { mayActOnUser } = await withAssignments([
      { role: "STORAGE_MANAGER", warehouse_id: 1 },
    ]);
    expect(
      await mayActOnUser(
        actorWith([{ role: "WAREHOUSE_ADMIN", warehouseId: 1 }], "WAREHOUSE") as never,
        152,
        "user.update",
      ),
    ).toBe(true);
  });

  it("refuses an account with no live role at all", async () => {
    // Cautious on purpose: an account whose roles have all been revoked
    // belongs to whoever holds the platform, not to whichever branch
    // manager happens to open it.
    const { mayActOnUser } = await withAssignments([]);
    expect(
      await mayActOnUser(
        actorWith([{ role: "WAREHOUSE_ADMIN", warehouseId: 1 }], "WAREHOUSE") as never,
        99,
        "user.update",
      ),
    ).not.toBe(true);
  });

  it("is applied by every route that changes somebody else's login", () => {
    for (const path of [
      "src/app/api/v1/admin/users/[id]/status/route.ts",
      "src/app/api/v1/admin/users/[id]/profile/route.ts",
      "src/app/api/v1/admin/users/[id]/photo/route.ts",
      "src/app/api/v1/admin/users/[id]/route.ts",
      "src/app/api/v1/admin/users/bulk/route.ts",
    ]) {
      expect(code(path), path).toContain("mayActOnUser(");
    }
  });

  it("narrows the users list to the same set the buttons can act on", () => {
    // A list wider than the actions on it is a screen full of switches
    // that answer 403.
    const source = code("src/app/admin/users/page.tsx");
    expect(source).toContain('grantFor(guard.actor, "user.read")');
    expect(source).toContain("not exists");
  });

  it("does not let a typed URL walk round the narrowed list", () => {
    const source = code("src/app/admin/users/[id]/page.tsx");
    expect(source).toContain('mayActOnUser(guard.actor, id, "user.read"');
  });
});

describe("bulk deactivate", () => {
  it("sends a reason, because the table refuses a suspension without one", () => {
    /**
     * `users_check` refuses a SUSPENDED row with a null
     * `deactivation_reason`, and the Deactivate button sends none — so
     * every bulk deactivate came back "Deactivated 0. Skipped N —
     * Failed query…". Pre-existing, and found by pressing the button
     * while checking the scoping above.
     */
    const source = code("src/app/api/v1/admin/users/bulk/route.ts");
    expect(source).toContain("Deactivated from the users screen");
  });
});

describe("the array trap postgres.js sets", () => {
  /**
   * postgres.js expands a JavaScript array into a parameter LIST rather
   * than binding one array value, so `= any(${roles})` becomes
   * `= any($1, $2)` and the statement does not parse. The roles route
   * carries a comment about learning this the hard way; the authority
   * module was written with the same mistake in it.
   */
  it("builds an IN list rather than passing an array to any()", () => {
    const source = code("src/lib/users/authority.ts");
    expect(source).not.toMatch(/=\s*any\(\$\{/);
    expect(source).toContain("sql.join");
  });
});

describe("the role panel asks whether this account is yours to touch", () => {
  /**
   * The hole this closes: "may you grant STORAGE_MANAGER at site 4" is
   * yes for the admin of site 4 — and says nothing about whether the
   * person receiving it is one of their people or another branch's
   * manager. Both the grant and the revoke path have to ask.
   */
  it("calls mayManageUser on both paths", () => {
    const source = code("src/app/api/v1/admin/users/[id]/roles/route.ts");
    expect(source.match(/mayManageUser\(actor,/g) ?? []).toHaveLength(2);
  });

  it("never grants an immutable role from the roles panel", () => {
    const source = code("src/app/api/v1/admin/users/[id]/roles/route.ts");
    expect(source).toContain("isImmutableRole(input.role)");
  });

  it("tells the super admins about both, without failing the request", () => {
    const source = code("src/app/api/v1/admin/users/[id]/roles/route.ts");
    expect(source).toContain('tell("user.role_assigned"');
    expect(source).toContain('tell("user.role_revoked"');
    // The announcement is best-effort: a role that was granted and an
    // email that did not send beats a 500 after the write committed.
    expect(source.slice(source.indexOf("async function tell"))).toContain("catch");
  });
});

describe("the create endpoint", () => {
  it("asks for user.create, not role.assign", async () => {
    const source = code("src/app/api/v1/admin/users/route.ts");
    expect(source).toContain('requirePermission("user.create"');
  });

  it("validates the mobile number the way the database domain does", async () => {
    const { createUserRequestSchema } = await import("@/lib/validation/api-admin");
    const base = {
      firstName: "Asha",
      lastName: "Rao",
      email: "asha@example.com",
      role: "STORAGE_MANAGER",
    };
    expect(createUserRequestSchema.safeParse({ ...base, mobile: "9876543210" }).success).toBe(true);
    // Indian mobiles start 6-9 and are ten digits. A number the schema
    // lets through is a 500 from `wms.mobile_in` instead of a field
    // message under the box.
    for (const mobile of ["1234567890", "98765432", "98765432101", "+919876543210"]) {
      expect(createUserRequestSchema.safeParse({ ...base, mobile }).success, mobile).toBe(false);
    }
  });

  it("lower-cases the email, because citext will anyway", async () => {
    const { createUserRequestSchema } = await import("@/lib/validation/api-admin");
    const parsed = createUserRequestSchema.parse({
      firstName: "Asha",
      lastName: "Rao",
      email: "  Asha@Example.COM ",
      mobile: "9876543210",
      role: "STORAGE_MANAGER",
    });
    expect(parsed.email).toBe("asha@example.com");
  });

  it("knows the two roles that were added for expenses", async () => {
    const { createUserRequestSchema } = await import("@/lib/validation/api-admin");
    for (const role of ["EXPENSE_ADMIN", "EXPENSE_MANAGER"]) {
      const parsed = createUserRequestSchema.safeParse({
        firstName: "Asha",
        lastName: "Rao",
        email: "asha@example.com",
        mobile: "9876543210",
        role,
      });
      expect(parsed.success, role).toBe(true);
    }
  });
});

describe("the Add user screen offers only what the server would accept", () => {
  it("takes its role list from the server rather than a constant", () => {
    const source = code("src/components/admin/UserCreateDrawer.tsx");
    // A hard-coded list here is the bug: it would still show "Warehouse
    // Admin" to a warehouse admin long after the rule said otherwise.
    expect(source).not.toContain("SUPER_ADMIN");
    expect(source).not.toContain("WAREHOUSE_ADMIN");
    expect(source).toContain("roles.map");
  });

  it("is built on the page from the viewer's own grants", () => {
    const source = code("src/app/admin/users/page.tsx");
    expect(source).toContain("creatableRoles(guard.actor)");
    expect(source).toContain("actorWarehouseIds(guard.actor)");
  });

  it("sits in the toolbar beside the search box, like every other list", () => {
    const source = code("src/app/admin/users/page.tsx");
    const table = source.slice(source.indexOf("<UsersTable"));
    expect(table).toContain("action=");
    expect(table).toContain("UserCreateDrawer");
  });
});
