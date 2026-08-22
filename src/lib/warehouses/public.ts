import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { unstable_cache } from "next/cache";

import { getDb } from "@/db";

/**
 * The warehouse data the whole internet may read.
 *
 * This file is the boundary. Everything the public site renders comes
 * through here and nowhere else, and every column is written out by
 * hand — there is no `select *` and no spread of a row into a response.
 * That is the point: a column added to `wms.warehouse` next year is
 * private until somebody comes here and decides otherwise, rather than
 * appearing on a public page the day it ships.
 *
 * Withheld deliberately, and why:
 *
 *   notes                 free text one operator wrote for another.
 *                         Rent, a landlord dispute, who holds the keys.
 *   contact_mobile        a person's own phone. On an indexed page it is
 *   alternate_mobile      scraped within days, and it is personal data
 *                         under the DPDP Act. Visitors reach the right
 *                         person through the enquiry form instead.
 *   created_by/updated_by internal user ids
 *   deleted_by
 *   *_at timestamps       an edit history is a map of internal activity
 *   id                    URLs key on `code`, so no primary key is ever
 *                         handed out
 *   storage_key           the CDN URL is what a browser needs; the key
 *                         is what somebody would use to guess at the
 *                         objects either side of it
 *
 * No email address appears anywhere in this file. There is none on the
 * warehouse table, and none is joined in.
 */

/** Active, and not deleted. The only two states that make a site public.
 *
 *  `is_active` is the switch already on the admin form, so taking a
 *  warehouse off the website is the same gesture as taking it out of
 *  service — one place to look, not two that can disagree. */
const VISIBLE = sql`w.is_active = true and w.deleted_at is null`;

/** Everything cached here is dropped together when a warehouse changes. */
export const PUBLIC_WAREHOUSE_TAG = "public-warehouses";

/**
 * Cache the QUERY, not the page.
 *
 * `export const revalidate` on the pages is not enough and measuring
 * proved it: `/warehouses` reads `searchParams` for its city and type
 * filters, which makes the route dynamic, and a dynamic route ignores
 * `revalidate` — so every crawler hit was a database round trip, which
 * is the load this was supposed to prevent. Caching at this level works
 * whether the page above is static or dynamic, and does not make the
 * build depend on the database being reachable.
 *
 * Five minutes, or until `revalidateTag` is called on a save.
 */
const CACHE_SECONDS = 300;
const cached = <A extends unknown[], R>(key: string, fn: (...args: A) => Promise<R>) =>
  unstable_cache(fn, ["public-warehouse", key], {
    tags: [PUBLIC_WAREHOUSE_TAG],
    revalidate: CACHE_SECONDS,
  });

export type PublicWarehouseCard = {
  code: string;
  name: string;
  typeName: string | null;
  cityName: string | null;
  stateName: string | null;
  totalAreaSqft: number | null;
  dockCount: number | null;
  hasRacking: boolean;
  hasCctv: boolean;
  hasWeighbridge: boolean;
  /** First photo by sort order, or null. Used as the card's cover. */
  coverUrl: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
  photoCount: number;
};

export type PublicWarehousePhoto = {
  url: string;
  caption: string | null;
  width: number;
  height: number;
};

export type PublicWarehouse = PublicWarehouseCard & {
  address: string;
  landmark: string | null;
  area: string | null;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
  gmapUrl: string | null;
  usableAreaSqft: number | null;
  storageCapacityCbm: number | null;
  palletPositions: number | null;
  maxVehicleLengthFt: number | null;
  floorCount: number | null;
  /** Who to ask for. The name only — never a number. */
  contactPerson: string | null;
  photos: PublicWarehousePhoto[];
};

const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);
const str = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);

/** The columns a card needs, joined to its cover photo. */
const CARD_COLUMNS = sql`
  w.code, w.name,
  t.name as type_name,
  c.name as city_name,
  s.name as state_name,
  w.total_area_sqft, w.dock_count,
  w.has_racking, w.has_cctv, w.has_weighbridge,
  (select i.url    from wms.warehouse_image i where i.warehouse_id = w.id
    order by i.sort_order, i.id limit 1) as cover_url,
  (select i.width  from wms.warehouse_image i where i.warehouse_id = w.id
    order by i.sort_order, i.id limit 1) as cover_width,
  (select i.height from wms.warehouse_image i where i.warehouse_id = w.id
    order by i.sort_order, i.id limit 1) as cover_height,
  (select count(*) from wms.warehouse_image i where i.warehouse_id = w.id)::int as photo_count
`;

const toCard = (r: Record<string, unknown>): PublicWarehouseCard => ({
  code: String(r.code),
  name: String(r.name),
  typeName: str(r.type_name),
  cityName: str(r.city_name),
  stateName: str(r.state_name),
  totalAreaSqft: num(r.total_area_sqft),
  dockCount: num(r.dock_count),
  hasRacking: Boolean(r.has_racking),
  hasCctv: Boolean(r.has_cctv),
  hasWeighbridge: Boolean(r.has_weighbridge),
  coverUrl: str(r.cover_url),
  coverWidth: num(r.cover_width),
  coverHeight: num(r.cover_height),
  photoCount: Number(r.photo_count ?? 0),
});

/**
 * Every public site, optionally narrowed by city or type.
 *
 * The filters take NAMES, not ids, because they arrive from a link in
 * the address bar and a name is what a person can read there. They are
 * bound parameters either way — nothing from the URL is interpolated
 * into the SQL.
 */
const readList = async (
  filter: { city?: string; type?: string } = {},
): Promise<PublicWarehouseCard[]> => {
  const where: SQL[] = [VISIBLE];
  if (filter.city) where.push(sql`lower(c.name) = lower(${filter.city})`);
  if (filter.type) where.push(sql`lower(t.name) = lower(${filter.type})`);

  const rows = await getDb().execute<Record<string, unknown>>(sql`
    select ${CARD_COLUMNS}
      from wms.warehouse w
      left join wms.warehouse_type t on t.id = w.warehouse_type_id
      left join wms.city c on c.id = w.city_id
      left join wms.state s on s.id = c.state_id
     where ${sql.join(where, sql` and `)}
     order by c.name nulls last, w.name
  `);
  return rows.map(toCard);
};

/** The cities and types that actually have a public warehouse in them.
 *  Offering a filter that leads to an empty page is a broken page. */
const readFilterOptions = async (): Promise<{ cities: string[]; types: string[] }> => {
  const rows = await getDb().execute<{ city_name: string | null; type_name: string | null }>(sql`
    select distinct c.name as city_name, t.name as type_name
      from wms.warehouse w
      left join wms.warehouse_type t on t.id = w.warehouse_type_id
      left join wms.city c on c.id = w.city_id
     where ${VISIBLE}
  `);
  const cities = [...new Set(rows.map((r) => r.city_name).filter((v): v is string => Boolean(v)))];
  const types = [...new Set(rows.map((r) => r.type_name).filter((v): v is string => Boolean(v)))];
  return { cities: cities.sort(), types: types.sort() };
};

/**
 * One site, by its code — or null.
 *
 * Null covers all three of "no such code", "that one is switched off"
 * and "that one was deleted", and the page turns every one of them into
 * the same 404. Distinguishing them would confirm that a code exists,
 * which is not information a stranger needs.
 *
 * Matched case-insensitively so a code typed in lower case still finds
 * its page, and trimmed, because links get copied with spaces on them.
 */
const readOne = async (code: string): Promise<PublicWarehouse | null> => {
  const wanted = code.trim();
  if (wanted === "" || wanted.length > 40) return null;

  const rows = await getDb().execute<Record<string, unknown>>(sql`
    select ${CARD_COLUMNS},
           w.id,
           w.address, w.landmark, w.area, w.pincode::text as pincode,
           w.latitude, w.longitude, w.gmap_url,
           w.usable_area_sqft, w.storage_capacity_cbm, w.pallet_positions,
           w.max_vehicle_length_ft, w.floor_count,
           w.contact_person
      from wms.warehouse w
      left join wms.warehouse_type t on t.id = w.warehouse_type_id
      left join wms.city c on c.id = w.city_id
      left join wms.state s on s.id = c.state_id
     where ${VISIBLE} and lower(w.code) = lower(${wanted})
     limit 1
  `);
  const r = rows[0];
  if (!r) return null;

  const photos = await getDb().execute<Record<string, unknown>>(sql`
    select url, caption, width, height
      from wms.warehouse_image
     where warehouse_id = ${Number(r.id)}
     order by sort_order, id
  `);

  return {
    ...toCard(r),
    address: String(r.address ?? ""),
    landmark: str(r.landmark),
    area: str(r.area),
    pincode: String(r.pincode ?? ""),
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    /**
     * Restricted to http(s) at the form, and checked again here.
     * This value becomes an `href` on a page anyone can reach, and a
     * `javascript:` or `data:` URL that slipped in through some other
     * path would be a stored redirect with an audience.
     */
    gmapUrl: (() => {
      const v = str(r.gmap_url);
      return v && /^https?:\/\//i.test(v) ? v : null;
    })(),
    usableAreaSqft: num(r.usable_area_sqft),
    storageCapacityCbm: num(r.storage_capacity_cbm),
    palletPositions: num(r.pallet_positions),
    maxVehicleLengthFt: num(r.max_vehicle_length_ft),
    floorCount: num(r.floor_count),
    contactPerson: str(r.contact_person),
    photos: photos.map((p) => ({
      url: String(p.url),
      caption: str(p.caption),
      width: Number(p.width),
      height: Number(p.height),
    })),
  };
};

/** Every public code, for the sitemap and for prerendering. */
const readCodes = async (): Promise<string[]> => {
  const rows = await getDb().execute<{ code: string }>(sql`
    select w.code from wms.warehouse w where ${VISIBLE} order by w.code
  `);
  return rows.map((r) => r.code);
};

/**
 * The public reads, cached.
 *
 * These four are the only exports the pages use. The uncached readers
 * above stay private so there is no accidental path around the cache —
 * and no second place where the column list could drift.
 */
export const listPublicWarehouses = cached("list", readList);
export const publicFilterOptions = cached("filters", readFilterOptions);
export const getPublicWarehouse = cached("one", readOne);
export const publicWarehouseCodes = cached("codes", readCodes);
