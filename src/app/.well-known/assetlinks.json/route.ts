/**
 * GET /.well-known/assetlinks.json — Android App Links verification.
 *
 * Google's crawler fetches this to confirm that the app claiming
 * https://wms.geniusitens.com links is really ours: the package name
 * and the SHA-256 fingerprint of the signing certificate have to match
 * what Play signed the app with.
 *
 * The fingerprint is deployment data, not code, so it lives in
 * ANDROID_CERT_SHA256 (comma-separated when both an upload key and the
 * Play App Signing key need to be listed — they do, or links break the
 * moment Play re-signs). Until it is set this answers 404: an empty or
 * placeholder fingerprint would not "half work", it would cache a
 * verification failure on Google's side and links would silently open
 * the browser instead of the app.
 *
 * Get the value after the first Play upload from
 * Play Console → Setup → App integrity → App signing, or locally with
 *   keytool -list -v -keystore upload-keystore.jks | grep SHA256
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PACKAGE_NAME = "com.geniusitens.wms_mobile";

export async function GET() {
  const raw = (process.env.ANDROID_CERT_SHA256 ?? "").trim();
  if (!raw) {
    return new Response(
      JSON.stringify({
        error: "ANDROID_CERT_SHA256 is not configured on this deployment.",
      }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }

  const fingerprints = raw
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter((f) => f.length > 0);

  return new Response(
    JSON.stringify([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: PACKAGE_NAME,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ]),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        // Google re-crawls on its own schedule; a day of caching is
        // fine and keeps the bots off the function.
        "cache-control": "public, max-age=86400",
      },
    },
  );
}
