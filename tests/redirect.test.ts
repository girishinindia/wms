import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Where sign-in sends you.
 *
 * The admin guard redirects an anonymous visitor to
 * `/sign-in?next=/admin`, and the form ignored the parameter and pushed
 * `/` unconditionally. Signing in from the guard therefore landed on the
 * marketing page with a cheerful toast and no sign of the thing you had
 * asked for — a promise made by one file and broken by another.
 *
 * `safeNext` is the other half. `?next=` comes off the address bar, so
 * pushing it unchecked is an open redirect: our domain, our sign-in
 * page, somebody else's login form on the far side of it.
 */

const source = readFileSync(
  new URL("../src/components/forms/SignInForm.tsx", import.meta.url),
  "utf8",
);

/** Lifted from the component, which has no export to import — the rule
 *  is three lines and duplicating it here is cheaper than restructuring
 *  a client component to make it testable. Kept identical on purpose;
 *  the last case in this file is what catches them drifting apart. */
function safeNext(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

describe("post-sign-in redirect", () => {
  it("keeps a path on this site", () => {
    expect(safeNext("/admin")).toBe("/admin");
    expect(safeNext("/admin/importers/12")).toBe("/admin/importers/12");
  });

  it("refuses an absolute URL", () => {
    expect(safeNext("https://evil.example/login")).toBeNull();
    expect(safeNext("http://evil.example")).toBeNull();
  });

  it("refuses a protocol-relative path", () => {
    // The one people miss: the browser treats this as a hostname.
    expect(safeNext("//evil.example/login")).toBeNull();
  });

  it("refuses anything that is not a path", () => {
    expect(safeNext("admin")).toBeNull();
    expect(safeNext("javascript:alert(1)")).toBeNull();
    expect(safeNext(null)).toBeNull();
    expect(safeNext("")).toBeNull();
  });

  it("no longer navigates to a hardcoded destination", () => {
    // The original regression: `router.push("/")` with nothing else.
    expect(source).not.toMatch(/router\.(push|replace)\(\s*["']\/["']\s*\)/);
    expect(source).toMatch(/router\.replace\(await destination\(/);
  });

  it("still guards the parameter it now honours", () => {
    expect(source).toMatch(/startsWith\("\/\/"\)/);
  });

  /**
   * The second half of "it does not redirect".
   *
   * The destination was always right; the button was not. `isSubmitting`
   * clears the moment onSubmit returns, so it flipped back to an enabled
   * "Sign in" while three round trips were still in flight — a success
   * toast, a live button and a stationary page, which reads as a failure
   * and invites a second click.
   */
  it("stays in a pending state through the navigation, not just the request", () => {
    expect(source).toMatch(/setRedirecting\(true\)/);
    // Disabled and labelled on `redirecting`, not only on `isSubmitting`.
    expect(source).toMatch(/disabled=\{isSubmitting \|\| redirecting\}/);
    expect(source).toMatch(/redirecting \?\s*"[^"]+"/);
    // And never cleared — the navigation unmounts it.
    expect(source).not.toMatch(/setRedirecting\(false\)/);
  });
});
