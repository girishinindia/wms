import { afterEach, describe, expect, it } from "vitest";

import { GET as assetlinks } from "../src/app/.well-known/assetlinks.json/route";
import { GET as aasa } from "../src/app/.well-known/apple-app-site-association/route";

/**
 * The two files that make https://wms.geniusitens.com links open the
 * app. Both are env-driven deployment data, and both must answer 404 —
 * not a placeholder — until configured: Google and Apple cache what
 * they crawl, and a cached placeholder is a verification failure that
 * outlives the fix.
 */

const savedAndroid = process.env.ANDROID_CERT_SHA256;
const savedApple = process.env.APPLE_TEAM_ID;

afterEach(() => {
  if (savedAndroid === undefined) delete process.env.ANDROID_CERT_SHA256;
  else process.env.ANDROID_CERT_SHA256 = savedAndroid;
  if (savedApple === undefined) delete process.env.APPLE_TEAM_ID;
  else process.env.APPLE_TEAM_ID = savedApple;
});

describe("GET /.well-known/assetlinks.json", () => {
  it("answers 404, never a placeholder, while unconfigured", async () => {
    delete process.env.ANDROID_CERT_SHA256;
    const res = await assetlinks();
    expect(res.status).toBe(404);
  });

  it("lists every fingerprint, uppercased, for the real package", async () => {
    process.env.ANDROID_CERT_SHA256 = " aa:bb:cc , DD:EE:FF ";
    const res = await assetlinks();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Array<{
      relation: string[];
      target: {
        package_name: string;
        sha256_cert_fingerprints: string[];
      };
    }>;
    expect(body[0]!.relation).toContain(
      "delegate_permission/common.handle_all_urls",
    );
    // Must match android/app applicationId exactly — a mismatch is a
    // silent verification failure, not an error anywhere.
    expect(body[0]!.target.package_name).toBe("com.geniusitens.wms_mobile");
    expect(body[0]!.target.sha256_cert_fingerprints).toEqual([
      "AA:BB:CC",
      "DD:EE:FF",
    ]);
  });
});

describe("GET /.well-known/apple-app-site-association", () => {
  it("answers 404 while unconfigured", async () => {
    delete process.env.APPLE_TEAM_ID;
    const res = await aasa();
    expect(res.status).toBe(404);
  });

  it("serves JSON with the team-qualified app id and excludes /api", async () => {
    process.env.APPLE_TEAM_ID = "ABCDE12345";
    const res = await aasa();
    expect(res.status).toBe(200);
    // No file extension on the URL, so the header is what tells
    // Apple's CDN this is JSON.
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as {
      applinks: {
        details: Array<{
          appIDs: string[];
          components: Array<Record<string, unknown>>;
        }>;
      };
      webcredentials: { apps: string[] };
    };
    // Must match the Xcode bundle id (com.geniusitens.wmsMobile — note
    // the camel case; it is NOT the Android package name).
    expect(body.applinks.details[0]!.appIDs).toEqual([
      "ABCDE12345.com.geniusitens.wmsMobile",
    ]);
    const components = body.applinks.details[0]!.components;
    expect(components).toContainEqual({ "/": "/api/*", exclude: true });
    expect(components[components.length - 1]).toEqual({ "/": "*" });
    expect(body.webcredentials.apps).toEqual([
      "ABCDE12345.com.geniusitens.wmsMobile",
    ]);
  });
});
