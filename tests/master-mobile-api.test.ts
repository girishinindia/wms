import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The generic master list GET and the warehouses list GET — what mobile
 * reads. The properties pinned are the ones that keep a generic handler
 * from becoming a hole:
 *
 *   - identifiers only ever come from the frozen registry, through
 *     `identifier()` — a request never reaches an identifier position;
 *   - WAREHOUSE grants are narrowed by the caller's own assignments,
 *     with the page's own EXISTS shape for via-links (transporters,
 *     vehicles), and an empty assignment answers an empty list;
 *   - the registry's orderBy is qualified onto `m` before use, so the
 *     parent join cannot make "name" ambiguous;
 *   - dates leave as text, never as driver-made Date objects;
 *   - warehouses stay platform-only, same as the rest of their route.
 */

function code(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const master = code("../src/app/api/v1/admin/master/[resource]/route.ts");
const warehouses = code("../src/app/api/v1/admin/warehouses/route.ts");

describe("GET /admin/master/[resource]", () => {
  it("resolves the slug against the frozen registry", () => {
    const getBody = master.slice(master.indexOf("export async function GET"));
    expect(getBody).toMatch(/resolveResource\(slug\)/);
    expect(getBody).toMatch(/requirePermission\(`\$\{resource\.permission\}\.read`/);
  });

  it("narrows WAREHOUSE grants by the caller's own sites, both shapes", () => {
    expect(master).toMatch(/actorWarehouseIds\(actor\)/);
    // Direct column…
    expect(master).toMatch(/m\.\$\{identifier\(resource\.scope\.column\)\} in/);
    // …and the EXISTS through a join table (transporters, vehicles).
    expect(master).toMatch(/resource\.scope\.via\.table/);
    expect(master).toMatch(/mine\.length === 0/);
  });

  it("qualifies the registry orderBy onto m", () => {
    expect(master).toMatch(/function qualifiedOrder/);
    expect(master).toMatch(/qualifiedOrder\(resource\)/);
  });

  it("dates leave as text", () => {
    expect(master).toMatch(/to_char\(m\.\$\{identifier\(f\.column\)\}, 'YYYY-MM-DD'\)/);
  });

  /**
   * The phone's search box. It matters that this runs in SQL: the
   * listing is capped at 300 rows, so a filter applied after the cap
   * would search the first 300 and report "nothing" for everything past
   * it — cities alone is already past 226.
   */
  describe("free-text search", () => {
    const search = master.slice(
      master.indexOf('searchParams.get("q")'),
      master.indexOf("const selected"),
    );

    it("searches every text column the registry declares, plus the parent label", () => {
      expect(search).toMatch(/f\.type === "text"/);
      expect(search).toMatch(/m\.\$\{identifier\(f\.column\)\}::text ilike/);
      expect(search).toMatch(
        /p\.\$\{identifier\(resource\.parent\.labelColumn\)\}::text ilike/,
      );
      // Column names still come from the registry through identifier():
      // nothing from the request reaches an identifier position.
      expect(search).not.toMatch(/sql\.raw/);
    });

    it("binds the term instead of pasting it into the statement", () => {
      expect(search).toMatch(/ilike \$\{like\}/);
      expect(search).not.toMatch(/ilike '/);
    });

    it("treats the person's own % and _ as letters, not wildcards", () => {
      expect(search).toContain("q.replace(");
      expect(search).toContain("\\\\%_");
    });

    it("an empty box is not a filter at all", () => {
      expect(search).toMatch(/\.trim\(\)/);
      expect(search).toMatch(/if \(q !== ""\)/);
    });
  });
});

describe("GET /admin/warehouses", () => {
  it("keeps the platform-only gate the rest of the route uses", () => {
    expect(warehouses).toMatch(/requirePlatformWarehouse\("warehouse\.read"\)/);
  });

  it("carries the three counts the cards show", () => {
    expect(warehouses).toMatch(/as photos/);
    expect(warehouses).toMatch(/as staff/);
    expect(warehouses).toMatch(/as transporters/);
  });
});
