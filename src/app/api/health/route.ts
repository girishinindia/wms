import { NextResponse } from "next/server";

/**
 * Liveness probe — the endpoint UptimeRobot polls.
 *
 * Deliberately does NOT touch the database, Redis or any third party.
 * A liveness check that depends on downstream services will page you at
 * 3am because Bunny had a blip, which trains everyone to ignore the
 * pager. Dependency checks belong on a separate /api/health/ready route
 * once those dependencies actually exist.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const startedAt = Date.now();

function payload() {
  return {
    status: "ok" as const,
    service: "wms-web-api",
    version: process.env.npm_package_version ?? "0.1.0",
    environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown",
    region: process.env.VERCEL_REGION ?? "local",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  };
}

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
} as const;

export async function GET() {
  return NextResponse.json(payload(), { status: 200, headers: NO_STORE });
}

/** Cheaper for monitors that only need the status code. */
export async function HEAD() {
  return new Response(null, { status: 200, headers: NO_STORE });
}
