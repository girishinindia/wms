import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * An agent's profile and their login are two rows in two tables, and
 * they used to drift: an importer correcting a phone number wrote
 * `wms.sales_agent` only, so the dashboard showed the new number while
 * the agent's own Profile screen — which reads `wms.users` — still
 * showed the old one. One of those was always a lie.
 *
 * What is pinned here is the shape of the fix, because the ordering is
 * the whole of it: the availability check has to happen BEFORE the
 * agent row is written, or a refused edit lands on one table and not
 * the other, which is a worse split than the one being closed.
 */

function code(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const ops = code("../src/lib/sales-agents/ops.ts");
const patch = code("../src/app/api/v1/sales-agents/[id]/route.ts");

const update = ops.slice(ops.indexOf("export async function updateSalesAgent"));

describe("an agent's login follows their profile", () => {
  it("mirrors the identity fields onto wms.users", () => {
    expect(ops).toMatch(/async function mirrorIdentityToLogin\(/);
    expect(ops).toMatch(/update wms\.users set/);
    expect(update).toMatch(/mirrorIdentityToLogin\(agent, input\)/);
    // Name, email and mobile — the fields that exist on both sides.
    for (const field of ["first_name", "last_name", "email", "mobile"]) {
      expect(ops).toContain(field);
    }
  });

  it("checks availability BEFORE writing the agent row", () => {
    const check = update.indexOf("assertLoginAvailable(agent, input)");
    const write = update.indexOf("update wms.sales_agent set");
    expect(check).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    // The refusal must arrive while nothing has been written yet.
    expect(check).toBeLessThan(write);
  });

  it("does not re-open verification", () => {
    // createSalesAgent marks an agent verified on the importer's word;
    // the same importer editing the same agent carries the same
    // weight, so an edit must not silently lock them out of OTP.
    const mirror = ops.slice(ops.indexOf("async function mirrorIdentityToLogin"));
    expect(mirror).not.toMatch(/email_verified_at/);
    expect(mirror).not.toMatch(/mobile_verified_at/);
    // Nor does it touch the credential itself.
    expect(mirror).not.toMatch(/password/);
  });

  it("the PATCH reports a login collision as a CONFLICT with the field", () => {
    expect(patch).toMatch(/AgentLoginConflict/);
    expect(patch).toMatch(/"CONFLICT"/);
    expect(patch).toMatch(/fields: \{ \[error\.field\]/);
  });
});
