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
