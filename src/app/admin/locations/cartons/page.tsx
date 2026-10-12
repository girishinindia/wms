import Link from "next/link";
import { notFound } from "next/navigation";

import CartonBrowser from "@/components/admin/storage/CartonBrowser";
import { Card, Denied, PageHeader } from "@/components/admin/ui";
import { pageGuard } from "@/lib/auth/guard";
import { InwardError } from "@/lib/inward/ops";
import { storedCartons } from "@/lib/storage/cartons";
import { storageWarehouses } from "@/lib/storage/locations";

export const dynamic = "force-dynamic";

/** /admin/locations/cartons?warehouse= — every stored carton of a warehouse in one searchable list. */
export default async function WarehouseCartonsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await pageGuard("storage.goods.update");
  if (!guard.ok || guard.grant.scope === "OWN") return <Denied what="stored cartons" />;
  const warehouses = await storageWarehouses(guard.actor);
  const wanted = Number((await searchParams).warehouse);
  const pick = warehouses.find((w) => w.id === wanted) ?? (warehouses.length === 1 ? warehouses[0] : undefined);
  if (!pick) {
    return (
      <>
        <PageHeader title="All stored cartons" subtitle="Choose a warehouse." />
        <Card className="p-5">
          <ul className="space-y-2 text-sm" id="carton-warehouses">
            {warehouses.map((w) => (
              <li key={w.id}>
                <Link href={`/admin/locations/cartons?warehouse=${w.id}`} className="text-verdigris-100 hover:text-patina">
                  {w.name}
                </Link>
              </li>
            ))}
            {warehouses.length === 0 ? <li className="text-verdigris-200/60">You are not linked to a warehouse yet.</li> : null}
          </ul>
        </Card>
      </>
    );
  }
  try {
    return <CartonBrowser initial={await storedCartons(guard.actor, { warehouseId: pick.id })} />;
  } catch (error) {
    if (error instanceof InwardError) notFound();
    throw error;
  }
}
