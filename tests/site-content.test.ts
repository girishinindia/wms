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
    expect(schema.safeParse({ layout: "TEXT", heading: "Who we are", body: "Two warehouses in Thane.\n\nOpen since 2019 — 6 days a week." }).success).toBe(true);
    expect(schema.safeParse({ layout: "TEXT", heading: "Who we are", body: "<script>alert(1)</script> hello" }).success).toBe(false);
    expect(schema.safeParse({ layout: "TEXT", heading: "W", body: "Long enough body" }).success).toBe(false);
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

describe("About section layouts — the paste formats", () => {
  it("reads cards, steps and a checklist as title line + text, blocks split by a blank line", async () => {
    const { parseAboutBody } = await import("@/lib/about/layout");
    const body = "Receive\nEvery carton gets its own QR.\n\nStore\nEach carton goes into a gala.\nFound in seconds.";
    for (const layout of ["CARDS", "STEPS", "CHECKLIST"] as const) {
      const r = parseAboutBody(layout, body);
      expect(r.ok, layout).toBe(true);
      if (r.ok && "items" in r.content) {
        expect(r.content.items).toEqual([
          { title: "Receive", text: "Every carton gets its own QR." },
          { title: "Store", text: "Each carton goes into a gala. Found in seconds." },
        ]);
      }
    }
  });

  it("says which block is wrong", async () => {
    const { parseAboutBody } = await import("@/lib/about/layout");
    expect(parseAboutBody("CARDS", "Only one\nCard here.")).toEqual({ ok: false, message: "Add at least 2 cards, separated by a blank line" });
    const r = parseAboutBody("STEPS", "One\nFirst step.\n\nTwo");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/^Step 2 .*needs text/);
  });

  it("reads numbers as value | label, one per line", async () => {
    const { parseAboutBody } = await import("@/lib/about/layout");
    const r = parseAboutBody("NUMBERS", "3 | warehouses\n1,20,000 sqft | of storage\n2016 | in business since");
    expect(r.ok && r.content.layout === "NUMBERS" && r.content.stats[1]).toEqual({ value: "1,20,000 sqft", label: "of storage" });
    const bad = parseAboutBody("NUMBERS", "3 | warehouses\n1,20,000 sqft of storage");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/^Line 2 needs/);
  });

  it("refuses a body that does not fit its layout, on the Text field", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    const r = MASTER_RESOURCES.about.createSchema.safeParse({ layout: "NUMBERS", heading: "In numbers", body: "three warehouses and counting" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path).toEqual(["body"]);
  });

  it("needs a button on a call to action, and only to this site, mail or phone", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    const schema = MASTER_RESOURCES.about.createSchema;
    const base = { layout: "CALL_TO_ACTION", heading: "Talk to us", body: "Storing imported stock? Talk to us." };
    expect(schema.safeParse(base).success).toBe(false);
    expect(schema.safeParse({ ...base, buttonLabel: "Contact us", buttonLink: "/contact" }).success).toBe(true);
    expect(schema.safeParse({ ...base, buttonLabel: "Mail us", buttonLink: "mailto:support@geniusitens.com" }).success).toBe(true);
    expect(schema.safeParse({ ...base, buttonLabel: "Call", buttonLink: "tel:+919820011122" }).success).toBe(true);
    expect(schema.safeParse({ ...base, buttonLabel: "Go", buttonLink: "https://example.com" }).success).toBe(false);
    expect(schema.safeParse({ ...base, buttonLabel: "Go", buttonLink: "javascript:alert(1)" }).success).toBe(false);
  });

  it("keeps the link rule the same as the database CHECK", async () => {
    const { ABOUT_BUTTON_LINK } = await import("@/lib/about/layout");
    const sqlText = readFileSync(new URL("../../sql/45_about_layouts.sql", import.meta.url), "utf8");
    expect(sqlText).toContain(`button_link ~ '${ABOUT_BUTTON_LINK.source.replace(/\\\//g, "/")}'`);
  });
});
