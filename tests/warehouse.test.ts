import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Warehouses: the form's rules, and what a gallery accepts.
 *
 * The screen is a master-style list like any other, and none of that is
 * worth a test. These three things are: a size limit that appears both
 * in a message to the user and in the check that rejects them (they
 * must be the same number), a link field that is rendered as an anchor
 * (so an unchecked string there is a stored redirect), and the folder a
 * photo lands in, which is the only thing keeping one warehouse's
 * gallery out of another's.
 */

// The same hand-built headers the profile-photo suite uses: a validator
// that knows only the common payload shape waves the other two through.
function riff(payload: Uint8Array, minLength = 0): Uint8Array {
  const total = Math.max(12 + payload.length, minLength);
  const b = new Uint8Array(total);
  b.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  const size = total - 8;
  b.set([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff], 4);
  b.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  b.set(payload, 12);
  return b;
}

function vp8(width: number, height: number): Uint8Array {
  const p = new Uint8Array(18);
  p.set([0x56, 0x50, 0x38, 0x20], 0); // "VP8 "
  p.set([0x0a, 0, 0, 0], 4);
  p.set([0x9d, 0x01, 0x2a], 11);
  p.set([width & 0xff, (width >> 8) & 0x3f], 14);
  p.set([height & 0xff, (height >> 8) & 0x3f], 16);
  return riff(p, 30);
}

describe("what counts as a gallery photo", () => {
  it("takes a photograph where an avatar would be refused", async () => {
    const { validateWebp, GALLERY_LIMITS, PROFILE_LIMITS } = await import("@/lib/images/webp");
    const wide = vp8(1600, 1200);
    expect(validateWebp(wide, GALLERY_LIMITS)).toEqual({ width: 1600, height: 1200 });
    // The same file as a profile photo is far too big — the two limits
    // are separate on purpose, and sharing one reader must not merge them.
    expect(() => validateWebp(wide, PROFILE_LIMITS)).toThrow(/512px at most/i);
  });

  it("holds the line at the long edge the browser resizes to", async () => {
    const { validateWebp, GALLERY_LIMITS } = await import("@/lib/images/webp");
    const { maxEdge } = GALLERY_LIMITS;
    expect(validateWebp(vp8(maxEdge, 900), GALLERY_LIMITS)).toEqual({ width: maxEdge, height: 900 });
    expect(() => validateWebp(vp8(maxEdge + 1, 900), GALLERY_LIMITS)).toThrow(/1600px at most/i);
    // Portrait counts too: it is the long edge, not the width.
    expect(() => validateWebp(vp8(900, maxEdge + 1), GALLERY_LIMITS)).toThrow(/1600px at most/i);
  });

  it("refuses a thumbnail posing as a photograph", async () => {
    const { validateWebp, GALLERY_LIMITS } = await import("@/lib/images/webp");
    expect(() => validateWebp(vp8(64, 64), GALLERY_LIMITS)).toThrow(/at least 200px/i);
  });

  it("caps the byte size before anything reaches the CDN", async () => {
    const { validateWebp, GALLERY_LIMITS } = await import("@/lib/images/webp");
    const huge = new Uint8Array(GALLERY_LIMITS.maxBytes + 1);
    huge.set(vp8(1600, 1200), 0);
    expect(() => validateWebp(huge, GALLERY_LIMITS)).toThrow(/over 800 KB/);
    expect(() => validateWebp(new Uint8Array(0), GALLERY_LIMITS)).toThrow(/No image/i);
  });

  it("puts each warehouse's photos in its own folder", async () => {
    const { galleryFolder } = await import("@/lib/warehouses/ops");
    expect(galleryFolder(7)).toBe("wms/gallery/7");
    expect(galleryFolder(8)).toBe("wms/gallery/8");
    // The folder is what separates one gallery from the next; if these
    // ever agreed, deleting a warehouse would empty a neighbour's.
    expect(galleryFolder(7)).not.toBe(galleryFolder(8));
  });
});

describe("who the area belongs to", () => {
  const guard = readFileSync(new URL("../src/lib/warehouses/guard.ts", import.meta.url), "utf8");

  it("makes the SCOPE the check, not the permission", () => {
    // `warehouse.read` is held by seven roles and `warehouse.update` by
    // the manager of every site. What separates a super admin is that
    // they hold these at ALL.
    expect(guard).toMatch(/grant\.scope !== "ALL"/);
    expect(guard).toMatch(/permission === "warehouse\.create" && p\.scope === "ALL"/);
  });

  it("writes down the refusal before throwing it", () => {
    /**
     * `requirePermission` audits the denial it makes itself — "you do
     * not hold this" — and a warehouse manager passes that check. They
     * are stopped one line later by the scope, and without this that
     * would be the only 403 in the system leaving no trace. A manager
     * trying to delete a site is the row somebody looks for afterwards.
     */
    const branch = guard.slice(guard.indexOf('grant.scope !== "ALL"'));
    const audited = branch.indexOf("auditQuietly");
    const thrown = branch.indexOf("throw new HandledError");
    expect(audited, "the scope refusal is not audited").toBeGreaterThan(-1);
    expect(branch).toMatch(/result: "DENIED"/);
    expect(audited, "audited after the throw, so never").toBeLessThan(thrown);
  });

  it("says the same thing however it failed", () => {
    // "You do not hold warehouse.delete" and "you hold it, but only for
    // your own site" are different sentences and the same 403.
    const thrown = [...guard.matchAll(/new HandledError\(\s*"[A-Z_]+",\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(thrown.length).toBeGreaterThan(0);
    expect(new Set(thrown).size, `distinct refusals: ${thrown.join(" / ")}`).toBe(1);
    // The reason goes to the audit log, where only staff read it.
    expect(thrown[0]).not.toMatch(/scope|warehouse|super/i);
  });
});

describe("the warehouse form", () => {
  const VALID = {
    name: "Bhiwandi Hub 1",
    warehouseTypeId: 1,
    address: "Survey 44, Kalyan Road",
    cityId: 3,
    pincode: "421302",
  };

  it("accepts the fields a person actually fills in", async () => {
    const { createWarehouseSchema } = await import("@/lib/validation/api-warehouse");
    const parsed = createWarehouseSchema.safeParse(VALID);
    expect(parsed.success).toBe(true);
    // The facility flags carry the defaults the table does.
    expect(parsed.success && parsed.data.hasRacking).toBe(true);
    expect(parsed.success && parsed.data.hasCctv).toBe(false);
    expect(parsed.success && parsed.data.isActive).toBe(true);
  });

  it("never takes a code from the request", async () => {
    const { createWarehouseSchema } = await import("@/lib/validation/api-warehouse");
    // `warehouse_code_seq` issues these. A hand-typed value in a NOT
    // NULL UNIQUE column is two people adding a warehouse on the same
    // afternoon, and one of them getting a 500.
    const parsed = createWarehouseSchema.safeParse({ ...VALID, code: "WH-9999" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && "code" in parsed.data).toBe(false);
  });

  it("refuses a map link that is not a link", async () => {
    const { createWarehouseSchema } = await import("@/lib/validation/api-warehouse");
    // The value is rendered as an anchor on the detail screen.
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>", "maps.google.com/x"]) {
      const parsed = createWarehouseSchema.safeParse({ ...VALID, gmapUrl: bad });
      expect(parsed.success, bad).toBe(false);
    }
    expect(
      createWarehouseSchema.safeParse({ ...VALID, gmapUrl: "https://maps.app.goo.gl/abc" }).success,
    ).toBe(true);
    // Blank means "not given", not "invalid".
    expect(createWarehouseSchema.safeParse({ ...VALID, gmapUrl: "" }).success).toBe(true);
  });

  it("answers the usable-area CHECK before the database has to", async () => {
    const { createWarehouseSchema } = await import("@/lib/validation/api-warehouse");
    const parsed = createWarehouseSchema.safeParse({
      ...VALID,
      totalAreaSqft: 10_000,
      usableAreaSqft: 12_000,
    });
    expect(parsed.success).toBe(false);
    // Named field, not a constraint name — the form highlights it.
    expect(!parsed.success && parsed.error.issues[0]!.path).toEqual(["usableAreaSqft"]);
    expect(
      createWarehouseSchema.safeParse({ ...VALID, totalAreaSqft: 10_000, usableAreaSqft: 10_000 })
        .success,
    ).toBe(true);
  });

  it("leaves every field optional on a PATCH, defaults included", async () => {
    const { updateWarehouseSchema } = await import("@/lib/validation/api-warehouse");
    // A `.default()` survives into a PATCH schema as a NON-optional
    // field, so a form that sends only the name would quietly switch
    // racking, CCTV and the weighbridge back to their defaults.
    const parsed = updateWarehouseSchema.safeParse({ name: "Bhiwandi Hub 2" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({ name: "Bhiwandi Hub 2" });
    expect(updateWarehouseSchema.safeParse({}).success).toBe(true);
  });
});
