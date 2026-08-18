import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";

/**
 * Country → state → city, for the pickers on the importer profile and
 * sales-agent forms. Active rows only. Three sequential queries — see
 * src/db/index.ts on why never Promise.all.
 */
export type GeoOptions = {
  countries: { id: number; name: string }[];
  states: { id: number; name: string; countryId: number }[];
  cities: { id: number; name: string; stateId: number }[];
};

export async function loadGeoOptions(): Promise<GeoOptions> {
  const db = getDb();
  const countries = await db.execute<{ id: number; name: string }>(sql`
    select id, name from wms.country where is_active and deleted_at is null order by name
  `);
  const states = await db.execute<{ id: number; name: string; country_id: number }>(sql`
    select id, name, country_id from wms.state where is_active and deleted_at is null order by name
  `);
  const cities = await db.execute<{ id: number; name: string; state_id: number }>(sql`
    select id, name, state_id from wms.city where is_active and deleted_at is null order by name
  `);
  return {
    countries: countries.map((r) => ({ id: Number(r.id), name: r.name })),
    states: states.map((r) => ({ id: Number(r.id), name: r.name, countryId: Number(r.country_id) })),
    cities: cities.map((r) => ({ id: Number(r.id), name: r.name, stateId: Number(r.state_id) })),
  };
}
