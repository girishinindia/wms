import { sql } from "drizzle-orm";

import GalleryGrid, { type GalleryImage } from "@/components/admin/GalleryGrid";
import { Card, Denied, Empty, PageHeader } from "@/components/admin/ui";
import { getDb } from "@/db";
import { pageGuard } from "@/lib/auth/guard";
import { isPlatformWarehouseAdmin } from "@/lib/warehouses/guard";
import { listWarehouseImages, publicImage } from "@/lib/warehouses/ops";

export const dynamic = "force-dynamic";

/**
 * The gallery, one warehouse at a time.
 *
 * A photograph of a warehouse only means anything next to the warehouse
 * it is of, so there is no "all photos" view: the picker chooses a site
 * and everything below belongs to it. The chosen id lives in the URL, so
 * a link to a particular gallery is a link somebody can send.
 */
export default async function WarehouseGalleryPage({
  searchParams,
}: {
  searchParams?: Promise<{ warehouse?: string }>;
}) {
  const guard = await pageGuard("warehouse.read");
  if (!guard.ok) return <Denied what="warehouse galleries" />;
  if (!isPlatformWarehouseAdmin(guard.actor)) return <Denied what="warehouse galleries" />;

  const warehouses = await getDb().execute<{ id: number; code: string; name: string; photos: number }>(sql`
    select w.id, w.code, w.name,
           (select count(*) from wms.warehouse_image i where i.warehouse_id = w.id)::int as photos
      from wms.warehouse w
     where w.deleted_at is null
     order by w.name
  `);

  if (warehouses.length === 0) {
    return (
      <>
        <PageHeader title="Gallery" subtitle="Photographs of each site." />
        <Card>
          <Empty
            title="No warehouses yet."
            hint="Add a warehouse first — a gallery belongs to a site, so there is nowhere to put a photo until one exists."
          />
        </Card>
      </>
    );
  }

  const asked = Number((await searchParams)?.warehouse ?? "");
  const chosen =
    warehouses.find((w) => Number(w.id) === asked) ?? warehouses[0]!;

  const data: GalleryImage[] = (await listWarehouseImages(Number(chosen.id))).map(publicImage);

  return (
    <>
      <PageHeader
        title="Gallery"
        subtitle="Photographs of each site. Every warehouse keeps its own."
      />
      <GalleryGrid
        warehouseId={Number(chosen.id)}
        warehouseName={`${chosen.code} · ${chosen.name}`}
        images={data}
        warehouses={warehouses.map((w) => ({
          id: Number(w.id),
          label: `${w.code} · ${w.name}`,
          photos: Number(w.photos ?? 0),
        }))}
      />
    </>
  );
}
