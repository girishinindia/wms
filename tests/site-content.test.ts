import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The About page and reviews (44_site_content.sql). What is checked
 * here is who may do what, and what may never reach the public page.
 */

describe("the About page resource", () => {
  it("is a registry resource behind its own permission, not master.*", async () => {
    const { MASTER_RESOURCES, routeFor } = await import("@/lib/admin/master-registry");
    const about = MASTER_RESOURCES.about;
    expect(about.table).toBe("about_section");
    // master.%.read is granted to every role — this must not be under it.
    expect(about.permission).toBe("site_about");
    expect(routeFor(about)).toBe("/admin/website/about");
    expect(about.publicTag).toBe("public-about");
  });

  it("accepts ordinary prose and refuses markup", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    const schema = MASTER_RESOURCES.about.createSchema;
    expect(schema.safeParse({ heading: "Who we are", body: "Two warehouses in Thane.\n\nOpen since 2019 — 6 days a week." }).success).toBe(true);
    expect(schema.safeParse({ heading: "Who we are", body: "<script>alert(1)</script> hello" }).success).toBe(false);
    expect(schema.safeParse({ heading: "W", body: "Long enough body" }).success).toBe(false);
  });
});

describe("a review", () => {
  it("needs a star rating, 20 to 1000 characters, and no markup", async () => {
    const { reviewInputSchema } = await import("@/lib/reviews/validation");
    const good = { rating: 5, body: "Stock was stored the same day and dispatch was quick." };
    expect(reviewInputSchema.safeParse(good).success).toBe(true);
    expect(reviewInputSchema.parse(good).showName).toBe(true);
    expect(reviewInputSchema.safeParse({ ...good, rating: 0 }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ ...good, rating: 6 }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ ...good, rating: 4.5 }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ ...good, body: "Too short." }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ ...good, body: "x".repeat(1001) }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ ...good, body: "<b>Great</b> warehouse, very happy overall" }).success).toBe(false);
  });

  it("must say why when it is rejected", async () => {
    const { decisionSchema } = await import("@/lib/reviews/validation");
    expect(decisionSchema.safeParse({ decision: "APPROVE" }).success).toBe(true);
    expect(decisionSchema.safeParse({ decision: "HIDE", note: "" }).success).toBe(true);
    expect(decisionSchema.safeParse({ decision: "REJECT" }).success).toBe(false);
    expect(decisionSchema.safeParse({ decision: "REJECT", note: "Please remove the phone number." }).success).toBe(true);
    expect(decisionSchema.safeParse({ decision: "DELETE" }).success).toBe(false);
  });

  it("shows a first name and an initial, never the full name", async () => {
    const { publicDisplayName } = await import("@/lib/reviews/validation");
    expect(publicDisplayName("Ravi", "Shah")).toBe("Ravi S.");
    expect(publicDisplayName("Ravi", "")).toBe("Ravi");
    expect(publicDisplayName("", "Shah")).toBe("A verified importer");
  });

  it("never sends contact details to the public page", () => {
    const src = readFileSync(new URL("../src/lib/reviews/public.ts", import.meta.url), "utf8");
    const query = src.slice(src.indexOf("select"), src.indexOf("limit 200"));
    expect(query).toMatch(/r\.status = 'APPROVED'/);
    expect(query).not.toMatch(/email|mobile|contact_/);
  });
});

describe("who may write and who may moderate", () => {
  const sqlText = readFileSync(new URL("../../sql/44_site_content.sql", import.meta.url), "utf8");

  it("grants writing to importers and sales agents only — not the super admin", () => {
    const grants = [...sqlText.matchAll(/\('(\w+)',\s*'(review\.\w+)',\s*'(\w+)'\)/g)].map((m) => `${m[1]} ${m[2]} ${m[3]}`);
    expect(grants).toContain("IMPORTER review.create OWN");
    expect(grants).toContain("SALES_AGENT review.create OWN");
    expect(grants).toContain("SUPER_ADMIN review.approve ALL");
    expect(grants.filter((g) => g.includes("review.create"))).toHaveLength(2);
  });

  it("puts About, Reviews and FAQs together under Website, super admin only", async () => {
    const { ADMIN_NAV, WEBSITE_ITEMS, visibleNav } = await import("@/components/admin/nav");
    const website = ADMIN_NAV.find((n) => "children" in n && n.label === "Website");
    expect(website).toBeDefined();
    expect(WEBSITE_ITEMS.map((i) => i.label)).toEqual(["About page", "Reviews", "FAQs"]);
    expect(WEBSITE_ITEMS.every((i) => i.allOnly)).toBe(true);
    // A warehouse-scoped grant earns none of them.
    const narrow = WEBSITE_ITEMS.map((i) => ({ permission: i.permission!, scope: "WAREHOUSE" as const }));
    expect(visibleNav(narrow).filter((i) => i.href.startsWith("/admin/website") || i.href === "/admin/faqs")).toEqual([]);
  });

  it("shows My review to an importer and to a sales agent", async () => {
    const { visibleNav } = await import("@/components/admin/nav");
    const writer = [{ permission: "review.create", scope: "OWN" as const }];
    expect(visibleNav(writer).map((i) => i.href)).toContain("/admin/my-review");
    expect(visibleNav(writer, { agentOnly: true }).map((i) => i.href)).toContain("/admin/my-review");
  });
});
