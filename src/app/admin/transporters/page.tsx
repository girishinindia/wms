import MasterPage from "@/components/admin/MasterPage";
import type { RawSearchParams } from "@/lib/admin/listing";

export const dynamic = "force-dynamic";

/**
 * Transporters — the carrier register.
 *
 * Reference records, not logins: nobody signs in as a transporter. What
 * makes this screen different from every other one on the same
 * machinery is that a carrier has no warehouse column at all — it serves
 * a SET of sites through `warehouse_transporter`, and that set is both
 * what the drawer edits and what decides who can see the row.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return <MasterPage slug="transporters" searchParams={await searchParams} />;
}
