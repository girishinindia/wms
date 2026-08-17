import CityManager, { type CityRow, type StateRow } from "@/components/admin/CityManager";
import { Denied, PageHeader } from "@/components/admin/ui";
import { getDb } from "@/db";
import { grantFor, pageGuard } from "@/lib/auth/guard";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Cities.
 *
 * First screen in the panel for a reason that has nothing to do with how
 * interesting it is: `wms.city` ships empty, and `warehouse`,
 * `importer`, `importer_client` and `transporter` all carry a non-null
 * foreign key to it. Until there is a row here, a pending importer
 * cannot be approved — the `importer_complete_before_active` check
 * refuses to let the record leave PENDING without a `city_id`.
 */
export default async function CitiesPage() {
  const guard = await pageGuard("master.city.read");
  if (!guard.ok) return <Denied what="master data" />;

  const [states, cities] = await Promise.all([
    getDb().execute<{ id: number; name: string; code: string }>(sql`
      select id, name, code
        from wms.state
       where is_active and deleted_at is null
       order by name
    `),
    getDb().execute<{
      id: number;
      name: string;
      is_active: boolean;
      state_id: number;
      state_name: string;
    }>(sql`
      select c.id, c.name, c.is_active, c.state_id, s.name as state_name
        from wms.city c
        join wms.state s on s.id = c.state_id
       where c.deleted_at is null
       order by s.name, c.name
    `),
  ]);

  const stateRows: StateRow[] = states.map((s) => ({ id: s.id, name: s.name, code: s.code }));
  const cityRows: CityRow[] = cities.map((c) => ({
    id: c.id,
    name: c.name,
    isActive: c.is_active,
    stateId: c.state_id,
    stateName: c.state_name,
  }));

  return (
    <>
      <PageHeader
        title="Cities"
        subtitle="Addresses on importers, warehouses and transporters all resolve to this list."
      />
      <CityManager
        states={stateRows}
        cities={cityRows}
        canCreate={grantFor(guard.actor, "master.city.create") !== null}
        canUpdate={grantFor(guard.actor, "master.city.update") !== null}
      />
    </>
  );
}
