import CityManager, { type CityRow, type StateRow } from "@/components/admin/CityManager";
import { Denied, PageHeader } from "@/components/admin/ui";
import { getDb } from "@/db";
import {
  finishList,
  likePattern,
  parseListQuery,
  type RawSearchParams,
} from "@/lib/admin/listing";
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
 *
 * Search, the state filter, sort and paging live in the URL and are
 * applied by the database. The list was once fetched whole and filtered
 * in the browser, which is fine for forty rows and not for the several
 * hundred a real deployment carries.
 */
const SORTABLE = ["city", "state", "status"] as const;

export default async function CitiesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const guard = await pageGuard("master.city.read");
  if (!guard.ok) return <Denied what="master data" />;

  const query = parseListQuery(await searchParams, {
    sortable: SORTABLE,
    defaultSort: "state",
    extraKeys: ["state"],
  });
  const stateFilter = Number.parseInt(query.extra.state ?? "", 10);

  const where = sql.join(
    [
      sql`c.deleted_at is null`,
      ...(query.status === "active" ? [sql`c.is_active`] : []),
      ...(query.status === "inactive" ? [sql`not c.is_active`] : []),
      ...(Number.isFinite(stateFilter) ? [sql`c.state_id = ${stateFilter}`] : []),
      ...(query.q
        ? [sql`(c.name ilike ${likePattern(query.q)} or s.name ilike ${likePattern(query.q)})`]
        : []),
    ],
    sql` and `,
  );
  const orderBy =
    query.sort === "city"
      ? sql`c.name`
      : query.sort === "status"
        ? sql`c.is_active`
        : sql`s.name`;
  const direction = query.dir === "desc" ? sql`desc` : sql`asc`;

  const [states, [{ total }]] = await Promise.all([
    getDb().execute<{ id: number; name: string; code: string }>(sql`
      select id, name, code
        from wms.state
       where is_active and deleted_at is null
       order by name
    `),
    getDb().execute<{ total: number }>(sql`
      select count(*)::int as total
        from wms.city c
        join wms.state s on s.id = c.state_id
       where ${where}
    `),
  ]);
  const list = finishList(query, total, SORTABLE);

  const cities = await getDb().execute<{
    id: number;
    name: string;
    is_active: boolean;
    state_id: number;
    state_name: string;
  }>(sql`
    select c.id, c.name, c.is_active, c.state_id, s.name as state_name
      from wms.city c
      join wms.state s on s.id = c.state_id
     where ${where}
     order by ${orderBy} ${direction}, c.name, c.id
     limit ${list.size} offset ${(list.page - 1) * list.size}
  `);

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
        list={list}
        canCreate={grantFor(guard.actor, "master.city.create") !== null}
        canUpdate={grantFor(guard.actor, "master.city.update") !== null}
      />
    </>
  );
}
