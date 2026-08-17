import { describe, expect, it } from "vitest";

/**
 * That /docs actually RENDERS, not merely that it returns 200.
 *
 * The page is a shell — an empty <div> plus one script tag. If that
 * script fails to load, the response is still 200 and the page is
 * blank, with one console line nobody sees. That is exactly what
 * happened when the bundle came from jsDelivr and the network could not
 * reach it.
 *
 * So the check is: the script is same-origin, and it is really there.
 */
const BASE = process.env.E2E_BASE_URL;
const describeE2E = BASE ? describe : describe.skip;

if (!BASE) console.warn("\n  docs.test.ts SKIPPED: set E2E_BASE_URL.\n");

describeE2E("/docs", () => {
  it("serves the Scalar shell pointing at the generated spec", async () => {
    const response = await fetch(`${BASE}/docs`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain("Genius WMS API");
    expect(html).toContain('"url": "/api/openapi.json"');
  });

  it("loads its bundle from this origin, not a CDN", async () => {
    const html = await (await fetch(`${BASE}/docs`)).text();
    const src = /<script src="([^"]+)"/.exec(html)?.[1];

    expect(src, "no script tag found").toBeTruthy();
    // A third-party script on the page that renders the whole API
    // surface — including anything typed into "Try it" — and a blank
    // page whenever that host is unreachable.
    expect(src).not.toMatch(/^https?:\/\//);
    expect(src).toBe("/scalar/standalone.js");

    const asset = await fetch(`${BASE}${src}`);
    expect(asset.status).toBe(200);
    // The real bundle is megabytes; a 404 page or an empty file is not.
    const body = await asset.text();
    expect(body.length).toBeGreaterThan(500_000);
  }, 30_000);

  it("serves a spec the docs page can actually render", async () => {
    const spec = await (await fetch(`${BASE}/api/openapi.json`)).json();

    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Genius WMS API");

    const authPaths = Object.keys(spec.paths).filter((p) => p.includes("/auth/"));
    expect(authPaths).toHaveLength(8);

    // Every operation needs a summary, or the sidebar shows bare paths.
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(item as Record<string, any>)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        expect(op.summary, `${method} ${path} has no summary`).toBeTruthy();
        expect(op.tags?.length, `${method} ${path} has no tag`).toBeGreaterThan(0);
      }
    }
  });
});
