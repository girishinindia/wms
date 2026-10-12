import type { NextRequest } from "next/server";

import { handler, ok } from "@/lib/api/respond";
import { requireActor } from "@/lib/auth/guard";
import { respondError } from "@/lib/inward/http";
import { quickFind } from "@/lib/search/quick-find";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/find?q= — quick find: note, carton, gala, inward, item. Only what this person may already see. */
export const GET = (request: NextRequest) =>
  handler(async ({ requestId }) => {
    try {
      const actor = await requireActor();
      return ok({ hits: await quickFind(actor, request.nextUrl.searchParams.get("q") ?? "") }, requestId);
    } catch (error) {
      return respondError(error, requestId);
    }
  })();
