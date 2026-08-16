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
   * Pinned, not floating. The default is an unversioned jsDelivr URL, so
   * the docs UI can change under you between two page loads with no
   * deploy. Set SCALAR_CDN to a self-hosted copy of standalone.js if the
   * network blocks jsDelivr — the page renders blank when the script
   * fails, with nothing on screen to say why.
   */
  cdn:
    process.env.SCALAR_CDN ??
    "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.65.1",
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
