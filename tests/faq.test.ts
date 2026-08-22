import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * FAQs ride on the master machinery, so most of what could break is
 * already covered by the master tests. These are the three things that
 * are specific to this table and silent when they go wrong.
 */

describe("an FAQ is allowed to be a question", () => {
  it("accepts a question mark, which the name validator does not", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    const faq = MASTER_RESOURCES.faqs;

    /**
     * The trap this test exists for: `name()` allows `, . & ( ) / ' -`
     * and nothing else. Reused here, every question ending the way a
     * question ends would have been refused, and the screen would have
     * looked broken on the very first row anybody typed.
     */
    const ok = faq.createSchema.safeParse({
      faqCategoryId: 1,
      question: "How long can stock stay in the warehouse?",
      answer: "As long as you like.\n\nStorage is billed monthly, and there is no minimum.",
    });
    expect(ok.success, ok.success ? "" : JSON.stringify(ok.error.issues)).toBe(true);
  });

  it("keeps the everyday punctuation an answer needs", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    const schema = MASTER_RESOURCES.faqs.createSchema;
    const base = { faqCategoryId: 1, question: "Is this allowed?" };
    for (const answer of [
      "Yes — dashes, colons: semicolons; and 100% of the rest.",
      "Email us at the address on the contact page (we reply within one working day).",
      "Line one.\n\nLine two.",
      'She said "yes" and that was that.',
    ]) {
      expect(schema.safeParse({ ...base, answer }).success, answer).toBe(true);
    }
  });

  it("refuses angle brackets in either field", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    const schema = MASTER_RESOURCES.faqs.createSchema;
    // The page escapes everything and renders no markup, so this is the
    // first of two defences rather than the only one — but a `<script>`
    // in the database is worth refusing at the door.
    expect(
      schema.safeParse({
        faqCategoryId: 1,
        question: "Is this allowed?",
        answer: "<script>alert(1)</script>",
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        faqCategoryId: 1,
        question: "<b>Bold question</b>",
        answer: "A perfectly ordinary answer.",
      }).success,
    ).toBe(false);
  });
});

describe("where the FAQ screens sit, and who may reach them", () => {
  it("names the FAQ resource `faq`, not `master.faq`", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    /**
     * `09_seed.sql` grants `master.%.read` at ALL scope to every role,
     * because anybody filling in an address needs the city list. Naming
     * this resource `master.faq` would have handed every role in the
     * system read access to it the day the permission rows were made.
     */
    expect(MASTER_RESOURCES.faqs.permission).toBe("faq");
    expect(MASTER_RESOURCES["faq-categories"].permission).toBe("master.faq_category");
  });

  it("puts both entries behind an ALL-scoped grant", async () => {
    const { ADMIN_NAV_ITEMS } = await import("@/components/admin/nav");
    for (const href of ["/admin/faqs", "/admin/master/faq-categories"]) {
      const item = ADMIN_NAV_ITEMS.find((i) => i.href === href);
      expect(item, href).toBeDefined();
      expect(item!.permission, href).toMatch(/\.create$/);
      expect(item!.allOnly, href).toBe(true);
      expect(item!.own, href).toBeUndefined();
    }
  });

  it("shows neither entry to anybody but a platform-wide grant", async () => {
    const { visibleNav } = await import("@/components/admin/nav");
    const scoped = ["faq.create", "master.faq_category.create"].map((permission) => ({
      permission,
      scope: "WAREHOUSE" as const,
    }));
    expect(visibleNav(scoped)).toEqual([]);

    const labels = visibleNav(scoped.map((p) => ({ ...p, scope: "ALL" as const }))).map((i) => i.label);
    expect(labels).toEqual(["Dashboard", "Notifications", "FAQ categories", "FAQs"]);
  });

  it("keeps the answer out of the table and out of the sort keys", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    const answer = MASTER_RESOURCES.faqs.fields.find((f) => f.key === "answer");
    expect(answer?.type).toBe("textarea");
    // A few hundred words in a table cell wrecks the row height for
    // every other row on the page.
    expect(answer?.hideInTable).toBe(true);

    const page = readFileSync(
      new URL("../src/components/admin/MasterPage.tsx", import.meta.url),
      "utf8",
    );
    expect(page).toMatch(/fields\.filter\(\(f\) => !f\.hideInTable\)/);
  });
});

describe("what the public may read", () => {
  const src = readFileSync(new URL("../src/lib/faq/public.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("never selects a column it did not name", () => {
    expect(code).not.toMatch(/select\s+\*/i);
    expect(code).not.toMatch(/created_by|updated_by|deleted_by/);
    expect(code).not.toMatch(/created_at|updated_at/);
  });

  it("shows only rows that are switched on, on BOTH tables", () => {
    // A live question inside a switched-off category must not appear.
    // Two predicates, and every query applies both.
    expect(code).toMatch(/c\.is_active and c\.deleted_at is null/);
    expect(code).toMatch(/f\.is_active and f\.deleted_at is null/);
    const blocks = [...code.matchAll(/sql`([\s\S]*?)`/g)].map((m) => m[1]!);
    const reads = blocks.filter((b) => /from wms\.faq\b/.test(b));
    expect(reads.length).toBeGreaterThan(0);
    for (const b of reads) {
      expect(b.includes("${LIVE_FAQ}"), "an unguarded FAQ read").toBe(true);
      expect(b.includes("${LIVE_CATEGORY}"), "an unguarded category read").toBe(true);
    }
  });

  it("renders the answer as text, never as markup", () => {
    const raw = readFileSync(
      new URL("../src/components/FaqAccordion.tsx", import.meta.url),
      "utf8",
    );
    /**
     * Comments out first, and that is not tidiness: the component's own
     * comment explains why it does not use `dangerouslySetInnerHTML`,
     * so asserting against the raw file fails on the explanation rather
     * than on the code. The same false positive as any grep for a word
     * that appears in prose about the word.
     */
    const view = raw.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "").replace(/^\s*\/\/.*$/gm, "");

    // The one line that would turn a trusted field into a stored XSS
    // hole the day somebody pastes an answer in from elsewhere.
    expect(view).not.toMatch(/dangerouslySetInnerHTML/);
    // Paragraphs come from splitting on blank lines, and the text is
    // interpolated as a child — which React escapes.
    expect(view).toMatch(/\.split\(/);
    expect(view).toMatch(/\{para\}/);
  });
});
