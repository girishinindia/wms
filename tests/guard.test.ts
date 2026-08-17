import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * How many times one page asks who you are.
 *
 * This is the "I click a menu item and it keeps processing" report, and
 * it was never the menu. Opening an admin screen resolved the actor
 * twice — `app/admin/layout.tsx` calls `currentActor()` to decide which
 * nav entries to render, and the page itself calls `pageGuard()`, which
 * calls `currentActor()` again. Each resolution is three round trips
 * (session, roles, permissions), so a screen made six authorisation
 * queries before running one of its own.
 *
 * That alone would be waste rather than a hang. What turned it into one
 * is that Next renders the layout and the page concurrently while the
 * connection pool was sized at one: the queries were genuinely in
 * flight together and took turns down a single connection, so the tab
 * sat on the loading state for the length of the queue.
 *
 * Two changes, and this file pins both. Neither is visible from the
 * screens, and both are the kind of thing a later tidy-up removes
 * without noticing.
 */

const guard = readFileSync(new URL("../src/lib/auth/guard.ts", import.meta.url), "utf8");
const db = readFileSync(new URL("../src/db/index.ts", import.meta.url), "utf8");

describe("currentActor is resolved once per request", () => {
  it("is memoised with React cache, not a bare async function", () => {
    expect(guard).toMatch(/import \{ cache \} from "react"/);
    expect(guard).toMatch(/export const currentActor = cache\(/);
  });

  it("no longer exports the unmemoised implementation", () => {
    // If both are exported, the next caller picks one at random and the
    // deduplication is only sometimes true.
    expect(guard).not.toMatch(/export async function currentActor\b/);
    expect(guard).not.toMatch(/export (async function|const) resolveActor\b/);
  });

  it("routes the internal callers through the memoised export", () => {
    // `requireActor` and `pageGuard` are where the second resolution
    // came from. They must call the cached export, not reach past it.
    const bodies = guard.slice(guard.indexOf("export const currentActor"));
    expect(bodies).not.toMatch(/resolveActor\(\)/);
    expect(bodies.match(/await currentActor\(\)/g)?.length).toBe(2);
  });
});

describe("the connection pool fits one page render", () => {
  /**
   * A serverless instance serves one request at a time, which is why
   * this was set to 1. But one request is not one query: layout and
   * page authorise independently and concurrently, so the fan-out is
   * several queries wide even though the request count is one.
   */
  it("allows more than a single connection by default", () => {
    const match = db.match(/max: Number\(process\.env\.DATABASE_MAX_CONNECTIONS \?\? (\d+)\)/);
    expect(match, "the pool size line moved").not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(1);
  });

  it("keeps it small enough not to eat the shared pooler", () => {
    // Supavisor's slots are shared with everything else on this
    // project. This is a fan-out allowance, not a throughput knob.
    const match = db.match(/max: Number\(process\.env\.DATABASE_MAX_CONNECTIONS \?\? (\d+)\)/);
    expect(Number(match![1])).toBeLessThanOrEqual(5);
  });

  it("still overridable by environment", () => {
    expect(db).toMatch(/DATABASE_MAX_CONNECTIONS/);
  });

  it("keeps prepared statements off, which the pooler requires", () => {
    // Unrelated to the hang, and catastrophic to lose: each statement
    // can land on a different backend, so a prepared statement created
    // on one is missing on the next.
    expect(db).toMatch(/prepare: false/);
  });
});
