import { describe, expect, it } from "vitest";

import { GALA_LABEL_SIZES, STICKER_MM, STICKER_SIZES } from "@/components/admin/carton-print";
import { PACKAGE_LABEL_SIZES } from "@/components/admin/dispatch/package-print";

/**
 * Every QR label comes in the thermal rolls as they are sold — 4 × 2,
 * 4 × 3, 4 × 5 and 4 × 6 inch — and on A4 for an office printer. The app offers
 * the same four (core/sticker_printer, package_printer, gala_printer).
 */
describe("label sizes", () => {
  const THERMAL = ["t100x50", "t100x75", "t100x125", "t100x150"];

  it("carton stickers: the three rolls and A4, named by inch and mm", () => {
    expect(STICKER_SIZES.map((s) => s.id)).toEqual([...THERMAL, "a4"]);
    expect(STICKER_SIZES.map((s) => s.label)).toEqual([
      "4 × 2 in · 100 × 50 mm",
      "4 × 3 in · 100 × 75 mm",
      "4 × 5 in · 100 × 125 mm",
      "4 × 6 in · 100 × 150 mm",
      "A4 sheet · 14 per page",
    ]);
    expect(STICKER_MM.t100x125).toMatchObject({ w: 100, h: 125 });
    expect(STICKER_MM.t100x150).toMatchObject({ w: 100, h: 150 });
  });

  it("gala labels: A4 first (today's default), then the three rolls", () => {
    expect(GALA_LABEL_SIZES.map((s) => s.id)).toEqual(["a4", ...THERMAL]);
  });

  it("package labels: the three rolls and A4", () => {
    expect(PACKAGE_LABEL_SIZES.map((s) => s.id).sort()).toEqual([...THERMAL, "a4"].sort());
  });
});
