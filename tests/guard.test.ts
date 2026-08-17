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

describe("the pool does not survive a freeze", () => {
  /**
   * The database's own log is what pointed here: seven times in one
   * morning Postgres cancelled the 0.1ms session lookup after the full
   * two-minute statement_timeout, each in state PARSE — first half of
   * the statement received, second half never sent — with nothing
   * locked. The client had gone quiet mid-statement: a serverless
   * instance frozen between the driver's Parse+Describe and its
   * Bind+Execute (two steps, because `prepare: false`). On thaw the pool
   * handed that dangling connection to the next request, which queued
   * behind the half-sent one for as long as the server waited.
   *
   * The driver's idle timer cannot catch this — it was frozen too. The
   * check is on wall-clock time, and it must stay that way.
   */
  it("measures staleness with the wall clock, not a timer", () => {
    expect(db).toMatch(/const stale = lastTouched !== 0 && now - lastTouched > STALE_MS/);
    expect(db).toMatch(/Date\.now\(\)/);
    expect(db).not.toMatch(/setInterval|setTimeout/);
  });

  it("treats anything past the idle window as untrusted", () => {
    // Slightly past, not exactly: a healthy process closes the
    // connection at IDLE_SECONDS on its own. Still holding one after
    // that means the process was not running.
    expect(db).toMatch(/const STALE_MS = \(IDLE_SECONDS \+ \d+\) \* 1000/);
    expect(db).toMatch(/idle_timeout: IDLE_SECONDS/);
  });

  it("checks on every hand-out, both entry points", () => {
    const body = db.slice(db.indexOf("export function getSql"));
    expect(body.match(/rotateIfStale\(\)/g)?.length).toBe(2);
  });

  it("drops the module and global handles together", () => {
    // Half a rotation is worse than none: a fresh module handle over a
    // stale global one resurrects the old client on the next hot reload.
    const fn = db.slice(db.indexOf("function rotateIfStale"), db.indexOf("export function getSql"));
    expect(fn).toMatch(/sqlSingleton = undefined/);
    expect(fn).toMatch(/dbSingleton = undefined/);
    expect(fn).toMatch(/globalForDb\.__wmsSql = undefined/);
    expect(fn).toMatch(/globalForDb\.__wmsDb = undefined/);
  });

  it("lets in-flight work on the old client finish", () => {
    expect(db).toMatch(/old\.end\(\{ timeout: \d+ \}\)/);
  });

  it("retires connections on a schedule as well", () => {
    expect(db).toMatch(/max_lifetime: 5 \* 60/);
  });
});
