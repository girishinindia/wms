import { NextResponse } from "next/server";

/**
 * API index for /api/v1.
 *
 * Placeholder that documents the namespace and gives clients something
 * meaningful to hit while the real route handlers are built. Replace
 * `endpoints` with the generated OpenAPI document once zod-to-openapi
 * is wired up, and serve Scalar at /docs against it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      name: "Genius WMS API",
      version: "v1",
      status: "scaffolded",
      documentation: "/docs",
      endpoints: {
        health: "/api/health",
        databaseHealth: "/api/health/db",
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
