import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The domain cutover made this worth pinning down.
 *
 * `wms.notification_template.action_url` holds `/admin/importers/{{id}}`.
 * That path is correct in the portal and useless in an email, and the
 * failure is silent — the mail sends, the button renders, nothing
 * happens when it is clicked. These tests fix the two halves: the origin
 * is resolved from configuration rather than hardcoded, and a relative
 * path never reaches an email as a link.
 */

const APP_KEYS = ["NEXT_PUBLIC_APP_URL", "VERCEL_PROJECT_PRODUCTION_URL", "APP_ENV"] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(APP_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// `appEnv` memoises per process, so every case in this file resolves the
// same origin deliberately — changing it mid-file would be silently
// ignored, which is a worse test than no test.

describe("absoluteUrl", () => {
  it("prefixes a relative path with the configured origin", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://wms.geniusitens.com";
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const { absoluteUrl } = await import("@/lib/url");
    expect(absoluteUrl("/admin/importers/12")).toBe(
      "https://wms.geniusitens.com/admin/importers/12",
    );
  });

  it("adds the leading slash a template might have left off", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://wms.geniusitens.com";
    const { absoluteUrl } = await import("@/lib/url");
    expect(absoluteUrl("admin/importers/12")).toBe(
      "https://wms.geniusitens.com/admin/importers/12",
    );
  });

  it("leaves a URL that already has a scheme alone", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://wms.geniusitens.com";
    const { absoluteUrl } = await import("@/lib/url");
    expect(absoluteUrl("https://elsewhere.example/x")).toBe("https://elsewhere.example/x");
    // The mobile deep-link scheme must survive untouched.
    expect(absoluteUrl("wms://importers/12")).toBe("wms://importers/12");
  });

  it("refuses a protocol-relative path", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://wms.geniusitens.com";
    const { absoluteUrl } = await import("@/lib/url");
    // `//evil.example` would otherwise inherit our scheme.
    expect(absoluteUrl("//evil.example/x")).toBeNull();
  });

  it("returns null for nothing, rather than a bare origin", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://wms.geniusitens.com";
    const { absoluteUrl } = await import("@/lib/url");
    expect(absoluteUrl(null)).toBeNull();
    expect(absoluteUrl(undefined)).toBeNull();
    expect(absoluteUrl("   ")).toBeNull();
  });
});

describe("buildEmailHtml action button", () => {
  it("renders an anchor for an absolute https URL", async () => {
    const { buildEmailHtml } = await import("@/lib/notify/email");
    const html = buildEmailHtml({
      message: "Review it.",
      actionUrl: "https://wms.geniusitens.com/admin/importers/12",
      actionLabel: "Review importer",
    });
    expect(html).toContain('href="https://wms.geniusitens.com/admin/importers/12"');
    expect(html).toContain("Review importer");
  });

  it("drops a relative path instead of rendering a dead button", async () => {
    const { buildEmailHtml } = await import("@/lib/notify/email");
    const html = buildEmailHtml({ message: "Review it.", actionUrl: "/admin/importers/12" });
    expect(html).not.toContain("<a href=");
  });

  it("drops a javascript: URL", async () => {
    const { buildEmailHtml } = await import("@/lib/notify/email");
    const html = buildEmailHtml({
      message: "Review it.",
      actionUrl: "javascript:alert(1)",
    });
    expect(html).not.toContain("<a href=");
    expect(html).not.toContain("javascript:");
  });
});
