import MasterPage from "@/components/admin/MasterPage";
import type { RawSearchParams } from "@/lib/admin/listing";

export const dynamic = "force-dynamic";

/**
 * Vehicles — one row per lorry.
 *
 * A vehicle has no site of its own either: it inherits its transporter's,
 * which is why the form asks for an owner and never for a warehouse, and
 * why the scope is two hops rather than one.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return <MasterPage slug="vehicles" searchParams={await searchParams} />;
}
