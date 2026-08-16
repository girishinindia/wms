import { NextResponse } from "next/server";

import { buildOpenApiDocument } from "@/lib/openapi/document";

/**
 * The machine-readable spec. Scalar reads it at /docs, and the Flutter
 * client is generated from it:
 *
 *   openapi-generator generate -i https://wms.geniusitens.com/api/openapi.json \
 *     -g dart-dio -o mobile-app/lib/src/api
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(buildOpenApiDocument(), {
    status: 200,
    headers: {
      // Short cache: the document changes only on deploy, but a stale
      // spec silently generates a stale client.
      "Cache-Control": "public, max-age=0, s-maxage=60",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
