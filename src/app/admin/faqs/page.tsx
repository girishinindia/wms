import MasterPage from "@/components/admin/MasterPage";
import type { RawSearchParams } from "@/lib/admin/listing";

export const dynamic = "force-dynamic";

/**
 * FAQs — a menu of its own, on the master machinery.
 *
 * The URL is `/admin/faqs` rather than `/admin/master/faqs` because
 * this is a top-level section, not master data an operator fills in
 * once. Nothing else differs: the registry entry gives it the same
 * table, drawer, search, filters, sort and paging as the master
 * screens, and the same generic API handler serves its writes.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return <MasterPage slug="faqs" searchParams={await searchParams} />;
}
