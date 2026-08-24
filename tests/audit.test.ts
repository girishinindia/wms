import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A regression test for one word.
 *
 * `actor_path` was written as `${path}::ltree`. `ltree` is installed
 * into the `extensions` schema, which is not on the connection's
 * search_path, so Postgres answered `type "ltree" does not exist` and
 * every audit write failed — silently, because `auditQuietly` swallows
 * failures on purpose so a broken log cannot break a real request.
 *
 * The symptom was an empty table. Nothing else. A test that needs a
 * database would not run in CI here, so this asserts the shape of the
 * statement instead: no cast to a type that lives outside the schemas
 * the connection can see.
 */

const raw = readFileSync(new URL("../src/lib/audit.ts", import.meta.url), "utf8");

/** Comments talk about `::ltree` at length; the statement must not. */
const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("audit statement", () => {
  it("does not cast to an extension type that is not on the search_path", () => {
    // citext is in `public` and is fine. ltree and anything from
    // btree_gist live in `extensions` and are not.
    expect(source).not.toMatch(/::\s*ltree\b/);
    expect(source).not.toMatch(/::\s*lquery\b/);
  });

  it("still qualifies the wms types it does cast to", () => {
    expect(source).toMatch(/::wms\.audit_operation/);
    expect(source).toMatch(/::wms\.audit_result/);
  });

  it("keeps writing to the partitioned table, not a partition", () => {
    expect(source).toMatch(/insert into wms\.audit_log/);
    expect(source).not.toMatch(/audit_log_\d{4}_\d{2}/);
  });
});

// ── Reading it ──────────────────────────────────────────────────────

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the audit log screen", () => {
  const query = code("src/lib/audit/query.ts");

  it("bounds every list query by a time window", () => {
    /**
     * The table is RANGE-partitioned by month and only ever grows. An
     * unbounded `where action = …` reads every partition that has ever
     * existed, and the plan gets worse every month the system runs.
     * The window is what lets Postgres prune before it looks at
     * anything else.
     *
     * `conditions` seeds its list WITH the window rather than pushing
     * it on somewhere later, so no filter combination can drop it.
     */
    expect(query).toMatch(/const parts: SQL\[\] = \[windowFor\(period\)\]/);
    expect(query).toMatch(/occurred_at >= now\(\) - /);
  });

  it("counts inside the same window it lists inside", async () => {
    // A total from a wider window than the rows is a pager that walks
    // off the end into empty pages.
    const both = query.match(/where \$\{where\}/g) ?? [];
    expect(both.length).toBeGreaterThanOrEqual(2);
  });

  it("computes the window in the database's clock", () => {
    // `now() - interval` and not a JS timestamp: `occurred_at` was
    // written by the database's clock, and comparing it against the
    // web server's is how a row that just landed fails to appear in
    // "last 24 hours".
    expect(query).not.toMatch(/Date\.now\(\)/);
    expect(query).not.toMatch(/new Date\(\)/);
  });

  it("sorts only by occurred_at", () => {
    /**
     * Every index on this table is `(something, occurred_at DESC)`.
     * Sorting by actor or action throws the index away and
     * sequential-scans the pruned partition set — the slowest thing
     * this screen could do, behind a click that looks harmless.
     */
    expect(query).toMatch(/AUDIT_SORTABLE = \["occurred_at"\]/);
  });

  it("never interpolates the sort direction raw from the URL", () => {
    // `sql.raw` on a value off the address bar is an injection. The
    // direction is narrowed to two literals first.
    expect(query).toMatch(/sql\.raw\(list\.dir === "asc" \? "asc" : "desc"\)/);
  });

  it("keeps before/after out of the list", () => {
    /**
     * Those columns carry whatever the record held — for an importer,
     * contact details, GSTIN and PAN. A hundred rows of that on every
     * page is a data-protection problem dressed as a convenience, so
     * the list selects only whether a payload EXISTS.
     */
    const list = query.slice(query.indexOf("export async function readAuditPage"), query.indexOf("export async function readAuditFacets"));
    expect(list).toMatch(/\(a\.before is not null or a\.after is not null\) as has_detail/);
    expect(list).not.toMatch(/select[\s\S]*?\ba\.before,/);
    expect(list).not.toMatch(/a\.diff\b/);
  });

  it("does not let free text search the payloads", () => {
    /**
     * A substring match against `before`/`after` would let somebody
     * fish for a phone number they may not read, one guess at a time,
     * and get a yes/no from the row count. Search covers what the list
     * already shows and nothing more.
     */
    const search = query.slice(query.indexOf("if (query.q)"), query.indexOf("return sql.join"));
    for (const column of ["before", "after", "diff", "metadata"]) {
      expect(search, column).not.toContain(column);
    }
  });

  it("escapes the LIKE metacharacters in the search term", () => {
    // `%` typed into the box would otherwise match everything, and `_`
    // any single character — a search that quietly ignores itself.
    expect(query).toMatch(/replace\(\/\[%_\\\\\]\/g/);
  });

  it("validates the id before it reaches a bigint cast", () => {
    // `${id}::bigint` on arbitrary text is a 500 with a Postgres
    // message in it. Digits only, and a length no bigint can exceed.
    expect(query).toMatch(/\^\\d\{1,19\}\$/);
  });
});

describe("who may read the audit log", () => {
  const page = code("src/app/admin/audit/page.tsx");
  const route = code("src/app/api/v1/admin/audit/[id]/route.ts");

  it("is platform level only, on the page and on the API", () => {
    /**
     * Not a decision about seniority — one about the data. The columns
     * that would scope this log to a branch (`actor_warehouse_id`) or
     * to a person's reports (`actor_path`) are declared, indexed, and
     * NEVER WRITTEN: zero rows carry either. So a WAREHOUSE-scoped
     * grant has nothing to narrow by, and honouring it would open the
     * whole log — every branch's records, contact details included.
     *
     * If the writer ever starts filling those columns in, this is the
     * test to come back to.
     */
    expect(page).toMatch(/guard\.grant\.scope !== "ALL"/);
    expect(route).toMatch(/grant\.scope !== "ALL"/);
  });

  it("says so in the nav as well, so the link is never offered", async () => {
    const { USERS_ITEMS } = await import("@/components/admin/nav");
    const entry = USERS_ITEMS.find((i) => i.href === "/admin/audit");
    expect(entry).toBeDefined();
    expect(entry!.permission).toBe("audit_log.read");
    expect(entry!.allOnly).toBe(true);
    expect(entry!.own).toBeUndefined();
  });

  it("sits under Users & Roles, after Users and Roles", async () => {
    const { USERS_ITEMS } = await import("@/components/admin/nav");
    expect(USERS_ITEMS.map((i) => i.href)).toEqual([
      "/admin/users",
      "/admin/roles",
      "/admin/audit",
      "/admin/org",
    ]);
  });

  it("counts as being inside its own section", async () => {
    /**
     * A group's `match` decides two things: whether the section is
     * highlighted, and whether it opens itself when you arrive by a
     * link. A child whose href the regex does not cover looks like it
     * belongs to no section at all — which is exactly what
     * `/admin/audit` did while the match still read `(users|roles)`.
     *
     * Asserted across EVERY group, so the next child added anywhere
     * cannot repeat it.
     */
    const { ADMIN_NAV, inSection, isGroup } = await import("@/components/admin/nav");
    for (const node of ADMIN_NAV) {
      if (!isGroup(node)) continue;
      for (const child of node.children) {
        expect(inSection(node.match, child.href), `${node.label} → ${child.href}`).toBe(true);
      }
    }
  });

  it("offers nothing to do TO a row", () => {
    /**
     * The table is append-only at the database — a trigger refuses
     * UPDATE and DELETE outright. Selection checkboxes would only ever
     * lead to a button that cannot work.
     */
    const table = code("src/components/admin/AuditTable.tsx");
    expect(table).toMatch(/enableSelection=\{false\}/);
    expect(table).not.toMatch(/bulk=/);
  });

  it("hides the Active/Inactive filter, which means nothing here", () => {
    const table = code("src/components/admin/AuditTable.tsx");
    expect(table).toMatch(/showStatus=\{false\}/);
    // And the default is still on, so no other list changed.
    expect(code("src/components/admin/ListControls.tsx")).toMatch(/showStatus = true/);
    expect(code("src/components/admin/DataTable.tsx")).toMatch(/showStatus = true/);
  });
});

describe("the entry drawer", () => {
  const detail = code("src/components/admin/AuditDetail.tsx");

  it("fetches one row on demand rather than shipping every payload", () => {
    // A page of 100 rows would otherwise send 100 payloads to the
    // browser to render the four somebody opens.
    expect(detail).toMatch(/api<Detail>\(`\/admin\/audit\/\$\{id\}`/);
  });

  it("shows fields that were added or removed, not only changed ones", () => {
    /**
     * Iterating one side alone hides exactly the changes most worth
     * seeing: a field absent from `before` was ADDED, one absent from
     * `after` was REMOVED, and neither appears if you loop over the
     * other object's keys.
     */
    expect(detail).toMatch(/new Set\(\[\.\.\.Object\.keys\(detail\.before \?\? \{\}\), \.\.\.Object\.keys\(detail\.after \?\? \{\}\)\]\)/);
  });

  it("falls back to comparing values when changed_keys is empty", () => {
    // That column was added later than the rows already in the table,
    // so most history has it empty. Highlighting nothing would be
    // wrong; highlighting everything would be worse.
    expect(detail).toMatch(/detail\.changedKeys\.length[\s\S]{0,160}from !== to/);
  });
});
