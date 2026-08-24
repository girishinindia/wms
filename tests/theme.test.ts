import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The light theme, and the two ways it broke.
 *
 * Both reports arrived together and looked like one bug — "light theme
 * is applied and when I click on audit log it switches to dark", plus
 * "in light theme the approval values are not readable". They had
 * nothing to do with each other.
 */

const root = new URL("../", import.meta.url).pathname;
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const sources = walk(join(root, "src"));

// ── The colours ──────────────────────────────────────────────────────

describe("every status tint the panel uses has a light-theme colour", () => {
  /**
   * Tailwind's 100–300 tints are chosen to sit on a DARK page. On white
   * they are all but invisible: `text-emerald-200` on the approved pill
   * rendered pale mint on near-white, which is the screenshot this test
   * came from. The light theme lifts each of them to a 700/800, and the
   * list of which ones had been lifted was maintained by hand — so
   * amber and rose were covered and emerald, added later, was not.
   *
   * This asserts the list is complete instead. Any tint that appears in
   * a component but not in globals.css fails here, by name, the moment
   * it is introduced rather than the first time somebody switches to
   * the light theme and squints.
   */
  const TINT = /\btext-(emerald|green|teal|lime|sky|blue|indigo|violet|purple|fuchsia|pink|rose|red|orange|amber|yellow|cyan)-(50|100|200|300)(\/\d+)?\b/g;

  /** Tailwind escapes the slash in a class name: `text-rose-200\/80`. */
  const escaped = (cls: string) => cls.replace("/", "\\/");

  it("covers each one", () => {
    const used = new Map<string, string[]>();
    for (const file of sources) {
      for (const m of readFileSync(file, "utf8").matchAll(TINT)) {
        const cls = m[0];
        used.set(cls, [...(used.get(cls) ?? []), file.replace(root, "")]);
      }
    }
    // Something must be found, or a broken regex would pass silently.
    expect(used.size).toBeGreaterThan(5);

    const uncovered = [...used.entries()]
      .filter(([cls]) => !css.includes(`html[data-theme="light"] .${escaped(cls)}`))
      .map(([cls, files]) => `${cls}  (${[...new Set(files)].join(", ")})`);

    expect(uncovered, "tints with no light-theme rule in globals.css").toEqual([]);
  });

  it("uses dark enough replacements to read on white", () => {
    /**
     * Not just "a rule exists" — the rule has to be legible. Each
     * replacement is checked against white, which is the card the pills
     * sit on; their own 10% fill barely moves it. 4.5:1 is WCAG AA for
     * text this size.
     */
    const contrast = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      return (1.05) / (L + 0.05);
    };
    const light = css.slice(css.indexOf('html[data-theme="light"] .text-amber-100'));
    const colours = [...light.matchAll(/color:\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => m[1]!);
    expect(colours.length).toBeGreaterThanOrEqual(3);
    for (const hex of colours) {
      expect(Math.round(contrast(hex) * 10) / 10, `${hex} on white`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("changes nothing outside the light theme", () => {
    // Every rule added for this must be scoped. An unscoped
    // `.text-emerald-200 { color: … }` would repaint the dark panel too.
    for (const line of css.split("\n")) {
      if (/^\s*\.text-(emerald|amber|rose)-/.test(line)) {
        throw new Error(`unscoped status-colour rule: ${line.trim()}`);
      }
    }
  });
});

// ── The theme reset ──────────────────────────────────────────────────

describe("an unknown /admin address keeps the panel", () => {
  /**
   * The sidebar navigates with plain `<a>` on purpose, so every click is
   * a FULL page load. A click on a menu entry whose page is not deployed
   * therefore loads the root 404 — a marketing page, outside the admin
   * layout, and the admin layout is the only thing that carries
   * `PREFS_BOOT_SCRIPT`. No boot script means `data-theme` is never
   * applied, so a light panel lands on a dark page while localStorage
   * still says "light".
   *
   * That is the whole of "clicking Audit Log switches to dark". The
   * catch-all keeps such addresses inside the layout, which keeps the
   * script, which keeps the theme — and leaves the user their sidebar.
   */
  it("has a catch-all route under /admin that answers not-found", () => {
    const catchAll = join(root, "src/app/admin/[...unknown]/page.tsx");
    expect(existsSync(catchAll), "src/app/admin/[...unknown]/page.tsx").toBe(true);
    expect(readFileSync(catchAll, "utf8")).toMatch(/notFound\(\)/);
  });

  it("has an admin not-found that renders inside the shell", () => {
    const page = join(root, "src/app/admin/not-found.tsx");
    expect(existsSync(page), "src/app/admin/not-found.tsx").toBe(true);
    // A full-screen layout of its own would defeat the point: the
    // sidebar and header come from the layout above it.
    expect(readFileSync(page, "utf8")).not.toMatch(/min-h-screen/);
  });

  it("keeps the boot script in the admin layout", () => {
    // It is what applies the saved theme before first paint on every
    // one of those full page loads.
    const layout = readFileSync(join(root, "src/app/admin/layout.tsx"), "utf8");
    expect(layout).toMatch(/PREFS_BOOT_SCRIPT/);
  });

  it("does not throw the theme away just because the shell unmounted", () => {
    /**
     * `clearPrefs()` used to be the unconditional cleanup of a mount
     * effect. "This component unmounted" is not the same fact as "the
     * user left the admin area", and treating them as one meant any
     * unmount took the theme with it. Sign-out says so explicitly
     * instead.
     */
    const shell = readFileSync(join(root, "src/components/admin/AdminShell.tsx"), "utf8");
    expect(shell).not.toMatch(/return \(\) => clearPrefs\(\);/);
    expect(shell).toMatch(/pathname\.startsWith\("\/admin"\)/);
    const signOut = shell.slice(shell.indexOf("async function signOut"));
    expect(signOut.slice(0, 600)).toMatch(/clearPrefs\(\)/);
  });

  it("re-applies the saved theme on arrival rather than only reading it", () => {
    // So a panel that did get stripped repairs itself on the next
    // admin screen instead of disagreeing with its own toggle button.
    const shell = readFileSync(join(root, "src/components/admin/AdminShell.tsx"), "utf8");
    const effect = shell.slice(shell.indexOf("const [font, setFont]"), shell.indexOf("const switchTheme"));
    expect(effect).toMatch(/applyTheme\(saved\)/);
    expect(effect).toMatch(/applyFont\(size\)/);
  });
});
