import { type NextRequest } from "next/server";

import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import {
  DEFAULT_PERIOD,
  isPeriod,
  readAuditPage,
  type PeriodKey,
} from "@/lib/audit/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/admin/audit — the log's list, for a native client.
 *
 * Same loader the web page renders through (`readAuditPage`), so the
 * window rule, the facet filters, and the free-text search — which
 * deliberately never touches `before`/`after`, or the row count becomes
 * a yes/no oracle for fishing phone numbers — are all one
 * implementation.
 *
 * `audit_log.read` at ALL, exactly as the sidebar gates the screen: the
 * log is where every actor's traces mix, and a scoped read of it is not
 * a thing this system sells.
 */
export async function GET(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { grant } = await requirePermission("audit_log.read", {
        entityType: "audit_log",
      });
      if (grant.scope !== "ALL") {
        return fail("FORBIDDEN", "The audit log is platform-level only.", requestId);
      }

      const params = request.nextUrl.searchParams;
      const rawPeriod = params.get("period") ?? DEFAULT_PERIOD;
      const period: PeriodKey = isPeriod(rawPeriod) ? rawPeriod : DEFAULT_PERIOD;

      const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
      const { rows, list } = await readAuditPage(
        {
          q: (params.get("q") ?? "").trim(),
          status: "all",
          sort: "occurredAt",
          dir: "desc",
          page,
          size: 50,
          extra: {
            action: params.get("action") ?? "",
            entity: params.get("entity") ?? "",
            result: params.get("result") ?? "",
            actor: params.get("actor") ?? "",
          },
        },
        period,
      );

      return ok(
        { rows, total: list.total, page: list.page, pages: list.pages },
        requestId,
      );
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
