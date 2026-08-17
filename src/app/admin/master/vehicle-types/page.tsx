import MasterPage from "@/components/admin/MasterPage";
import type { RawSearchParams } from "@/lib/admin/listing";

export const dynamic = "force-dynamic";

/** Everything about this screen is data in `master-registry.ts`; the
 *  search, sort and page state lives in the URL. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return <MasterPage slug="vehicle-types" searchParams={await searchParams} />;
}
