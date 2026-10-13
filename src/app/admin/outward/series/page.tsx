import DoSeriesForm from "@/components/admin/outward/DoSeriesForm";
import { Denied, PageHeader } from "@/components/admin/ui";
import { pageGuard } from "@/lib/auth/guard";
import { getSeries } from "@/lib/outward/ops";

export const dynamic = "force-dynamic";

/** /admin/outward/series — the company's Dispatch Order numbers (super admin). */
export default async function DoSeriesPage() {
  const guard = await pageGuard("outward.series.update");
  if (!guard.ok || guard.grant.scope !== "ALL") return <Denied what="dispatch order numbering" />;
  return (
    <>
      <PageHeader title="Dispatch order numbering" subtitle="The company's series, as in Tally — e.g. DO/2026-27/000001." />
      <DoSeriesForm initial={await getSeries()} />
    </>
  );
}
