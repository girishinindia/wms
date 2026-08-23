import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Expenses ride on the master machinery, so most of what could break is
 * already covered by the master tests. These are the things that are
 * specific to money, and silent when they go wrong.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Comments talk about the traps they exist for, and a test searching
 *  source for a forbidden call matches its own explanation otherwise. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("rupees in, paise out", () => {
  it("survives the round trip that decimals usually lose", async () => {
    const { inputToPaise, paiseToInput } = await import("@/lib/money");
    for (const rupees of ["0.01", "0.10", "12.34", "4200", "4200.50", "99999999.99"]) {
      const paise = inputToPaise(rupees)!;
      expect(Number.isInteger(paise), rupees).toBe(true);
      expect(Number(paiseToInput(paise))).toBeCloseTo(Number(rupees), 2);
    }
  });

  it("rounds rather than truncates, because binary floats do not hold 12.34", async () => {
    const { inputToPaise } = await import("@/lib/money");
    /**
     * 12.34 in binary is 12.33999999999999985789…, so `* 100` gives
     * 1233.9999999999998 and `Math.trunc` would file every such bill a
     * paisa short. Ten thousand of them is ₹100 that does not reconcile.
     */
    expect(inputToPaise("12.34")).toBe(1234);
    expect(inputToPaise("1.15")).toBe(115);
    expect(inputToPaise("8.29")).toBe(829);
    expect(inputToPaise("183.67")).toBe(18367);
  });

  it("takes what people actually paste off an invoice", async () => {
    const { inputToPaise } = await import("@/lib/money");
    expect(inputToPaise("₹42,300.50")).toBe(4230050);
    expect(inputToPaise(" 1,00,000 ")).toBe(10000000);
  });

  it("refuses a third decimal instead of quietly rounding it", async () => {
    const { inputToPaise } = await import("@/lib/money");
    // 1234.567 is a typo or a foreign currency. Filing ₹1,234.57 for it
    // is the wrong kind of helpful.
    for (const bad of ["1234.567", "12.3.4", "-5", "abc", "", "1e5", "٤٢"]) {
      expect(inputToPaise(bad), bad).toBeNull();
    }
  });

  it("groups the Indian way, because a lakh is not ten thousand thousand", async () => {
    const { formatPaise } = await import("@/lib/money");
    // 1,00,00,000 — not 10,000,000.
    expect(formatPaise(100000000)).toBe("₹10,00,000.00");
    expect(formatPaise(4230050)).toBe("₹42,300.50");
  });

  it("never lets a float near the stored value", () => {
    const source = code("src/lib/money.ts");
    // `Math.round`, not `toFixed` and not `Math.trunc`.
    expect(source).toContain("Math.round");
    expect(source).toContain("Number.isSafeInteger");
  });
});

describe("the expense schema", () => {
  const base = {
    expenseCategoryId: 1,
    warehouseId: 1,
    paidTo: "MSEB",
    paymentMode: "UPI" as const,
  };

  it("stores rupees as paise", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    const parsed = MASTER_RESOURCES.expenses.createSchema.parse({
      ...base,
      spentOn: "2026-01-15",
      amount: "4200.50",
    }) as { amount: number };
    expect(parsed.amount).toBe(420050);
  });

  it("refuses a date in the future before the CHECK has to", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    /**
     * `expense_spent_on_sane` refuses it too, and that is the backstop.
     * Reached on its own it surfaces as "violates check constraint",
     * which the API turned into a 500 — measured, then fixed here and
     * translated in the route as well.
     */
    const result = MASTER_RESOURCES.expenses.createSchema.safeParse({
      ...base,
      spentOn: "2099-01-01",
      amount: "100",
    });
    expect(result.success).toBe(false);
  });

  it("keeps the date a string, never a Date", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    const parsed = MASTER_RESOURCES.expenses.createSchema.parse({
      ...base,
      spentOn: "2026-01-15",
      amount: "1",
    }) as { spentOn: unknown };
    // A `date` has no time and no zone. Parsing it as UTC midnight and
    // formatting it back is how the 1st becomes the 31st west of here.
    expect(parsed.spentOn).toBe("2026-01-15");
    expect(parsed.spentOn).not.toBeInstanceOf(Date);
  });

  it("only offers the payment modes the CHECK allows", async () => {
    const { MASTER_RESOURCES, PAYMENT_MODES } = await import("@/lib/admin/master-registry");
    const sql = read("../sql/23_expenses.sql");
    for (const mode of PAYMENT_MODES) {
      expect(sql).toContain(`'${mode}'`);
      expect(
        MASTER_RESOURCES.expenses.createSchema.safeParse({
          ...base,
          paymentMode: mode,
          spentOn: "2026-01-15",
          amount: "1",
        }).success,
        mode,
      ).toBe(true);
    }
  });
});

describe("the registry entry says what makes an expense different", () => {
  it("is scoped by warehouse, soft-deleted, approved and attachable", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    const e = MASTER_RESOURCES.expenses;
    expect(e.scope?.column).toBe("warehouse_id");
    expect(e.softDeleteOnly).toBe(true);
    expect(e.approval?.column).toBe("approval_status");
    expect(e.attachments?.endpoint).toContain("{id}");
  });

  it("leaves the plain master tables on the old path", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    /**
     * Named rather than "everything except expenses", because
     * transporters and vehicles later opted into `scope` and
     * `softDeleteOnly` for reasons of their own. The invariant worth
     * keeping is about THESE seven: a country that quietly grew a
     * warehouse scope would vanish from everybody's screen.
     */
    for (const slug of [
      "countries",
      "states",
      "cities",
      "warehouse-types",
      "vehicle-types",
      "faq-categories",
      "faqs",
      "expense-categories",
    ] as const) {
      const r = MASTER_RESOURCES[slug];
      expect(r.scope, slug).toBeUndefined();
      expect(r.softDeleteOnly, slug).toBeUndefined();
      expect(r.approval, slug).toBeUndefined();
      expect(r.attachments, slug).toBeUndefined();
      expect(r.statusColumn, slug).toBeUndefined();
      expect(r.pivot, slug).toBeUndefined();
    }
  });

  it("keeps approval and attachments to expenses alone", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    for (const [slug, r] of Object.entries(MASTER_RESOURCES)) {
      if (slug === "expenses") continue;
      expect(r.approval, slug).toBeUndefined();
      expect(r.attachments, slug).toBeUndefined();
    }
  });

  it("is named `expense`, never `master.expense`", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    /**
     * The seed grants `master.%.read` to every role so anyone filling in
     * an address can read the city list. Naming this `master.*` would
     * have handed the whole warehouse floor read access to the
     * company's spending, on the day the permission rows were created.
     */
    expect(MASTER_RESOURCES.expenses.permission).toBe("expense");
    expect(MASTER_RESOURCES["expense-categories"].permission).toBe("master.expense_category");
  });
});

describe("approval", () => {
  it("auto-approves on exactly the permission the approve endpoint asks for", async () => {
    const { MASTER_RESOURCES } = await import("@/lib/admin/master-registry");
    const approval = MASTER_RESOURCES.expenses.approval!;
    /**
     * The whole of "a super admin's entry needs no approval" is this
     * one line: an author who could approve it does not have to ask
     * themselves. If the two keys ever drifted apart, somebody would be
     * exempt from a decision they could not actually make.
     */
    expect(approval.autoApprovePermission).toBe(approval.permission);
    expect(code("src/app/api/v1/admin/expenses/[id]/approve/route.ts")).toContain(
      `requirePermission("${approval.permission}"`,
    );
  });

  it("sends an edited row back for a decision, unless the editor could approve it", () => {
    /**
     * Otherwise approval means nothing: record ₹500, get it approved,
     * then edit it to ₹50,000 and the row still reads APPROVED with
     * somebody else's name against it.
     */
    const source = code("src/app/api/v1/admin/master/[resource]/route.ts");
    expect(source).toContain("const resubmit");
    expect(source).toContain("'PENDING'");
    expect(source).toContain("announceSubmitted");
  });

  it("will not put a decided row back to undecided", () => {
    // Once somebody has put their name to it, "undecided" is not a state
    // the record can honestly return to.
    const source = code("src/lib/expenses/ops.ts");
    const decide = source.slice(source.indexOf("export async function decideExpense"));
    expect(decide).not.toContain('"PENDING"');
  });

  it("requires a reason to reject, in the schema and again in the module", async () => {
    const { decideExpenseRequestSchema } = await import("@/lib/validation/api-admin");
    expect(decideExpenseRequestSchema.safeParse({ decision: "REJECTED" }).success).toBe(false);
    expect(
      decideExpenseRequestSchema.safeParse({ decision: "REJECTED", note: "No bill attached" }).success,
    ).toBe(true);
    // Approving without a note is fine — a refusal needs explaining, a
    // yes does not.
    expect(decideExpenseRequestSchema.safeParse({ decision: "APPROVED" }).success).toBe(true);
    expect(code("src/lib/expenses/ops.ts")).toContain("Say why it is being rejected");
  });
});

describe("one branch cannot reach into another's books", () => {
  it("checks the scope on create, on update and on delete", () => {
    const source = code("src/app/api/v1/admin/master/[resource]/route.ts");
    /**
     * Two helpers, because there are two questions. `outsideScope` takes
     * a warehouse id out of the REQUEST — a create, or a move.
     * `outsideRowScope` asks where an existing ROW currently sits, which
     * is the only way to ask it for a transporter: it has no warehouse
     * column at all, only links.
     */
    expect((source.match(/outsideScope\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((source.match(/outsideRowScope\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("measures against the caller's own assignments, never the request", () => {
    const source = code("src/app/api/v1/admin/master/[resource]/route.ts");
    expect(source).toContain("actorWarehouseIds(actor)");
  });

  it("narrows the list and the picker the same way the writes are narrowed", () => {
    const source = code("src/components/admin/MasterPage.tsx");
    expect(source).toContain("actorWarehouseIds(guard.actor)");
    // A scoped reader with no assignments must see NOTHING. Skipping the
    // clause instead of emitting `in (null)` would show them everything.
    expect(source).toContain("sql`null`");
  });

  it("checks the row on every receipt route too", () => {
    for (const path of [
      "src/app/api/v1/admin/expenses/[id]/receipts/route.ts",
      "src/lib/expenses/ops.ts",
    ]) {
      expect(code(path), path).toContain("mayTouchExpense");
    }
  });
});

describe("a financial record is never erased", () => {
  it("soft-deletes instead of deleting when the resource says so", () => {
    const source = code("src/lib/admin/master-ops.ts");
    const from = source.indexOf("if (resource.softDeleteOnly)");
    // Only the `if` arm — the `else` beside it legitimately deletes, and
    // a slice wide enough to include it proves nothing.
    const branch = source.slice(from, source.indexOf("} else {", from));
    expect(branch).toContain("set deleted_at = now()");
    expect(branch).not.toContain("delete from");
  });

  it("still hard-deletes the tables that should be", async () => {
    const { HARD_DELETE_WHEN_UNUSED, MASTER_RESOURCES } = await import(
      "@/lib/admin/master-registry"
    );
    expect(HARD_DELETE_WHEN_UNUSED).toBe(true);
    expect(MASTER_RESOURCES.countries.softDeleteOnly).toBeUndefined();
  });
});

describe("receipts", () => {
  it("reads the file rather than believing the content-type", () => {
    /**
     * The declared type is a claim by the caller. Trusting it is how an
     * HTML file with a PDF content-type ends up on a CDN under your own
     * domain.
     */
    const source = code("src/lib/expenses/ops.ts");
    expect(source).toContain("PDF_MAGIC");
    expect(source).toContain("validateWebp");
  });

  it("uploads the object before it writes the row, and rolls back if the row fails", () => {
    const source = code("src/lib/expenses/ops.ts");
    const add = source.slice(source.indexOf("export async function addReceipt"));
    expect(add.indexOf("putObject")).toBeLessThan(add.indexOf("insert into wms.expense_receipt"));
    // A row pointing at nothing renders as a broken link with no way to
    // tell it from a CDN hiccup.
    expect(add).toContain("await deleteObject(key)");
  });

  it("removes the file before the row, which is the other way round", () => {
    const source = code("src/lib/expenses/ops.ts");
    const del = source.slice(source.indexOf("export async function deleteReceipt"));
    // Reversed on purpose: a failed file delete leaves a listed receipt,
    // which is recoverable. The other order leaves a paid-for file that
    // nothing in the system remembers.
    expect(del.indexOf("deleteObject")).toBeLessThan(del.indexOf("delete from wms.expense_receipt"));
  });

  it("never builds the storage key from the file's own name", () => {
    const source = code("src/lib/expenses/ops.ts");
    expect(source).toContain("randomBytes(8)");
    const keyLine = source.split("\n").find((l) => l.includes("const key ="))!;
    expect(keyLine).not.toContain("originalName");
  });

  it("will not let a receipt come off an approved expense", () => {
    // The receipt is what the approval was given against; pulling it
    // afterwards leaves an approved figure with nothing behind it.
    const source = code("src/lib/expenses/ops.ts");
    expect(source).toContain('row.approvalStatus === "APPROVED"');
  });
});

describe("where the menus put it", () => {
  it("puts Expenses above FAQs and outside Master", async () => {
    const { ADMIN_NAV } = await import("@/components/admin/nav");
    const labels = ADMIN_NAV.map((n) => n.label);
    expect(labels.indexOf("Expenses")).toBeGreaterThan(labels.indexOf("Master"));
    expect(labels.indexOf("Expenses")).toBeLessThan(labels.indexOf("FAQs"));
  });

  it("keys Expenses on read, because four roles are meant to see it", async () => {
    const { ADMIN_NAV_ITEMS } = await import("@/components/admin/nav");
    const item = ADMIN_NAV_ITEMS.find((i) => i.href === "/admin/expenses")!;
    expect(item.permission).toBe("expense.read");
    /**
     * The opposite of every master entry, and deliberately: those are
     * keyed on `.create` because their `.read` is granted to everybody.
     * `expense.read` is granted to exactly the four roles that should
     * see this screen, so it is the honest key — and `allOnly` would
     * shut out the two warehouse-scoped ones it is built for.
     */
    expect(item.allOnly).toBeUndefined();
  });

  it("keys Expense categories on create, like every other master entry", async () => {
    const { MASTER_ITEMS } = await import("@/components/admin/nav");
    const item = MASTER_ITEMS.find((i) => i.href === "/admin/master/expense-categories")!;
    expect(item.permission).toBe("master.expense_category.create");
    expect(item.allOnly).toBe(true);
  });
});
