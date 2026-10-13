import { insightsRoute } from "@/lib/insights/http";
import { catalogFor } from "@/lib/insights/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/insights/reports — the reports this person may open, in catalogue order. */
export const GET = insightsRoute(async ({ actor }) => ({ reports: catalogFor(actor) }));
