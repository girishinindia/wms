import { ApiReference } from "@scalar/nextjs-api-reference";

/**
 * Scalar, served at /docs against the generated spec.
 *
 * A route handler rather than a page: Scalar renders its own complete
 * HTML document, so wrapping it in the site layout would nest a second
 * <html> inside the portal's.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = ApiReference({
  url: "/api/openapi.json",
  /**
   * Served from THIS origin, not jsDelivr.
   *
   * Scalar's default is an unversioned CDN URL. Three problems, and the
   * first is how this was caught — a headless render of /docs produced a
   * blank page and one console line, `Scalar is not defined`, because
   * the script never arrived:
   *
   *   1. No CDN, no docs. Not an error message — an empty page. Any
   *      corporate proxy, offline session or strict CSP does this.
   *   2. A third-party script runs on the page that renders the whole
   *      API surface, including anything typed into "Try it".
   *   3. The version lived in a string here rather than in package.json,
   *      so `npm audit` never saw it.
   *
   * `scripts/vendor-scalar.mjs` copies the bundle out of the installed
   * package into public/scalar during `prebuild`, so the version comes
   * from package.json and the asset is same-origin. SCALAR_CDN still
   * overrides it if you would rather use a CDN.
   */
  cdn: process.env.SCALAR_CDN ?? "/scalar/standalone.js",
  pageTitle: "Genius WMS API",
  // Closest of Scalar's built-in themes to the portal's verdigris.
  theme: "moon",
  darkMode: true,
  hideDownloadButton: false,
  metaData: {
    title: "Genius WMS API",
    description: "API reference for the Genius WMS portal and mobile app.",
  },
});
