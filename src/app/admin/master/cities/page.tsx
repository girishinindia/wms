import MasterPage from "@/components/admin/MasterPage";
import type { RawSearchParams } from "@/lib/admin/listing";

export const dynamic = "force-dynamic";

/**
 * Cities: the same registry-driven table as the other four master
 * screens. The one difference — many cities arrive as a pasted column,
 * not one at a time — lives in the registry (`bulkCreate`) and shows up
 * as a textarea in the Add drawer, so there is one way in, not two.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return <MasterPage slug="cities" searchParams={await searchParams} />;
}
