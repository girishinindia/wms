import { sql, type SQL } from "drizzle-orm";

import WarehousesTable, { type WarehouseRow } from "@/components/admin/WarehousesTable";
import { Denied, PageHeader } from "@/components/admin/ui";
import { getDb } from "@/db";
import { finishList, likePattern, parseListQuery, type RawSearchParams } from "@/lib/admin/listing";
import { pageGuard } from "@/lib/auth/guard";
import { isPlatformWarehouseAdmin } from "@/lib/warehouses/guard";

export const dynamic = "force-dynamic";

const selectClass =
  "rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-1.5 pr-7 text-sm text-verdigris-50 focus:outline-none focus:ring-2 focus:ring-patina/40";

/**
 * The warehouse list.
 *
 * Search, filters, sort and page all live in the URL and are applied by
 * the database — the same `parseListQuery` / `finishList` pair the five
 * master screens use, so the chrome behaves identically. The shape does
 * not: a master row is a code, a name and a switch, and a warehouse is
 * thirty-three columns, so it has its own table and drawer rather than
 * being bent into the registry.
 */
export default async function WarehousesPage({
  searchParams,
}: {
  searchParams?: Promise<RawSearchParams>;
}) {
  const guard = await pageGuard("warehouse.read");
  if (!guard.ok) return <Denied what="warehouses" />;
  /**
   * `warehouse.read` is held by seven roles at WAREHOUSE scope — every
   * manager on the floor. Only a super admin holds it at ALL, and this
   * area is theirs; the sidebar hides the link, and this is the part
   * that refuses.
   */
  if (!isPlatformWarehouseAdmin(guard.actor)) return <Denied what="warehouses" />;

  const query = parseListQuery((await searchParams) ?? {}, {
    sortable: ["code", "name", "type", "city", "totalAreaSqft", "status"],
    defaultSort: "name",
    extraKeys: ["type", "city"],
  });

  const orderColumn = (() => {
    switch (query.sort) {
      case "code":
        return sql`w.code`;
      case "type":
        return sql`t.name`;
      case "city":
        return sql`c.name`;
      case "totalAreaSqft":
        return sql`w.total_area_sqft`;
      case "status":
        return sql`w.is_active`;
      default:
        return sql`w.name`;
    }
  })();
  const direction = query.dir === "desc" ? sql`desc` : sql`asc`;

  const conditions: SQL[] = [sql`w.deleted_at is null`];
  if (query.status === "active") conditions.push(sql`w.is_active`);
  if (query.status === "inactive") conditions.push(sql`not w.is_active`);

  const typeFilter = Number.parseInt(query.extra.type ?? "", 10);
  if (Number.isFinite(typeFilter)) conditions.push(sql`w.warehouse_type_id = ${typeFilter}`);
  const cityFilter = Number.parseInt(query.extra.city ?? "", 10);
  if (Number.isFinite(cityFilter)) conditions.push(sql`w.city_id = ${cityFilter}`);

  if (query.q) {
    const like = likePattern(query.q);
    conditions.push(sql`(
      w.code ilike ${like} or w.name ilike ${like} or w.address ilike ${like}
      or w.pincode::text ilike ${like} or coalesce(w.contact_person, '') ilike ${like}
      or coalesce(w.contact_mobile::text, '') ilike ${like}
      or c.name ilike ${like} or t.name ilike ${like}
    )`);
  }

  const fromClause = sql`
      from wms.warehouse w
      left join wms.warehouse_type t on t.id = w.warehouse_type_id
      left join wms.city c on c.id = w.city_id
      left join wms.state s on s.id = c.state_id
     where ${sql.join(conditions, sql` and `)}`;

  // Sequential, never Promise.all — see src/db/index.ts on the pooler.
  const [{ total }] = await getDb().execute<{ total: number }>(
    sql`select count(*)::int as total ${fromClause}`,
  );
  const list = finishList(query, total, ["code", "name", "type", "city", "totalAreaSqft", "status"]);
  const offset = (list.page - 1) * list.size;

  const rows = await getDb().execute<Record<string, unknown>>(sql`
    select w.id, w.code, w.name, w.is_active, w.warehouse_type_id, t.name as type_name,
           w.address, w.landmark, w.area, w.city_id, c.name as city_name, s.name as state_name,
           s.id as state_id, s.country_id, w.pincode::text as pincode,
           w.latitude, w.longitude, w.gmap_url,
           w.total_area_sqft, w.usable_area_sqft, w.storage_capacity_cbm,
           w.pallet_positions, w.dock_count, w.max_vehicle_length_ft, w.floor_count,
           w.has_racking, w.has_cctv, w.has_weighbridge,
           w.contact_person, w.contact_mobile::text as contact_mobile,
           w.alternate_mobile::text as alternate_mobile, w.notes,
           (select count(*) from wms.warehouse_image i where i.warehouse_id = w.id)::int as photos,
           (select count(*) from wms.user_role_assignment ura
             where ura.warehouse_id = w.id and ura.revoked_at is null)::int as staff,
           (select count(*) from wms.warehouse_transporter wt
             where wt.warehouse_id = w.id and wt.deleted_at is null)::int as transporters
      ${fromClause}
     order by ${orderColumn} ${direction} nulls last, w.id
     limit ${list.size} offset ${offset}
  `);

  const types = await getDb().execute<{ id: number; name: string }>(sql`
    select id, name from wms.warehouse_type where is_active and deleted_at is null order by name
  `);
  const cities = await getDb().execute<{ id: number; name: string; state_id: number; state_name: string; country_id: number }>(sql`
    select c.id, c.name, c.state_id, s.name as state_name, s.country_id
      from wms.city c join wms.state s on s.id = c.state_id
     where c.is_active and c.deleted_at is null order by s.name, c.name
  `);

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

  const data: WarehouseRow[] = rows.map((r) => ({
    id: Number(r.id),
    code: String(r.code),
    name: String(r.name),
    isActive: Boolean(r.is_active),
    typeName: str(r.type_name),
    cityLabel: r.city_name ? `${String(r.city_name)}${r.state_name ? `, ${String(r.state_name)}` : ""}` : null,
    totalAreaSqft: num(r.total_area_sqft),
    photos: Number(r.photos ?? 0),
    inUse: [
      Number(r.staff ?? 0) > 0 ? `${r.staff} staff` : "",
      Number(r.transporters ?? 0) > 0 ? `${r.transporters} transporters` : "",
    ]
      .filter(Boolean)
      .join(", "),
    edit: {
      name: String(r.name),
      warehouseTypeId: str(r.warehouse_type_id) ?? "",
      address: str(r.address) ?? "",
      landmark: str(r.landmark) ?? "",
      area: str(r.area) ?? "",
      cityId: str(r.city_id) ?? "",
      pincode: str(r.pincode) ?? "",
      latitude: str(r.latitude) ?? "",
      longitude: str(r.longitude) ?? "",
      gmapUrl: str(r.gmap_url) ?? "",
      totalAreaSqft: str(r.total_area_sqft) ?? "",
      usableAreaSqft: str(r.usable_area_sqft) ?? "",
      storageCapacityCbm: str(r.storage_capacity_cbm) ?? "",
      palletPositions: str(r.pallet_positions) ?? "",
      dockCount: str(r.dock_count) ?? "",
      maxVehicleLengthFt: str(r.max_vehicle_length_ft) ?? "",
      floorCount: str(r.floor_count) ?? "",
      contactPerson: str(r.contact_person) ?? "",
      contactMobile: str(r.contact_mobile) ?? "",
      alternateMobile: str(r.alternate_mobile) ?? "",
      notes: str(r.notes) ?? "",
    },
    flags: {
      hasRacking: Boolean(r.has_racking),
      hasCctv: Boolean(r.has_cctv),
      hasWeighbridge: Boolean(r.has_weighbridge),
    },
    countryId: str(r.country_id) ?? "",
    stateId: str(r.state_id) ?? "",
  }));

  const filters = (
    <>
      <select name="type" defaultValue={query.extra.type ?? ""} aria-label="Warehouse type" className={selectClass}>
        <option value="" className="bg-ink-850">All types</option>
        {types.map((t) => (
          <option key={t.id} value={t.id} className="bg-ink-850">{t.name}</option>
        ))}
      </select>
      <select name="city" defaultValue={query.extra.city ?? ""} aria-label="City" className={selectClass}>
        <option value="" className="bg-ink-850">All cities</option>
        {cities.map((c) => (
          <option key={c.id} value={c.id} className="bg-ink-850">{c.name}, {c.state_name}</option>
        ))}
      </select>
    </>
  );

  return (
    <>
      <PageHeader
        title="Warehouses"
        subtitle="Every site the platform operates. Staff are posted to these, and dispatches are planned against their capacity."
      />
      <WarehousesTable
        rows={data}
        list={list}
        base="/admin/warehouses"
        filters={filters}
        types={types.map((t) => ({ id: Number(t.id), name: t.name }))}
        cities={cities.map((c) => ({
          id: Number(c.id),
          name: c.name,
          stateId: Number(c.state_id),
          stateName: c.state_name,
          countryId: Number(c.country_id),
        }))}
      />
    </>
  );
}
