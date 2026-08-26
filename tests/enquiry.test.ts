import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));

/**
 * The contact form, and the inbox behind it.
 *
 * The only unauthenticated write in the product. Everything here is
 * about the two ways that can go wrong: something a stranger sends
 * getting past the guards, or something they sent reaching somebody who
 * should not see it.
 */

const root = new URL("../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * The same file with its comments removed.
 *
 * Several of the comments below explain the mistakes that were made and
 * therefore quote them — "no maxLength", "not `any(${ids})`". An
 * assertion that a file does not CONTAIN something has to look at the
 * code, or it fails on the note explaining why the code is right.
 */
const code = (p: string) =>
  read(p)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const migration = readFileSync("/tmp/sql/27_enquiry.sql", "utf8");

// ── The form's rules and the table's rules are the same rules ────────

describe("validation matches the table", () => {
  /**
   * A limit the form accepts but the column refuses is a 500 with a
   * Postgres message in it, shown to a stranger as a broken site. That
   * is not hypothetical — `5820011133` did exactly this before the
   * mobile rule was tightened, because the shared auth schema asks only
   * for ten digits while `enquiry_mobile_shape` wants a real Indian
   * number.
   */
  it("uses the same lengths the CHECK constraints use", async () => {
    const { enquirySchema } = await import("@/lib/validation/contact");

    const checks = {
      name: /enquiry_name_len\s+check \(char_length\(btrim\(name\)\)\s+between (\d+) and (\d+)\)/,
      subject: /enquiry_subject_len check \(char_length\(btrim\(subject\)\) between (\d+) and (\d+)\)/,
      message: /enquiry_message_len check \(char_length\(btrim\(message\)\) between (\d+) and (\d+)\)/,
    } as const;

    const good = {
      name: "Ravi Kumar",
      email: "ravi@example.test",
      mobile: "9820011122",
      subject: "Storage enquiry",
      message: "We import ceramic tiles and need storage.",
    };

    for (const [field, pattern] of Object.entries(checks)) {
      const found = migration.match(pattern);
      expect(found, `${field} CHECK not found in the migration`).not.toBeNull();
      const [min, max] = [Number(found![1]), Number(found![2])];

      // One under the floor and one over the ceiling must both fail.
      expect(
        enquirySchema.safeParse({ ...good, [field]: "a".repeat(min - 1) }).success,
        `${field} accepted ${min - 1} characters, the column allows ${min}`,
      ).toBe(false);
      expect(
        enquirySchema.safeParse({ ...good, [field]: "a".repeat(max + 1) }).success,
        `${field} accepted ${max + 1} characters, the column allows ${max}`,
      ).toBe(false);
      // And the boundaries themselves must pass.
      expect(
        enquirySchema.safeParse({ ...good, [field]: "a".repeat(min) }).success,
        `${field} refused exactly ${min} characters`,
      ).toBe(true);
    }
  });

  it("refuses a ten-digit number that is not an Indian mobile", async () => {
    const { enquirySchema } = await import("@/lib/validation/contact");
    const good = {
      name: "Ravi Kumar", email: "r@x.test", mobile: "9820011122",
      subject: "Storage enquiry", message: "We import ceramic tiles.",
    };
    // The column's own rule: ^[6-9][0-9]{9}$
    expect(migration).toMatch(/enquiry_mobile_shape check \(mobile ~ '\^\[6-9\]\[0-9\]\{9\}\$'\)/);
    for (const bad of ["5820011122", "1234567890", "0820011122"]) {
      expect(enquirySchema.safeParse({ ...good, mobile: bad }).success, bad).toBe(false);
    }
    for (const okay of ["6820011122", "7820011122", "8820011122", "9820011122"]) {
      expect(enquirySchema.safeParse({ ...good, mobile: okay }).success, okay).toBe(true);
    }
  });

  it("leaves the shared auth rule alone", () => {
    /**
     * `users.mobile` has no shape constraint, so tightening the shared
     * schema would start refusing numbers that table is happy to store
     * — a change to sign-up made as a side effect of a contact form.
     * The stricter rule lives next to the table that enforces it.
     */
    const contact = read("src/lib/validation/contact.ts");
    expect(contact).toMatch(/\[6-9\]\\d\{9\}/);
    expect(read("src/lib/validation/auth.ts")).not.toMatch(/\[6-9\]/);
  });

  it("does not cap the mobile field's typed length", () => {
    /**
     * A maxLength counts characters BEFORE `normalizeMobile` sees them,
     * so pasting "+91 98200 11122" (15 characters) was cut to 14 and
     * normalised to the wrong ten digits. The sign-up form has no cap
     * on its mobile field either, and for the same reason.
     */
    const form = code("src/components/forms/ContactForm.tsx");
    const field = form.slice(form.indexOf('id="contact-mobile"'), form.indexOf('id="contact-subject"'));
    expect(field).not.toMatch(/maxLength/);
    expect(form).toMatch(/normalizeMobile/);
  });
});

// ── Who may read a stranger's contact details ────────────────────────

describe("enquiries are super admin only", () => {
  it("grants the permissions to SUPER_ADMIN and nobody else", () => {
    const grants = migration.slice(migration.indexOf("insert into role_permission"));
    expect(grants).toMatch(/'SUPER_ADMIN'/);
    // Any other role appearing in the grant block would be a second
    // audience for every lead the business has.
    for (const role of ["WAREHOUSE_ADMIN", "EXPENSE_ADMIN", "IMPORTER", "SALES_AGENT", "TRANSPORTER_MANAGER"]) {
      expect(grants, role).not.toContain(role);
    }
  });

  it("declares no create permission", () => {
    /**
     * The public form writes with no session, so there is no holder for
     * an `enquiry.create` and inventing one would imply the route
     * checks something it cannot. The rate limit and the captcha are
     * what guard that write.
     */
    expect(migration).not.toMatch(/'enquiry\.create'/);
  });

  it("refuses anything narrower than ALL, on the page and on both routes", () => {
    /**
     * Not seniority — the data. An enquiry belongs to no warehouse and
     * no importer, so a WAREHOUSE or OWN grant has nothing to narrow
     * by, and honouring one would mean showing a branch manager every
     * lead the business has. Same reasoning as the audit log.
     */
    for (const file of [
      "src/app/admin/enquiries/page.tsx",
      "src/app/api/v1/admin/enquiries/read/route.ts",
      "src/app/api/v1/admin/enquiries/delete/route.ts",
    ]) {
      expect(read(file), file).toMatch(/scope !== "ALL"/);
    }
  });

  it("answers the badge with zero rather than a denial", () => {
    /**
     * The count endpoint is polled once a minute by every signed-in
     * user, because the badge lives in the shared store. A 403 there
     * would fill the audit log with denials that mean nothing, and zero
     * is the honest answer to "how many should I show you".
     */
    const route = read("src/app/api/v1/admin/enquiries/route.ts");
    expect(route).toMatch(/return ok\(\{ unread: 0 \}, requestId\)/);
    expect(route).not.toMatch(/fail\("FORBIDDEN"/);
  });

  it("sits below Notifications and is hidden without the grant", async () => {
    const { ADMIN_NAV, isGroup } = await import("@/components/admin/nav");
    const flat = ADMIN_NAV.filter((n) => !isGroup(n));
    const notifications = flat.findIndex((n) => !isGroup(n) && n.href === "/admin/notifications");
    const enquiry = flat.findIndex((n) => !isGroup(n) && n.href === "/admin/enquiries");
    expect(enquiry, "Enquiry is not in the nav").toBeGreaterThan(-1);
    expect(enquiry).toBe(notifications + 1);

    const entry = flat[enquiry]!;
    if (isGroup(entry)) throw new Error("Enquiry should be a leaf, not a group");
    expect(entry.permission).toBe("enquiry.read");
    expect(entry.allOnly).toBe(true);
    expect(entry.badge).toBe("enquiries");
  });
});

// ── The two driver traps this hit on the way in ──────────────────────

describe("the write paths", () => {
  const routes = [
    "src/app/api/v1/admin/enquiries/read/route.ts",
    "src/app/api/v1/admin/enquiries/delete/route.ts",
  ];

  it("never passes a JS array to any()", () => {
    /**
     * postgres.js expands a JS array into a parameter LIST, so
     * `any(${ids})` compiles to `any(($2))` with the ids spread across
     * separate parameters and the driver refuses it outright — a 500 on
     * every bulk delete. `sql.join` is the idiom the notification
     * routes already use.
     */
    for (const file of routes) {
      const src = code(file);
      expect(src, file).not.toMatch(/any\(\$\{ids\}\)/);
      expect(src, file).toMatch(/sql\.join\(ids!\.map/);
    }
  });

  it("hands the audit writer an object, never a bare array", () => {
    /**
     * `before` is fed through `jsonb_diff` and then
     * `jsonb_object_keys`, which refuses anything that is not a JSON
     * object. An array made the insert fail — and `auditQuietly`
     * swallows its own errors so a broken log cannot break a real
     * request, so the delete succeeded and the audit row simply was not
     * written. Nothing anywhere said so.
     */
    const src = read("src/app/api/v1/admin/enquiries/delete/route.ts");
    expect(src).toMatch(/before: \{\s*\n\s*count: rows\.length/);
    expect(src).not.toMatch(/before: rows\.map/);
  });

  it("states a reason on the delete, which the schema requires", () => {
    expect(read("src/app/api/v1/admin/enquiries/delete/route.ts")).toMatch(
      /operation: "DELETE"[\s\S]{0,200}reason:/,
    );
  });

  it("soft-deletes, keeping the only record that somebody wrote in", () => {
    /**
     * The notifications screen hard-deletes, because a notification is
     * a copy of something the system already knows. An enquiry is the
     * only record that a stranger tried to reach the business, usually
     * carrying a phone number written down nowhere else.
     */
    const src = read("src/app/api/v1/admin/enquiries/delete/route.ts");
    expect(src).toMatch(/set deleted_at = now\(\), deleted_by =/);
    expect(src).not.toMatch(/delete from wms\.enquiry/);
  });

  it("keeps the message body out of the audit log", () => {
    /**
     * The log is read by every super admin and cannot be edited or
     * deleted. Copying a stranger's message into it puts the same
     * personal text in two places with different deletion rules.
     */
    const src = read("src/app/api/v1/contact/route.ts");
    const auditCall = src.slice(src.indexOf('result: "SUCCESS"'));
    expect(auditCall).toMatch(/subject: input\.subject/);
    expect(auditCall).not.toMatch(/message: input\.message/);
  });
});

// ── The page itself ──────────────────────────────────────────────────

describe("the contact page", () => {
  const page = read("src/app/contact/page.tsx");

  it("embeds no map", () => {
    // Asked for explicitly, and worth keeping: an embed is a
    // third-party script, a consent problem and a layout that jumps.
    for (const smell of ["iframe", "google.com/maps", "mapbox", "leaflet", "openstreetmap"]) {
      expect(page.toLowerCase(), smell).not.toContain(smell);
    }
  });

  it("puts the form before the details in the source", () => {
    // The columns stack on a phone; the thing the page exists for
    // should not sit under an address somebody has to scroll past.
    expect(page.indexOf("ContactForm")).toBeLessThan(page.indexOf("CONTACT_CHANNELS"));
  });

  it("ships the details from one editable place", () => {
    expect(read("src/lib/site/contact.ts")).toMatch(/EDIT THIS FILE/);
    expect(page).toMatch(/from "@\/lib\/site\/contact"/);
  });
});

// ── One timer, two badges ────────────────────────────────────────────

describe("the unread count", () => {
  const store = read("src/lib/notifications/unread.ts");

  it("rides the existing poller instead of starting a second", () => {
    /**
     * The argument at the top of that file is about two timers and two
     * numbers that disagree. A second poller for a second badge would
     * be the same mistake under a different name.
     */
    const timers = store.match(/setInterval/g) ?? [];
    expect(timers.length).toBe(1);
    expect(store).toMatch(/Promise\.allSettled/);
    expect(store).toMatch(/export function useEnquiryCount/);
  });

  it("does not let one inbox's failure clear the other's number", () => {
    // `allSettled`, and each result checked on its own.
    expect(store).toMatch(/notifications\.status === "fulfilled"/);
    expect(store).toMatch(/enquiries\.status === "fulfilled"/);
  });
});
