import MasterPage from "@/components/admin/MasterPage";
import type { RawSearchParams } from "@/lib/admin/listing";

export const dynamic = "force-dynamic";

/** The headings the public FAQ page groups under. Registry-driven like
 *  the other five master screens; the only thing here is the slug. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return <MasterPage slug="faq-categories" searchParams={await searchParams} />;
}
