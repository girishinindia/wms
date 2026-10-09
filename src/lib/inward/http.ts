import "server-only";

import type { NextRequest } from "next/server";

import { fail, toResponse } from "@/lib/api/respond";
import { clientIp } from "@/lib/auth/ratelimit";
import { InwardError, type Meta } from "@/lib/inward/ops";

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
