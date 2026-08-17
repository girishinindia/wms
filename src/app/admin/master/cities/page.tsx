import CityBulkAdd from "@/components/admin/CityBulkAdd";
import MasterPage from "@/components/admin/MasterPage";
import { getDb } from "@/db";
import type { RawSearchParams } from "@/lib/admin/listing";
import { grantFor, pageGuard } from "@/lib/auth/guard";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Cities: the same registry-driven table as the other four master
 * screens, plus one thing the others do not need — a bulk paste. A
 * state's cities arrive as a pasted column, never one at a time, and a
 * form with one input turns a two-minute job into forty clicks.
 */
export default async function CitiesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const guard = await pageGuard("master.city.read");
  const canCreate = guard.ok && grantFor(guard.actor, "master.city.create") !== null;

  const states = canCreate
    ? await getDb().execute<{ id: number; name: string; code: string }>(sql`
        select id, name, code from wms.state
         where is_active and deleted_at is null
         order by name
      `)
    : [];

  return (
    <div className="space-y-6">
      <MasterPage slug="cities" searchParams={await searchParams} />
      {canCreate ? <CityBulkAdd states={states.map((s) => ({ id: s.id, name: s.name, code: s.code }))} /> : null}
    </div>
  );
}
