import Link from "next/link";

import ReportView from "@/components/admin/reports/ReportView";
import { Denied, PageHeader } from "@/components/admin/ui";
import { currentActor } from "@/lib/auth/guard";
import { filtersFrom } from "@/lib/insights/lens";
import { runReport } from "@/lib/insights/reports";

export const dynamic = "force-dynamic";

/** /admin/reports/{key} — one report: filters, preview with totals, downloads. */
export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await currentActor();
  if (!actor) return <Denied what="reports" />;
  const { key } = await params;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") sp.set(k, v);
  let report;
  try {
    report = await runReport(actor, key, filtersFrom(sp));
  } catch {
    return <Denied what="this report" />;
  }
  return (
    <>
      <Link href="/admin/reports" className="mb-3 inline-flex text-sm text-verdigris-300 hover:text-patina" id="report-back">
        ← Reports
      </Link>
      <PageHeader title={`${report.meta.no} · ${report.meta.title}`} subtitle={report.meta.description} />
      <ReportView initial={report} />
    </>
  );
}
