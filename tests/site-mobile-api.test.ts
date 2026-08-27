import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The public content endpoints — the app's copies of the public site's
 * pages. What these pin is the boundary: each route reads through the
 * page's own cached loader and NEVER runs its own SQL, because those
 * loaders are where the public rules live — hand-named columns,
 * active-and-listed visibility, null → one indistinguishable 404, and
 * a contact person who is a name and never a number.
 */

function code(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const faqs = code("../src/app/api/v1/site/faqs/route.ts");
const list = code("../src/app/api/v1/site/warehouses/route.ts");
const one = code("../src/app/api/v1/site/warehouses/[code]/route.ts");

describe("public site endpoints", () => {
  it("read through the pages' own loaders", () => {
    expect(faqs).toMatch(/publicFaqGroups\(\)/);
    expect(list).toMatch(/listPublicWarehouses\(/);
    expect(list).toMatch(/publicFilterOptions\(\)/);
    expect(one).toMatch(/getPublicWarehouse\(code\)/);
  });

  it("run no SQL of their own — the loader is the boundary", () => {
    for (const src of [faqs, list, one]) {
      expect(src).not.toMatch(/from wms\./);
      expect(src).not.toMatch(/getDb\(/);
      expect(src).not.toMatch(/\bsql`/);
    }
  });

  it("are public — no guard, no session read", () => {
    for (const src of [faqs, list, one]) {
      expect(src).not.toMatch(/requirePermission|requireSession/);
    }
  });

  it("the detail collapses every kind of missing into one NOT_FOUND", () => {
    expect(one).toMatch(/NOT_FOUND/);
    expect(one).not.toMatch(/FORBIDDEN/);
  });
});
