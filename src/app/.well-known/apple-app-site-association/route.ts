/**
 * GET /.well-known/apple-app-site-association — iOS Universal Links.
 *
 * Apple's CDN fetches this (no file extension, but the body must still
 * be served as JSON) to confirm the app may claim
 * https://wms.geniusitens.com links. The app ID is TEAMID.bundleid;
 * the team ID is deployment data, so it lives in APPLE_TEAM_ID and the
 * route answers 404 until it is set — same reasoning as assetlinks: a
 * placeholder would cache a failure on Apple's CDN, not half-work.
 *
 * The paths mirror the mobile router: the public site, the auth links
 * that arrive by email (verify, reset-password), and the signed-in
 * screens. `/api/*` is excluded — a link to the API is for a browser
 * or a tool, never for the app to swallow.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUNDLE_ID = "com.geniusitens.wmsMobile";

export async function GET() {
  const teamId = (process.env.APPLE_TEAM_ID ?? "").trim();
  if (!teamId) {
    return new Response(
      JSON.stringify({
        error: "APPLE_TEAM_ID is not configured on this deployment.",
      }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }

  const appId = `${teamId}.${BUNDLE_ID}`;

  return new Response(
    JSON.stringify({
      applinks: {
        details: [
          {
            appIDs: [appId],
            components: [
              { "/": "/api/*", exclude: true },
              { "/": "/docs*", exclude: true },
              { "/": "*" },
            ],
          },
        ],
      },
      webcredentials: { apps: [appId] },
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=86400",
      },
    },
  );
}
