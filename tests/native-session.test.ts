import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A native client can restore and end its session.
 *
 * The mobile app holds a bearer token — login only returns one for
 * platform ANDROID/IOS — and has no cookie jar. `/auth/session` and
 * `/auth/logout` used to read the cookie ONLY, which meant the app could
 * sign in but never restore its session on the next launch, and its
 * sign-out revoked nothing. Both now read the Authorization header
 * first, falling back to the cookie, in the same order as guard.ts.
 *
 * These are source assertions: if somebody tidies the routes back to
 * `store.get(env.AUTH_COOKIE_NAME)` alone, every mobile session breaks
 * while every browser test stays green — exactly the failure a test
 * has to be the one to catch.
 */

/** The file with comments stripped, so prose never satisfies a check. */
function code(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const session = code("../src/app/api/v1/auth/session/route.ts");
const logout = code("../src/app/api/v1/auth/logout/route.ts");

describe("GET /auth/session accepts a bearer token", () => {
  it("reads the Authorization header, bearer-first like guard.ts", () => {
    expect(session).toMatch(/authorization/);
    expect(session).toMatch(/Bearer\\s\+/);
    // The bearer wins when present; the cookie is the fallback.
    expect(session).toMatch(/bearer \|\| store\.get\(env\.AUTH_COOKIE_NAME\)/);
  });

  it("no longer resolves from the cookie alone", () => {
    expect(session).not.toMatch(
      /resolveSession\(\s*store\.get\(env\.AUTH_COOKIE_NAME\)\?\.value\s*\)/,
    );
  });
});

describe("POST /auth/logout accepts a bearer token", () => {
  it("revokes the token from the Authorization header when present", () => {
    expect(logout).toMatch(/authorization/);
    expect(logout).toMatch(/Bearer\\s\+/);
    expect(logout).toMatch(/bearer \|\| store\.get\(env\.AUTH_COOKIE_NAME\)/);
  });

  it("still clears the cookie for browsers", () => {
    expect(logout).toMatch(/store\.set\(\{ \.\.\.sessionCookieOptions\(0\), value: "" \}\)/);
  });
});
