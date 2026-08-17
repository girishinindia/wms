import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ok = (body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

describe("reCAPTCHA v3", () => {
  const realFetch = global.fetch;
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    global.fetch = realFetch;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("skips cleanly when disabled, and says so", async () => {
    vi.stubEnv("RECAPTCHA_ENABLED", "false");
    const spy = vi.fn();
    global.fetch = spy as unknown as typeof fetch;

    const { verifyRecaptcha } = await import("@/lib/auth/recaptcha");
    const result = await verifyRecaptcha("token", "register");

    expect(spy).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    // `skipped` rather than a silent pass: a handler can log that the
    // check did not run, instead of discovering in six months that it
    // was never on.
    if (result.ok) expect(result.skipped).toBe(true);
  });

  it("refuses to start with the check on and no secret key", async () => {
    vi.stubEnv("RECAPTCHA_ENABLED", "true");
    vi.stubEnv("RECAPTCHA_SECRET_KEY", "");
    const { recaptchaEnv } = await import("@/lib/env");
    // That combination rejects every real user, silently.
    expect(() => recaptchaEnv()).toThrow(/RECAPTCHA_SECRET_KEY/);
  });

  it("passes a score at or above the threshold and blocks one below", async () => {
    vi.stubEnv("RECAPTCHA_ENABLED", "true");
    vi.stubEnv("RECAPTCHA_SECRET_KEY", "test-secret");
    vi.stubEnv("RECAPTCHA_MIN_SCORE", "0.5");
    const { verifyRecaptcha, shouldBlock } = await import("@/lib/auth/recaptcha");

    global.fetch = ok({ success: true, score: 0.9, action: "register" });
    const good = await verifyRecaptcha("t", "register");
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.score).toBe(0.9);
    expect(shouldBlock(good)).toBe(false);

    global.fetch = ok({ success: true, score: 0.5, action: "register" });
    expect((await verifyRecaptcha("t", "register")).ok).toBe(true);

    global.fetch = ok({ success: true, score: 0.1, action: "register" });
    const bad = await verifyRecaptcha("t", "register");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("LOW_SCORE");
    expect(shouldBlock(bad)).toBe(true);
  });

  it("sends the secret and the caller's IP, never the site key", async () => {
    vi.stubEnv("RECAPTCHA_ENABLED", "true");
    vi.stubEnv("RECAPTCHA_SECRET_KEY", "the-secret");
    let body = "";
    let url = "";
    global.fetch = (async (u: string, init: RequestInit) => {
      url = String(u);
      body = String(init.body);
      return new Response(JSON.stringify({ success: true, score: 0.8 }), { status: 200 });
    }) as unknown as typeof fetch;

    const { verifyRecaptcha } = await import("@/lib/auth/recaptcha");
    await verifyRecaptcha("the-token", "login", "198.51.100.7");

    expect(url).toBe("https://www.google.com/recaptcha/api/siteverify");
    const params = new URLSearchParams(body);
    expect(params.get("secret")).toBe("the-secret");
    expect(params.get("response")).toBe("the-token");
    expect(params.get("remoteip")).toBe("198.51.100.7");
  });

  /**
   * A v3 token is bound to the action the client asked for. Without this
   * check, a token minted on a public contact form is a valid token for
   * password reset.
   */
  it("rejects a token minted for a different action", async () => {
    vi.stubEnv("RECAPTCHA_ENABLED", "true");
    vi.stubEnv("RECAPTCHA_SECRET_KEY", "s");
    global.fetch = ok({ success: true, score: 0.9, action: "contact_form" });

    const { verifyRecaptcha } = await import("@/lib/auth/recaptcha");
    const result = await verifyRecaptcha("t", "password_reset");
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "INVALID") {
      expect(result.detail).toContain("contact_form");
    } else {
      throw new Error(`expected INVALID, got ${JSON.stringify(result)}`);
    }
  });

  it("treats an expired or reused token as user error, not an attack", async () => {
    vi.stubEnv("RECAPTCHA_ENABLED", "true");
    vi.stubEnv("RECAPTCHA_SECRET_KEY", "s");
    global.fetch = ok({ success: false, "error-codes": ["timeout-or-duplicate"] });

    const { verifyRecaptcha, shouldBlock } = await import("@/lib/auth/recaptcha");
    const result = await verifyRecaptcha("stale", "register");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("STALE_TOKEN");
    // A form left open for three minutes is a stale page. Blocking it
    // reads to the user as "access denied" for doing nothing wrong.
    expect(shouldBlock(result)).toBe(false);
  });

  /**
   * Fail open when Google is unreachable. This is a real trade and worth
   * stating: an outage at their end must not take sign-up down, and
   * everything that gets through is still rate-limited and still needs a
   * password or an OTP.
   */
  it("fails open when Google is unreachable", async () => {
    vi.stubEnv("RECAPTCHA_ENABLED", "true");
    vi.stubEnv("RECAPTCHA_SECRET_KEY", "s");
    global.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const { verifyRecaptcha, shouldBlock } = await import("@/lib/auth/recaptcha");
    const result = await verifyRecaptcha("t", "register");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("UNAVAILABLE");
    expect(shouldBlock(result)).toBe(false);
  });

  it("blocks a missing token when the check is on", async () => {
    vi.stubEnv("RECAPTCHA_ENABLED", "true");
    vi.stubEnv("RECAPTCHA_SECRET_KEY", "s");
    const { verifyRecaptcha, shouldBlock } = await import("@/lib/auth/recaptcha");

    for (const token of [undefined, null, ""]) {
      const result = await verifyRecaptcha(token, "register");
      expect(result.ok).toBe(false);
      expect(shouldBlock(result)).toBe(true);
    }
  });
});

describe("rate limiting", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("allows everything when disabled", async () => {
    vi.stubEnv("RATELIMIT_ENABLED", "false");
    const { limitAuthAttempt, limitOtpSend } = await import("@/lib/auth/ratelimit");

    expect((await limitAuthAttempt({ ip: "1.2.3.4", account: "a@b.com" })).allowed).toBe(true);
    expect((await limitOtpSend("a@b.com")).allowed).toBe(true);
  });

  /**
   * Fail open on an Upstash outage. Failing closed would turn a Redis
   * blip into "nobody can log in" — an outage caused by the defence
   * rather than the attack. Account lockout lives in Postgres and is
   * what actually stops credential stuffing.
   */
  it("allows the request when Upstash is unreachable", async () => {
    const { limitOrAllow } = await import("@/lib/auth/ratelimit");
    const result = await limitOrAllow(async () => {
      throw new Error("upstash unreachable");
    });
    expect(result.allowed).toBe(true);
    expect(result.degraded).toBe(true);
  });

  it("takes the first x-forwarded-for entry, not the last", async () => {
    const { clientIp } = await import("@/lib/auth/ratelimit");

    // The last entry is our own edge; rate-limiting on it throttles
    // every user behind the same proxy as one.
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.5, 70.41.3.18, 10.0.0.1" }))).toBe(
      "203.0.113.5",
    );
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBeNull();
  });
});
