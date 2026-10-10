import LocationsScreen from "@/components/admin/LocationsScreen";
import { Denied, PageHeader } from "@/components/admin/ui";
import { pageGuard } from "@/lib/auth/guard";
import { layout, storageWarehouses } from "@/lib/storage/locations";

export const dynamic = "force-dynamic";

/**
 * /admin/locations — floors and galas of a warehouse, and their QR labels.
 * Super admin, warehouse admin, storage manager.
 */
export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = await pageGuard("storage.goods.update");
  if (!guard.ok || guard.grant.scope === "OWN") return <Denied what="floors and galas" />;
  const warehouses = await storageWarehouses(guard.actor);
  const wanted = Number((await searchParams).warehouse);
  const pick = warehouses.find((w) => w.id === wanted) ?? (warehouses.length === 1 ? warehouses[0] : undefined);
  const initial = pick ? await layout(guard.actor, pick.id) : null;
  return (
    <>
      <PageHeader title="Floors and galas" subtitle="Every warehouse is floors, and galas on each floor. Each gala has a QR label." />
      <LocationsScreen warehouses={warehouses} initial={initial} />
    </>
  );
}
