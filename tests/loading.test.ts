import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Telling the user that something is happening.
 *
 * Two different silences were reported as one: a click that appeared to
 * do nothing, and a screen that froze and then swapped whole. They have
 * separate causes and separate fixes, and both are asserted here.
 */

const root = new URL("../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(root, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

// ── Every screen has something to show while it waits ────────────────

describe("route loading boundaries", () => {
  /**
   * Without a `loading.tsx` the server holds the whole response until
   * the last query returns. Because the panel navigates with full page
   * loads, the browser then has nothing to paint and keeps the PREVIOUS
   * screen up — which is why the audit log looked like it froze the
   * window and swapped it all at once. It did.
   */
  it("covers every admin route from the segment root", () => {
    // One file at the top of /admin serves this segment and everything
    // nested under it, so a new screen inherits a loading state instead
    // of having to remember one.
    expect(existsSync(join(root, "src/app/admin/loading.tsx"))).toBe(true);
  });

  it("gives the screens that are not lists a matching shape", () => {
    /**
     * A skeleton of the wrong shape is worse than none: the content
     * lands, everything moves, and the page jumps twice instead of
     * once. The forms and the dashboard say so for themselves.
     */
    for (const route of ["profile", "company", "(overview)"]) {
      expect(existsSync(join(root, `src/app/admin/${route}/loading.tsx`)), route).toBe(true);
    }
  });

  it("keeps the dashboard's own URL while giving it its own segment", () => {
    // `(overview)` is a route group: parentheses mean it does not appear
    // in the path. /admin is still served, by the page inside it.
    expect(existsSync(join(root, "src/app/admin/(overview)/page.tsx"))).toBe(true);
    expect(existsSync(join(root, "src/app/admin/page.tsx"))).toBe(false);
  });

  it("renders the skeleton on the server", () => {
    // A loading state shipped to the browser as JavaScript is a strange
    // way to make a page feel faster.
    expect(read("src/components/admin/Skeleton.tsx")).not.toMatch(/"use client"/);
  });

  it("announces itself once, not once per bar", () => {
    const skeleton = read("src/components/admin/Skeleton.tsx");
    // One live region for the whole thing; the decorative bars are
    // hidden, or a reader hears "loading" forty times.
    expect(skeleton).toMatch(/role="status"/);
    expect(skeleton).toMatch(/aria-busy="true"/);
    expect(skeleton).toMatch(/function Bar[\s\S]{0,200}aria-hidden/);
  });
});

// ── Every navigation says it is under way ────────────────────────────

describe("navigation progress", () => {
  const progress = read("src/components/admin/NavProgress.tsx");
  const store = read("src/lib/admin/navigating.ts");

  it("listens for both ways a page load starts", () => {
    /**
     * There is no router event to hook — these are browser
     * navigations. The gesture is the only signal, and there are two:
     * a link (sidebar, sort header, pager, Clear) and a GET form
     * submit (the search box, and the filter selects, which submit
     * their form on change).
     */
    expect(progress).toMatch(/addEventListener\("click", onClick, true\)/);
    expect(progress).toMatch(/addEventListener\("submit", onSubmit, true\)/);
  });

  it("listens in the capture phase", () => {
    // A handler further down that stops propagation would otherwise
    // hide the navigation from the bar. Both listeners pass `true`.
    const listeners = progress.match(/addEventListener\("(click|submit)"[^)]*\)/g) ?? [];
    expect(listeners.length).toBe(2);
    for (const l of listeners) expect(l, l).toMatch(/, true\)$/);
  });

  it("ignores clicks that do not navigate this tab", () => {
    // A modified click opens a tab; a download stays put; an anchor
    // jumps in place; an off-site link is not ours to report on.
    for (const guard of ["metaKey", "ctrlKey", "shiftKey", "altKey", "download", 'startsWith("#")', "url.origin !== window.location.origin"]) {
      expect(progress, guard).toContain(guard);
    }
    expect(progress).toMatch(/event\.button !== 0/);
  });

  it("only reports GET forms", () => {
    // A drawer saves over fetch and calls preventDefault. Arming the
    // bar for one would leave it running until the abandon timeout.
    expect(progress).toMatch(/method !== "get"/);
    expect(progress).toMatch(/event\.defaultPrevented/);
  });

  it("recovers when a navigation never arrives", () => {
    /**
     * Nothing clears the bar on the happy path, because nothing has to:
     * the document is replaced. The two unhappy paths are a navigation
     * the browser abandons and a return through the back/forward cache,
     * which restores this page mid-flight, bar and all.
     */
    expect(store).toMatch(/ABANDONED_MS/);
    expect(progress).toMatch(/pageshow/);
    expect(progress).toMatch(/event\.persisted/);
  });

  it("stages the reveal so a fast page shows nothing", () => {
    /**
     * Under 150ms a bar is a flicker, and a flicker on a screen that
     * was already fast reads as a glitch. The dim waits longer still —
     * it is for the point where stale content starts to look live.
     */
    expect(store).toMatch(/BAR_MS = 150/);
    expect(store).toMatch(/DIM_MS = 400/);
    // Measured from the click, not from the render, or a re-render
    // partway through the wait restarts the clock.
    expect(store).toMatch(/performance\.now\(\) - pending\.since/);
  });

  it("keeps one source for the bar and the dim", () => {
    // Two sets of timers would let the sidebar marker and the dim
    // disagree about whether anything is in flight.
    expect(store).toMatch(/export function useNavStage/);
    expect(read("src/components/admin/AdminShell.tsx")).toMatch(/useNavStage\(\)/);
    expect(progress).toMatch(/useNavStage\(\)/);
  });

  it("dims the content area from <main>, not from an overlay", () => {
    /**
     * `<main>` is the element that knows where the content area is. An
     * overlay would have to reproduce the sidebar's width and would get
     * it wrong the first time the sidebar collapsed — which it can.
     */
    const shell = read("src/components/admin/AdminShell.tsx");
    expect(shell).toMatch(/navStage === "dim" \? "nav-dimmed" : ""/);
    expect(progress).not.toMatch(/left-64/);
  });

  it("leaves the sidebar lit and clickable while it waits", () => {
    // Somebody who picked the wrong entry can pick another without
    // waiting for the first to land.
    const css = read("src/app/globals.css");
    const dim = css.slice(css.indexOf(".nav-dimmed"), css.indexOf(".nav-dimmed") + 200);
    expect(dim).not.toMatch(/pointer-events/);
  });

  it("marks the entry that was clicked, exactly", () => {
    // `startsWith` would light up /admin as well when going anywhere.
    expect(read("src/components/admin/AdminShell.tsx")).toMatch(/navigatingTo === item\.href/);
  });

  it("tells the store about the one navigation script starts itself", () => {
    // Opening a notification calls window.location.assign, which no
    // click listener sees.
    const bell = read("src/components/admin/NotificationBell.tsx");
    const open = bell.slice(bell.indexOf("async function openItem"));
    expect(open.indexOf("startNavigation")).toBeGreaterThan(-1);
    expect(open.indexOf("startNavigation")).toBeLessThan(open.indexOf("window.location.assign"));
  });

  it("renders nothing on the server", () => {
    // A bar in the HTML would show one on a page that has arrived.
    expect(store).toMatch(/getServerSnapshot = \(\): Navigating \| null => null/);
  });
});

// ── Motion ───────────────────────────────────────────────────────────

describe("respecting reduced motion", () => {
  const css = readFileSync(join(root, "src/app/globals.css"), "utf8");

  it("stops every animation this added, without hiding the meaning", () => {
    /**
     * A permanently moving element is a migraine trigger for some
     * people. The bar and the skeleton still appear and still mean the
     * same thing — they simply stop moving. Same reasoning as the
     * `motion-safe:` already on the button spinner.
     */
    const reduce = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const cls of ["nav-progress", "skeleton-bar"]) {
      const rule = reduce.slice(reduce.indexOf(`.${cls}`), reduce.indexOf(`.${cls}`) + 160);
      expect(rule, cls).toMatch(/animation: none/);
    }
  });

  it("still animates for everybody else", () => {
    expect(css).toMatch(/@keyframes nav-progress-creep/);
    expect(css).toMatch(/@keyframes skeleton-sweep/);
  });

  it("never lets the bar reach the end", () => {
    /**
     * The bar is indeterminate — nothing on this side knows how far
     * along the server is. It creeps to 90% and stops; the arriving
     * document finishes it by replacing the page. One that sat at 100%
     * would look stuck at exactly the wrong moment.
     */
    const creep = css.slice(css.indexOf("@keyframes nav-progress-creep"));
    expect(creep.slice(0, 220)).toMatch(/100%\s*\{\s*transform: scaleX\(0\.9\)/);
  });
});

// ── What was already right ───────────────────────────────────────────

describe("the per-operation loaders that already existed", () => {
  /**
   * Saves, deletes, toggles and uploads already disabled their control
   * and showed a spinner before any of this. Asserted so that the sweep
   * which added navigation feedback cannot quietly cost any of it.
   */
  const components = walk(join(root, "src/components")).filter((f) => f.endsWith(".tsx"));

  it("still passes busy to every Switch and ConfirmDialog", () => {
    const missing: string[] = [];
    for (const file of components) {
      const src = readFileSync(file, "utf8");
      for (const tag of ["<Switch", "<ConfirmDialog"]) {
        let i = src.indexOf(tag);
        while (i > -1) {
          // The props of one element: up to its closing bracket.
          const end = src.indexOf("/>", i);
          const block = src.slice(i, end === -1 ? i + 400 : end);
          if (!block.includes("busy=")) missing.push(`${file.replace(root, "")} ${tag}`);
          i = src.indexOf(tag, i + 1);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
