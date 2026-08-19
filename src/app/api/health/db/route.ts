import { NextResponse } from "next/server";
import { sql as raw } from "drizzle-orm";

import { getDb } from "@/db";
import { cacheActive, redis } from "@/lib/cache/redis";
import { qstashActive } from "@/lib/jobs/qstash";

/**
 * Database readiness probe.
 *
 * Read-only by construction: one SELECT of session metadata, no writes,
 * no DDL, no extensions. Safe to hit against production.
 *
 * Kept separate from /api/health on purpose — that one is liveness and
 * must stay green when Supabase blips, or the pager cries wolf. This is
 * the one you check when something is actually wrong.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
} as const;

type Row = {
  database: string;
  user: string;
  version: string;
  server_time: string;
};

export async function GET() {
  const startedAt = Date.now();

  try {
    const rows = (await getDb().execute(
      raw`select
            current_database()          as database,
            current_user                as user,
            version()                   as version,
            now()                       as server_time`
    )) as unknown as Row[];

    const row = rows[0];
    const latencyMs = Date.now() - startedAt;

    // Redis and QStash: configured or not, and (for Redis) reachable.
    // Both are optional, so neither turns this probe red — they are
    // reported so "is the cache actually on in prod" is one curl.
    let cache: "off" | "ok" | "unreachable" = "off";
    let cacheMs: number | null = null;
    if (cacheActive()) {
      const t = Date.now();
      try {
        const pong = await Promise.race([redis()!.ping(), new Promise((r) => setTimeout(() => r(null), 1500))]);
        cache = pong ? "ok" : "unreachable";
      } catch {
        cache = "unreachable";
      }
      cacheMs = Date.now() - t;
    }

    return NextResponse.json(
      {
        status: "ok" as const,
        latencyMs,
        database: row.database,
        user: row.user,
        // "PostgreSQL 17.4 on aarch64-unknown-linux-gnu…" — the first
        // two words are all anyone reads.
        server: row.version.split(" ").slice(0, 2).join(" "),
        serverTime: row.server_time,
        pooler: poolerMode(),
        cache,
        cacheMs,
        queue: qstashActive() ? "qstash" : "inline",
        timestamp: new Date().toISOString(),
      },
      { status: 200, headers: NO_STORE }
    );
  } catch (error) {
    // Drizzle wraps driver errors in a DrizzleQueryError whose message is
    // just the SQL it tried. The useful part — the pg error code, the DNS
    // failure — is on `cause`, so walk to the innermost one.
    const e = rootCause(error);
    const code = e.code ?? e.errno ?? null;

    // Never echo the connection string — it carries the password.
    return NextResponse.json(
      {
        status: "error" as const,
        latencyMs: Date.now() - startedAt,
        code,
        message: e.message ?? "Unknown database error",
        hint: hintFor(code),
        timestamp: new Date().toISOString(),
      },
      { status: 503, headers: NO_STORE }
    );
  }
}

type DriverError = { message?: string; code?: string; errno?: string };

function rootCause(error: unknown): DriverError {
  let current = error;
  while (
    current &&
    typeof current === "object" &&
    "cause" in current &&
    (current as { cause?: unknown }).cause
  ) {
    current = (current as { cause: unknown }).cause;
  }
  return (current ?? {}) as DriverError;
}

/** Reports which port the URL points at, without revealing the URL. */
function poolerMode(): string {
  const url = process.env.DATABASE_URL ?? "";
  if (url.includes(":6543")) return "transaction (6543)";
  if (url.includes(":5432")) return "session/direct (5432)";
  return "unknown";
}

/** The four failures that actually happen on a first Supabase connect. */
function hintFor(code: string | undefined | null): string | null {
  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "Host not found — check the pooler region prefix (aws-0 vs aws-1) in DATABASE_URL.";
    case "ENETUNREACH":
      return "Network unreachable — this is the IPv6-only host. Turn on 'Use IPv4 connection' in Supabase and re-copy the string.";
    case "ETIMEDOUT":
    case "ECONNREFUSED":
      return "Could not reach the pooler — check the port and that the project is not paused.";
    case "28P01":
      return "Password authentication failed — percent-encode special characters in the password.";
    case "3D000":
      return "Database does not exist — the path should end in /postgres.";
    default:
      return null;
  }
}
