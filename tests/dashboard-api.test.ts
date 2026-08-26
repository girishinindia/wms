import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * GET /api/v1/dashboard — the mobile landing, as data.
 *
 * The web dashboard queries the database inside the page, which a
 * native client cannot render. This endpoint mirrors the page's three
 * branches, and these assertions pin the properties that keep it from
 * regressing into a disclosure:
 *
 *   - the branch cut is the page's own (importerGateFor + isAgentOnly),
 *     not a hand-rolled role check;
 *   - an agent-only caller must never receive the importer company
 *     branch (which carries KYC state) or the operator counts;
 *   - the pending queue is gated on importer.read beyond OWN, exactly
 *     as the page gates it.
 */

/** The file with comments stripped, so prose never satisfies a check. */
function code(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const route = code("../src/app/api/v1/dashboard/route.ts");

describe("GET /api/v1/dashboard", () => {
  it("uses the page's own branch predicates, not role names", () => {
    expect(route).toMatch(/importerGateFor\(actor\)/);
    expect(route).toMatch(/isAgentOnly\(actor\)/);
    // The day a handler writes role === 'SUPER_ADMIN' is the day the
    // permission matrix stops being the answer.
    expect(route).not.toMatch(/===\s*['"]SUPER_ADMIN['"]/);
  });

  it("the agent branch is checked BEFORE the importer branch", () => {
    // Order is the security property: an agent's role assignment names
    // their employer, so the importer branch would match them too — and
    // hand a field agent the company's KYC state.
    const agent = route.indexOf("isAgentOnly(actor)");
    const importer = route.indexOf("loadImporterProfile(");
    expect(agent).toBeGreaterThan(-1);
    expect(importer).toBeGreaterThan(-1);
    expect(agent).toBeLessThan(importer);
  });

  it("an agent's record comes from their own user id, never a parameter", () => {
    expect(route).toMatch(/a\.user_id = \$\{actor\.session\.userId\}/);
    expect(route).not.toMatch(/searchParams/);
  });

  it("the pending queue is gated on importer.read beyond OWN", () => {
    expect(route).toMatch(
      /permission === "importer\.read" && p\.scope !== "OWN"/,
    );
    expect(route).toMatch(/canReadImporters\s*\?/);
  });

  it("agent territory carries city and areas, not the employer's KYC", () => {
    expect(route).not.toMatch(/gstin/i);
    expect(route).not.toMatch(/\bpan\b/i);
  });

  it("answers a tagged union on kind", () => {
    expect(route).toMatch(/kind: "agent" as const/);
    expect(route).toMatch(/kind: "importer" as const/);
    expect(route).toMatch(/kind: "admin" as const/);
  });
});
