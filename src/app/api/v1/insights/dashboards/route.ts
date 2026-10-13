import { dashboardsFor } from "@/lib/insights/dashboards";
import { insightsRoute } from "@/lib/insights/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/insights/dashboards — the dashboards this person may open, in order. */
export const GET = insightsRoute(async ({ actor }) => ({ dashboards: dashboardsFor(actor) }));
