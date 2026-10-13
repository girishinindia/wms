import { insightsRoute } from "@/lib/insights/http";
import { filtersFrom } from "@/lib/insights/lens";
import { EXPORT_ROWS, fileName, runReport, toCsv, toPdf, toXlsx } from "@/lib/insights/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PDF_ROWS = 5_000;

/**
 * GET /api/v1/insights/reports/{key}?period=&from=&to=&warehouseId=&importerId=&status=&format=json|csv|xlsx|pdf
 * json: the first 500 rows, the count and the totals. csv / xlsx: up to 50,000 rows. pdf: up to 5,000.
 */
export const GET = insightsRoute(async ({ actor, request, params }) => {
  const sp = request.nextUrl.searchParams;
  const format = sp.get("format") ?? "json";
  const f = filtersFrom(sp);
  if (format === "json") return { report: await runReport(actor, params.key!, f) };
  const r = await runReport(actor, params.key!, f, format === "pdf" ? PDF_ROWS : EXPORT_ROWS);
  const file = (body: BodyInit, type: string, ext: string) =>
    new Response(body, {
      headers: {
        "content-type": type,
        "content-disposition": `attachment; filename="${fileName(r, ext)}"`,
        "cache-control": "no-store",
      },
    });
  if (format === "csv") return file(toCsv(r), "text/csv; charset=utf-8", "csv");
  if (format === "xlsx") return file((await toXlsx(r)) as unknown as BodyInit, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx");
  if (format === "pdf") return file((await toPdf(r)) as unknown as BodyInit, "application/pdf", "pdf");
  return { report: await runReport(actor, params.key!, f) };
});
