import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { getDb } from "@/db";
import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { clientIp } from "@/lib/auth/ratelimit";
import { isUniqueViolation } from "@/lib/db-errors";
import { createWarehouse, WarehouseError } from "@/lib/warehouses/ops";
import { requirePlatformWarehouse } from "@/lib/warehouses/guard";
import { createWarehouseSchema } from "@/lib/validation/api-warehouse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/admin/warehouses — the sites, for a native client.
 *
 * The web list renders this query inside the page. Same platform-only
 * gate as everything else on this route: the sidebar shows Warehouses
 * to ALL-scoped grants alone, and the API answers the same people.
 * Same columns as the page, including the three counts the cards show
 * (photos, staff, transporters), newest sites last, capped at 200.
 */
export async function GET() {
  return handler(async ({ requestId }) => {
    try {
      await requirePlatformWarehouse("warehouse.read");

      const rows = await getDb().execute<Record<string, unknown>>(sql`
        select w.id, w.code, w.name, w.is_active, w.warehouse_type_id, t.name as type_name,
               w.address, w.landmark, w.area, w.city_id, c.name as city_name,
               s.name as state_name, w.pincode::text as pincode,
               w.latitude, w.longitude, w.gmap_url,
               w.total_area_sqft, w.usable_area_sqft, w.storage_capacity_cbm,
               w.pallet_positions, w.dock_count, w.max_vehicle_length_ft, w.floor_count,
               w.has_racking, w.has_cctv, w.has_weighbridge,
               w.contact_person, w.contact_mobile::text as contact_mobile,
               w.alternate_mobile::text as alternate_mobile, w.notes,
               (select count(*) from wms.warehouse_image i
                 where i.warehouse_id = w.id)::int as photos,
               (select count(*) from wms.user_role_assignment ura
                 where ura.warehouse_id = w.id and ura.revoked_at is null)::int as staff,
               (select count(*) from wms.warehouse_transporter wt
                 where wt.warehouse_id = w.id and wt.deleted_at is null)::int as transporters
          from wms.warehouse w
          left join wms.warehouse_type t on t.id = w.warehouse_type_id
          left join wms.city c on c.id = w.city_id
          left join wms.state s on s.id = c.state_id
         where w.deleted_at is null
         order by w.is_active desc, w.code
         limit 200
      `);

      return ok(
        {
          warehouses: rows.map((r) => ({
            id: Number(r.id),
            code: String(r.code ?? ""),
            name: String(r.name ?? ""),
            isActive: Boolean(r.is_active),
            typeName: (r.type_name as string | null) ?? null,
            address: (r.address as string | null) ?? null,
            landmark: (r.landmark as string | null) ?? null,
            area: (r.area as string | null) ?? null,
            cityName: (r.city_name as string | null) ?? null,
            stateName: (r.state_name as string | null) ?? null,
            pincode: (r.pincode as string | null) ?? null,
            gmapUrl: (r.gmap_url as string | null) ?? null,
            totalAreaSqft: r.total_area_sqft === null ? null : Number(r.total_area_sqft),
            usableAreaSqft: r.usable_area_sqft === null ? null : Number(r.usable_area_sqft),
            storageCapacityCbm:
              r.storage_capacity_cbm === null ? null : Number(r.storage_capacity_cbm),
            palletPositions: r.pallet_positions === null ? null : Number(r.pallet_positions),
            dockCount: r.dock_count === null ? null : Number(r.dock_count),
            maxVehicleLengthFt:
              r.max_vehicle_length_ft === null ? null : Number(r.max_vehicle_length_ft),
            floorCount: r.floor_count === null ? null : Number(r.floor_count),
            hasRacking: Boolean(r.has_racking),
            hasCctv: Boolean(r.has_cctv),
            hasWeighbridge: Boolean(r.has_weighbridge),
            contactPerson: (r.contact_person as string | null) ?? null,
            contactMobile: (r.contact_mobile as string | null) ?? null,
            notes: (r.notes as string | null) ?? null,
            photos: Number(r.photos ?? 0),
            staff: Number(r.staff ?? 0),
            transporters: Number(r.transporters ?? 0),
          })),
        },
        requestId,
      );
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}

/**
 * POST /api/v1/admin/warehouses — add a site.
 *
 * `code` is not accepted from the request: the column defaults to
 * WH-0001 from `warehouse_code_seq`, the way importers and sales agents
 * already work. A hand-typed value in a UNIQUE column is a collision
 * waiting for two people to add a warehouse on the same afternoon.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor } = await requirePlatformWarehouse("warehouse.create");

      const parsed = createWarehouseSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }

      const created = await createWarehouse(parsed.data as Record<string, unknown>, actor, {
        requestId,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
      });
      return ok(created, requestId, 201);
    } catch (error) {
      if (error instanceof WarehouseError) {
        return fail(error.kind, error.message, requestId, error.fields ? { fields: error.fields } : undefined);
      }
      if (isUniqueViolation(error)) {
        return fail("CONFLICT", "A warehouse with that code already exists", requestId);
      }
      return toResponse(error, requestId);
    }
  })();
}
