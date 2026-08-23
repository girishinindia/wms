import MasterPage from "@/components/admin/MasterPage";
import type { RawSearchParams } from "@/lib/admin/listing";

export const dynamic = "force-dynamic";

/**
 * Expense categories — master data, under the Master menu.
 *
 * Only a super admin may change them; the three roles that record
 * expenses hold `.read` so the picker on the Expenses screen is not
 * empty for them.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return <MasterPage slug="expense-categories" searchParams={await searchParams} />;
}
