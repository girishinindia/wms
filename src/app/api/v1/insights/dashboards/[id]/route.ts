import { loadDashboard } from "@/lib/insights/dashboards";
import { insightsRoute } from "@/lib/insights/http";
import { filtersFrom } from "@/lib/insights/lens";
import type { DashboardId } from "@/lib/insights/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/insights/dashboards/{id}?period=today|7d|30d|90d|month|fy|custom&from=&to=&warehouseId=&importerId=
 * — tiles, charts and lists, counted over what the caller may see.
 */
export const GET = insightsRoute(async ({ actor, request, params }) => ({
  dashboard: await loadDashboard(actor, params.id as DashboardId, filtersFrom(request.nextUrl.searchParams)),
}));
