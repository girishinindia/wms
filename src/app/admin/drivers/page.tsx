import MasterPage from "@/components/admin/MasterPage";
import type { RawSearchParams } from "@/lib/admin/listing";

export const dynamic = "force-dynamic";

/**
 * Drivers — the third leg of the transport register.
 *
 * Like a vehicle, a driver belongs to a transporter and inherits its
 * sites, so the form asks for an owner and never for a warehouse.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return <MasterPage slug="drivers" searchParams={await searchParams} />;
}
