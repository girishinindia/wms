import MasterPage from "@/components/admin/MasterPage";
import type { RawSearchParams } from "@/lib/admin/listing";

export const dynamic = "force-dynamic";

/**
 * Expenses — a menu of its own, on the master machinery.
 *
 * `/admin/expenses` rather than `/admin/master/expenses`, for the same
 * reason FAQs sits outside Master: this is a top-level section people
 * work in daily, not a list somebody fills in once.
 *
 * It is the first screen where the rows a person sees depend on who
 * they are. The registry's `scope` does that: a super admin sees every
 * site, a warehouse admin or expense manager only the sites they are
 * assigned to, and the same test is applied again by the write route.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return <MasterPage slug="expenses" searchParams={await searchParams} />;
}
