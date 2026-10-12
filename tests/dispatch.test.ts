import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ADMIN_NAV_ITEMS, visibleNav } from "@/components/admin/nav";
import { count } from "@/lib/dispatch/ops";
import { cartonNoFromScan } from "@/lib/inward/carton-format";
import { assignSchema, cancelNoteSchema, holdSchema, packageActionSchema, packScanSchema, scanSchema } from "@/lib/validation/api-dispatch";

/**
 * Pick & pack: request shapes, who sees the screen, and the SQL that does
 * the work. Each scan (dn_pick / dn_arrive / dn_pack / dn_verify) locks the
 * note and the carton in one database function and is exercised end to end.
 */

describe("request shapes", () => {
  it("a scan names its step and a code", () => {
    expect(scanSchema.safeParse({ step: "PICK", code: "INR-000002-0001" }).success).toBe(true);
    expect(scanSchema.safeParse({ step: "PICK", code: "  " }).success).toBe(false);
    expect(scanSchema.safeParse({ step: "SHIP", code: "x" }).success).toBe(false);
  });
  it("a pack scan can take a carton out", () => {
    expect(packScanSchema.parse({ code: "INR-000002-0001", remove: true }).remove).toBe(true);
  });
  it("hold says yes or no; assign takes a list", () => {
    expect(holdSchema.safeParse({ on: true, reason: "Buyer asked to wait" }).success).toBe(true);
    expect(assignSchema.safeParse({ userIds: [1, 2] }).success).toBe(true);
    expect(assignSchema.safeParse({ userIds: [0] }).success).toBe(false);
  });
  it("package weight and size are positive", () => {
    expect(packageActionSchema.safeParse({ action: "CLOSE", weightKg: 12.5 }).success).toBe(true);
    expect(packageActionSchema.safeParse({ action: "CLOSE", weightKg: -1 }).success).toBe(false);
    expect(packageActionSchema.safeParse({ action: "SHIP" }).success).toBe(false);
  });
  it("cancelling a note needs a reason", () => {
    expect(cancelNoteSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(cancelNoteSchema.safeParse({ reason: "Order moved" }).success).toBe(true);
  });
});

describe("labels and codes", () => {
  it("counts carry their noun", () => {
    expect(count(1, "carton")).toBe("1 carton");
    expect(count(14, "carton")).toBe("14 cartons");
    expect(count(0, "package")).toBe("0 packages");
  });
  it("a package label is not read as a carton", () => {
    expect(cartonNoFromScan("PK-000123")).toBeNull();
  });
});

describe("who sees Pick & pack", () => {
  const entry = ADMIN_NAV_ITEMS.find((i) => i.href === "/admin/dispatch");
  it("is keyed on package.read", () => {
    expect(entry?.permission).toBe("package.read");
  });
  it("not for the importer or agent, who hold package.read at OWN", () => {
    const own = visibleNav([{ permission: "package.read", scope: "OWN" }]);
    expect(own.some((i) => i.href === "/admin/dispatch")).toBe(false);
    const wh = visibleNav([{ permission: "package.read", scope: "WAREHOUSE" }]);
    expect(wh.some((i) => i.href === "/admin/dispatch")).toBe(true);
  });
});

// The sql/ folder sits beside web-api and is not in this repository, so CI skips this.
const sql41 = new URL("../../sql/41_dn_pick_pack.sql", import.meta.url);
describe.skipIf(!existsSync(sql41))("SQL 41", () => {
  const ddl = existsSync(sql41) ? readFileSync(sql41, "utf8") : "";
  it("only touches the wms schema", () => {
    expect(ddl).toMatch(/^set search_path = wms;$/m);
    expect(ddl).not.toMatch(/\b(public|auth|storage|extensions|cron|net)\.[a-z_]/i);
  });
  it("pins search_path on every function", () => {
    const fns = ddl.match(/create\s+or\s+replace\s+function/gi)?.length ?? 0;
    const pinned = ddl.match(/set\s+search_path\s*=\s*wms,\s*public/gi)?.length ?? 0;
    expect(fns).toBeGreaterThan(5);
    expect(pinned).toBe(fns);
  });
  it("locks the note and the carton on every scan", () => {
    for (const fn of ["dn_pick", "dn_arrive", "dn_pack", "dn_verify"]) {
      const body = ddl.split(new RegExp(`function ${fn}\\(`))[1]?.split("end $$;")[0] ?? "";
      expect(body, fn).toMatch(/for update/i);
    }
  });
  it("a scan id is answered once", () => {
    expect(ddl).toMatch(/client_scan_id\s+text\s+unique/i);
  });
});
