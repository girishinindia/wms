import ReportCatalog from "@/components/admin/reports/ReportCatalog";
import { Denied, PageHeader } from "@/components/admin/ui";
import { currentActor } from "@/lib/auth/guard";
import { catalogFor } from "@/lib/insights/reports";

export const dynamic = "force-dynamic";

/** /admin/reports — every report this person may open, grouped, searchable, with favourites. */
export default async function ReportsPage() {
  const actor = await currentActor();
  if (!actor) return <Denied what="reports" />;
  const reports = catalogFor(actor);
  return (
    <>
      <PageHeader title="Reports" subtitle="Pick a report, set the period and filters, then download it as Excel, CSV or PDF." />
      <ReportCatalog reports={reports} />
    </>
  );
}
