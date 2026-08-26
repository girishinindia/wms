import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The admin GET endpoints the mobile app reads — importers, expenses,
 * enquiries. The web renders these tables server-side; a native client
 * cannot, so each list got an endpoint. What these assertions pin is
 * the SCOPING, because each of the three has a different rule and each
 * rule is the security property:
 *
 *   - importers: OWN is refused — an importer's own grant is
 *     /importer/me, never a list of everyone else's companies;
 *   - expenses: a WAREHOUSE grant filters by the caller's own live
 *     assignments, never by anything in the request; OWN narrows to
 *     the caller's own rows;
 *   - enquiries list: hard 403 below ALL — unlike the badge sibling,
 *     which answers {unread: 0} to everyone by design.
 */

function code(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const importers = code("../src/app/api/v1/admin/importers/route.ts");
const importerOne = code("../src/app/api/v1/admin/importers/[id]/route.ts");
const expenses = code("../src/app/api/v1/admin/expenses/route.ts");
const enquiryList = code("../src/app/api/v1/admin/enquiries/list/route.ts");
const enquiryBadge = code("../src/app/api/v1/admin/enquiries/route.ts");

describe("GET /admin/importers", () => {
  it("refuses an OWN-scoped grant on both list and detail", () => {
    expect(importers).toMatch(/grant\.scope === "OWN"/);
    expect(importerOne).toMatch(/grant\.scope === "OWN"/);
  });

  it("keeps the web list's review-flow facets", () => {
    // A rejection keeps status PENDING; SUBMITTED and REJECTED are KYC
    // facets of PENDING, not statuses. Losing this turns the Rejected
    // tab into an empty list forever.
    expect(importers).toMatch(
      /i\.status = 'PENDING' and i\.kyc_status = 'SUBMITTED'/,
    );
    expect(importers).toMatch(
      /i\.status = 'PENDING' and i\.kyc_status = 'REJECTED'/,
    );
  });

  it("the detail reuses loadImporterProfile, not a second query", () => {
    expect(importerOne).toMatch(/loadImporterProfile\(id\)/);
  });
});

describe("GET /admin/expenses", () => {
  it("scopes WAREHOUSE grants by the caller's own assignments", () => {
    expect(expenses).toMatch(/actorWarehouseIds\(actor\)/);
    expect(expenses).toMatch(/e\.warehouse_id in/);
    // No warehouse id is ever taken from the request.
    expect(expenses).not.toMatch(/searchParams\.get\("warehouseId"\)/);
  });

  it("OWN narrows to rows the caller recorded", () => {
    expect(expenses).toMatch(/e\.created_by = \$\{actor\.session\.userId\}/);
  });

  it("an empty warehouse assignment answers an empty list, not everything", () => {
    expect(expenses).toMatch(/mine\.length === 0/);
  });
});

describe("GET /admin/enquiries/list", () => {
  it("hard-403s below an ALL-scoped enquiry.read", () => {
    expect(enquiryList).toMatch(/grant\.scope !== "ALL"/);
    expect(enquiryList).toMatch(/FORBIDDEN/);
  });

  it("the badge sibling keeps its soft {unread: 0} answer", () => {
    expect(enquiryBadge).toMatch(/unread: 0/);
    expect(enquiryBadge).not.toMatch(/FORBIDDEN/);
  });
});
