import "server-only";

import type { NextRequest } from "next/server";

import { fail, toResponse } from "@/lib/api/respond";
import { importerIdOf, type Actor, type Grant } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { InwardError, type Meta } from "@/lib/inward/ops";

/**
 * Whose importer a write is for.
 *
 * An importer-side actor is bound to one company and that is the only
 * answer — nothing in the request can redirect them. A platform actor
 * (grant at ALL, no company of their own) names the importer, in the
 * body or as `?importerId=`. Anyone else gets null, which every caller
 * turns into "not linked to an importer".
 */
export function actingImporterId(actor: Actor, grant: Grant, wanted: unknown): number | null {
  const own = importerIdOf(actor);
  if (own !== null || grant.scope !== "ALL") return own;
  if (typeof wanted === "number") return Number.isInteger(wanted) && wanted > 0 ? wanted : null;
  if (typeof wanted === "string" && wanted !== "") return idFrom(wanted);
  return null;
}

/** The three things every inward route stamps on its audit rows. */
export function metaOf(request: NextRequest, requestId: string): Meta {
  return { requestId, ip: clientIp(request.headers), userAgent: request.headers.get("user-agent") };
}

export function idFrom(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** An InwardError is a response; anything else goes through the usual translation. */
export function respondError(error: unknown, requestId: string) {
  if (error instanceof InwardError) {
    return fail(error.kind, error.message, requestId, error.fields ? { fields: error.fields } : {});
  }
  return toResponse(error, requestId);
}

export async function jsonBody(request: NextRequest): Promise<unknown | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
