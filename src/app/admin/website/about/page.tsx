import MasterPage from "@/components/admin/MasterPage";
import type { RawSearchParams } from "@/lib/admin/listing";

export const dynamic = "force-dynamic";

/**
 * About page — the sections of the public `/about` page.
 *
 * Under Setup → Website, beside Reviews and FAQs. The registry entry
 * (`about`, permission `site_about`) gives it the same table, drawer,
 * search and paging as the master screens; saving revalidates the
 * public page's cache tag.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return <MasterPage slug="about" searchParams={await searchParams} />;
}
