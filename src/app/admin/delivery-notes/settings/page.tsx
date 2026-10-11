import SeriesForm from "@/components/admin/delivery/SeriesForm";
import { Denied, PageHeader } from "@/components/admin/ui";
import { pageGuard } from "@/lib/auth/guard";
import { getSeries } from "@/lib/delivery/ops";
import { InwardError } from "@/lib/inward/ops";

export const dynamic = "force-dynamic";

/** /admin/delivery-notes/settings — the importer's numbering, so it continues their own series. */
export default async function SeriesPage() {
  const guard = await pageGuard("dispatch.order.approve");
  if (!guard.ok) return <Denied what="delivery note numbering" />;
  let series;
  try {
    series = await getSeries(guard.actor);
  } catch (error) {
    if (error instanceof InwardError) return <Denied what="delivery note numbering" />;
    throw error;
  }
  return (
    <>
      <PageHeader title="Delivery note numbering" subtitle="Continue your own series — e.g. the next number in Tally." />
      <SeriesForm initial={series} />
    </>
  );
}
