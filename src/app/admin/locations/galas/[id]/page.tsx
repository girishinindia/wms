import { notFound } from "next/navigation";

import CartonBrowser from "@/components/admin/storage/CartonBrowser";
import { Denied } from "@/components/admin/ui";
import { pageGuard } from "@/lib/auth/guard";
import { InwardError } from "@/lib/inward/ops";
import { storedCartons } from "@/lib/storage/cartons";

export const dynamic = "force-dynamic";

/** /admin/locations/galas/{id} — what is in one gala: by item, then every carton; previous / next gala. */
export default async function GalaPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await pageGuard("storage.goods.update");
  if (!guard.ok || guard.grant.scope === "OWN") return <Denied what="galas" />;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  try {
    return <CartonBrowser initial={await storedCartons(guard.actor, { galaId: id })} />;
  } catch (error) {
    if (error instanceof InwardError) notFound();
    throw error;
  }
}
