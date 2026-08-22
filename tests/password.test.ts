import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("password hashing", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("produces argon2id at version 0x13 with the configured cost", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    const { authEnv } = await import("@/lib/env");
    const env = authEnv();

    const stored = await hashPassword("correct horse battery staple");

    // This is the assertion that guards the two numeric literals used
    // for algorithm and version — if either drifts, the prefix changes.
    expect(stored).toMatch(/^\$argon2id\$v=19\$/);
    expect(stored).toContain(`m=${env.ARGON2_MEMORY_KIB}`);
    expect(stored).toContain(`t=${env.ARGON2_TIME_COST}`);
    expect(stored).toContain(`p=${env.ARGON2_PARALLELISM}`);
  }, 20_000);

  it("round-trips, and rejects the wrong password", async () => {
    const { hashPassword, verifyPassword } = await import("@/lib/auth/password");
    const stored = await hashPassword("s3cret-passphrase");

    expect(await verifyPassword("s3cret-passphrase", stored)).toBe(true);
    expect(await verifyPassword("s3cret-passphras", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  }, 20_000);

  it("salts, so two users with the same password get different hashes", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    // Without a per-hash salt, identical passwords are visibly identical
    // in a dumped table — which tells an attacker where to start.
    expect(a).not.toBe(b);
  }, 20_000);

  /**
   * The whole point of the pepper. If a hash made under one pepper still
   * verifies under another, the pepper is decorative and a dumped users
   * table is crackable on its own.
   */
  it("will not verify a hash made under a different pepper", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    const stored = await hashPassword("shared-password");

    vi.resetModules();
    vi.stubEnv("PASSWORD_PEPPER", "a-completely-different-pepper-value-32ch");
    const fresh = await import("@/lib/auth/password");

    expect(await fresh.verifyPassword("shared-password", stored)).toBe(false);
  }, 20_000);

  it("treats a corrupt stored hash as a wrong password, not a crash", async () => {
    const { verifyPassword } = await import("@/lib/auth/password");
    // A 500 here would be an oracle: it says the account exists and
    // something about it is unusual.
    for (const junk of ["", "not-a-hash", "$argon2id$truncated", "$2b$10$bcryptish"]) {
      await expect(verifyPassword("anything", junk)).resolves.toBe(false);
    }
  }, 20_000);

  /**
   * Timing. An unknown account must not answer measurably faster than a
   * real one, or the login endpoint enumerates the user base.
   *
   * The bar is deliberately loose — a shared CI box is noisy — but it
   * catches the failure that matters, which is fakeVerify() doing
   * nothing at all and returning in microseconds.
   */
  it("burns comparable time for an account that does not exist", async () => {
    const { hashPassword, verifyPassword, fakeVerify } = await import("@/lib/auth/password");
    const stored = await hashPassword("a-real-password");

    // Warm up: first call pays module init and allocation.
    await verifyPassword("wrong", stored);
    await fakeVerify();

    const timeOf = async (fn: () => Promise<unknown>) => {
      const started = process.hrtime.bigint();
      await fn();
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    const real = await timeOf(() => verifyPassword("wrong-password", stored));
    const fake = await timeOf(() => fakeVerify());

    expect(fake).toBeGreaterThan(real * 0.4);
    expect(fake).toBeLessThan(real * 3);
  }, 30_000);

  it("flags a hash made with weaker parameters for upgrade", async () => {
    const { needsRehash } = await import("@/lib/auth/password");

    expect(needsRehash("$argon2id$v=19$m=19456,t=2,p=1$abc$def")).toBe(true);
    expect(needsRehash("$2b$10$something")).toBe(true);
    expect(needsRehash("")).toBe(true);

    const { hashPassword } = await import("@/lib/auth/password");
    expect(needsRehash(await hashPassword("current"))).toBe(false);
  }, 20_000);

  it("refuses to hash an empty password", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    await expect(hashPassword("")).rejects.toThrow(/empty/i);
  });
});

describe("token handling", () => {
  it("generates session tokens with real entropy", async () => {
    const { generateSessionToken } = await import("@/lib/auth/tokens");
    const tokens = new Set(Array.from({ length: 500 }, generateSessionToken));
    expect(tokens.size).toBe(500);
    // 32 bytes base64url is 43 characters.
    expect([...tokens][0]).toHaveLength(43);
  });

  it("generates OTPs of the configured length, uniformly", async () => {
    const { generateOtp } = await import("@/lib/auth/tokens");
    const counts = new Map<string, number>();
    for (let i = 0; i < 6000; i += 1) {
      const code = generateOtp(6);
      expect(code).toMatch(/^\d{6}$/);
      for (const digit of code) counts.set(digit, (counts.get(digit) ?? 0) + 1);
    }
    // 36000 digits over 10 values. Modulo bias from `randomBytes % 10`
    // would skew the low digits noticeably; uniform stays near 3600.
    expect(counts.size).toBe(10);
    for (const [digit, n] of counts) {
      expect(n, `digit ${digit}`).toBeGreaterThan(3200);
      expect(n, `digit ${digit}`).toBeLessThan(4000);
    }
  });

  it("hashes tokens to a fixed-length digest, never storing plaintext", async () => {
    const { hashToken, generateSessionToken, TOKEN_HASH_LENGTH } = await import(
      "@/lib/auth/tokens"
    );
    const token = generateSessionToken();
    const digest = hashToken(token);

    expect(digest).toHaveLength(TOKEN_HASH_LENGTH);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(token);
    expect(hashToken(token)).toBe(digest); // deterministic
  });

  it("compares digests without short-circuiting", async () => {
    const { safeEqual, hashToken } = await import("@/lib/auth/tokens");
    const a = hashToken("one");
    const b = hashToken("two");

    expect(safeEqual(a, a)).toBe(true);
    expect(safeEqual(a, b)).toBe(false);
    expect(safeEqual(a, "")).toBe(false);
    expect(safeEqual(a, a.slice(0, 63))).toBe(false);
    // Differing only in the last character must still be false — and
    // must not throw on the length-equal path.
    expect(safeEqual(a, a.slice(0, 63) + (a.endsWith("0") ? "1" : "0"))).toBe(false);
  });
});

/**
 * The reveal button, which lives in two places.
 *
 * Both sit inside a `<form>`, and a `<button>` in a form with no `type`
 * is a submit button — so the eye would sign you in, or post a
 * half-typed password change, instead of showing the characters. The
 * bug is invisible in review and obvious to anyone who clicks it once.
 */
describe("showing a password", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

  const places: [string, string][] = [
    ["public auth forms", "../src/components/Field.tsx"],
    ["the profile screen", "../src/components/admin/ProfileForms.tsx"],
  ];

  for (const [where, path] of places) {
    it(`never lets the eye submit the form — ${where}`, () => {
      const src = read(path);
      const toggles = [...src.matchAll(/<button[\s\S]{0,400}?setRevealed[\s\S]{0,200}?>/g)];
      expect(toggles.length, "no reveal button found").toBeGreaterThan(0);
      for (const [tag] of toggles) expect(tag).toMatch(/type="button"/);
    });

    it(`starts hidden and says which state it is in — ${where}`, () => {
      const src = read(path);
      // Never `useState(true)`: a box that opens showing the password
      // is a shoulder-surfing hazard nobody asked for.
      expect(src).toMatch(/useState\(false\)/);
      expect(src).toMatch(/aria-pressed=\{revealed\}/);
      expect(src).toMatch(/revealed \? "Hide/);
      // The input's type is what actually changes — not a CSS trick
      // that leaves the real value in a password field.
      expect(src).toMatch(/revealed \? "text" : /);
    });
  }

  it("leaves room for the eye so it never sits on the text", () => {
    // Both boxes reserve right padding wide enough for the button.
    expect(read("../src/components/Field.tsx")).toMatch(/pr-12/);
    expect(read("../src/components/admin/ProfileForms.tsx")).toMatch(/pr-11/);
  });
});
