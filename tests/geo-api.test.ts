import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * GET /api/v1/geo — the pickers' master data.
 *
 * Two properties worth pinning: it must be authenticated (an open
 * endpoint is a free cache-warmer for any crawler), and it must serve
 * from the same cached `loadGeoOptions()` the pages use — a hand-rolled
 * query here would bypass the Redis cache and drift from the pages'
 * idea of "active".
 */

function code(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const route = code("../src/app/api/v1/geo/route.ts");

describe("GET /api/v1/geo", () => {
  it("requires a session", () => {
    expect(route).toMatch(/await requireActor\(\)/);
  });

  it("serves the cached options, not its own query", () => {
    expect(route).toMatch(/loadGeoOptions\(\)/);
    expect(route).not.toMatch(/getDb\(\)/);
    expect(route).not.toMatch(/select /i);
  });
});
