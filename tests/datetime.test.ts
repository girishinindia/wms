import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { fmtDateTime, fmtDay, fmtTime } from "@/lib/format/datetime";

/**
 * Dates that render the same on the server and in the browser.
 *
 * `toLocaleString` reads the machine's time zone unless told otherwise.
 * Every admin screen is server-rendered in UTC and hydrated in a
 * browser — in Mumbai, five and a half hours away — so the same instant
 * produced two different strings and React threw the subtree away:
 *
 *     server HTML   26 Aug 2026, 05:10 am
 *     browser       26 Aug 2026, 10:40 am
 *     → Minified React error #418 (args[]=text)
 *
 * Reported as "errors come when I click Reply by email". The click was
 * innocent — the error had been sitting on the page since it loaded.
 */

const root = new URL("../", import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

// ── The guard ────────────────────────────────────────────────────────

describe("nothing formats a Date by hand", () => {
  /**
   * THE test. The twelve fixes were today's instance of the mistake;
   * this is what stops the thirteenth.
   *
   * Before this existed, four call sites passed `timeZone` and twelve
   * did not — and the twelve were not careless, they were written by
   * somebody reading one of the other twelve. A convention that is
   * followed a quarter of the time is not a convention.
   */
  it("routes every Date through the shared formatter", () => {
    const offenders: string[] = [];

    for (const file of walk(join(root, "src"))) {
      if (file.includes("format/datetime")) continue; // where it is allowed
      const source = readFileSync(file, "utf8");
      const pattern = /toLocale(Date|Time|)String\s*\(/g;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(source))) {
        /**
         * Only DATE formatting is the concern. `Number(x).toLocaleString("en-IN")`
         * for a square-foot count is locale-dependent but not
         * timezone-dependent, and pinning a zone on it would mean
         * nothing.
         */
        const before = source.slice(Math.max(0, match.index - 140), match.index);
        if (!/new Date\(/.test(before.slice(-70))) continue;

        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${file.replace(root, "")}:${line}`);
      }
    }

    expect(
      offenders,
      "use fmtDay / fmtDateTime / fmtTime from @/lib/format/datetime — a raw toLocaleString reads the machine's timezone and mismatches on hydration",
    ).toEqual([]);
  });
});

// ── The formatter itself ─────────────────────────────────────────────

describe("the shared formatter", () => {
  const INSTANT = "2026-08-26T05:10:00Z";

  it("gives the same answer whatever the machine's timezone is", () => {
    /**
     * The actual property under test, stated directly: two processes in
     * different zones must produce identical text for one instant. That
     * is what hydration compares.
     *
     * `Intl` is asked the question the way React would see it — the
     * helper pins the zone, so the surrounding environment cannot move
     * the answer.
     */
    const pinned = new Intl.DateTimeFormat("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
    }).format(new Date(INSTANT));

    expect(fmtDateTime(INSTANT)).toBe(pinned);
    // And it is the India reading, not the UTC one the server would
    // otherwise print.
    expect(fmtDateTime(INSTANT)).toContain("10:40");
    expect(fmtDateTime(INSTANT)).not.toContain("05:10");
  });

  it("keeps the day right in the window where UTC is still yesterday", () => {
    /**
     * A date WITHOUT a time is not automatically safe — it just fails
     * quietly. Between 00:00 and 05:30 IST the UTC clock is on the
     * previous day, so about a quarter of the time a date-only field
     * showed the wrong day with nothing in the console to say so.
     */
    const lateNight = "2026-08-26T20:30:00Z"; // 02:00 IST on the 27th
    expect(fmtDay(lateNight)).toBe("27 Aug 2026");
    expect(new Date(lateNight).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
    })).toBe("26 Aug 2026");
  });

  it("shows a dash for nothing rather than the words Invalid Date", () => {
    // These take whatever the column held, including null and the
    // occasional string that is not a date. "Invalid Date" in a table
    // cell reads as a bug the user has to report.
    for (const empty of [null, undefined, "", "not-a-date"]) {
      expect(fmtDay(empty), String(empty)).toBe("—");
      expect(fmtDateTime(empty), String(empty)).toBe("—");
      expect(fmtTime(empty), String(empty)).toBe("—");
    }
  });

  it("accepts a Date as well as a string", () => {
    // Callers hold both: a cell has the ISO string, a component that
    // already parsed has the object.
    expect(fmtDay(new Date(INSTANT))).toBe(fmtDay(INSTANT));
  });

  it("builds its formatters once, not per row", () => {
    /**
     * `Intl.DateTimeFormat` construction is the expensive part. These
     * render inside table cells, so building one per call would mean
     * 300 of them on every keystroke in a search box.
     */
    const source = readFileSync(join(root, "src/lib/format/datetime.ts"), "utf8");
    const constructions = source.match(/new Intl\.DateTimeFormat/g) ?? [];
    expect(constructions.length).toBe(3);
    // At module scope — inside a function would rebuild on each call.
    for (const line of source.split("\n")) {
      if (line.includes("new Intl.DateTimeFormat")) {
        expect(line, line).toMatch(/^const [A-Z_]+ = new Intl\.DateTimeFormat/);
      }
    }
  });
});
