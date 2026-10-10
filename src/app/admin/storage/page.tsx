import StoreStation from "@/components/admin/StoreStation";
import { Denied, PageHeader } from "@/components/admin/ui";
import { pageGuard } from "@/lib/auth/guard";
import { layout, storageWarehouses } from "@/lib/storage/locations";
import { recentStores, waitingToStore } from "@/lib/storage/store";

export const dynamic = "force-dynamic";

/**
 * /admin/storage — store received cartons into galas: scan the gala, then
 * the cartons. Super admin, warehouse admin, storage manager.
 */
export default async function StoragePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = await pageGuard("storage.goods.update");
  if (!guard.ok || guard.grant.scope === "OWN") return <Denied what="storing cartons" />;
  const warehouses = await storageWarehouses(guard.actor);
  const wanted = Number((await searchParams).warehouse);
  const pick = warehouses.find((w) => w.id === wanted) ?? (warehouses.length === 1 ? warehouses[0] : undefined);
  const [initial, waiting, recent] = pick
    ? await Promise.all([layout(guard.actor, pick.id), waitingToStore(guard.actor, pick.id), recentStores(guard.actor, pick.id)])
    : [null, [], []];
  return (
    <>
      <PageHeader title="Store cartons" subtitle="Scan the gala's QR, then each carton. The gala stays chosen until you scan another." />
      <StoreStation warehouses={warehouses} initial={initial} initialWaiting={waiting} initialRecent={recent} />
    </>
  );
}
