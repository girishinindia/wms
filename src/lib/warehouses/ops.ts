import "server-only";

import { randomBytes } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";

import { getDb } from "@/db";
import { PUBLIC_WAREHOUSE_TAG } from "@/lib/warehouses/public";
import { auditQuietly } from "@/lib/audit";
import type { Actor } from "@/lib/auth/guard";
import { GALLERY_LIMITS, ImageError, validateWebp } from "@/lib/images/webp";
import { configured, deleteObject, publicUrl, putObject } from "@/lib/storage/bunny";

/**
 * Warehouses, and the photos of them.
 *
 * The table predates this screen and is written by other parts of the
 * system, so nothing here assumes it owns the row: every write names the
 * columns it touches and leaves the rest alone.
 */

export class WarehouseError extends Error {
  constructor(
    readonly kind: "VALIDATION_FAILED" | "NOT_FOUND" | "CONFLICT" | "INTERNAL",
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "WarehouseError";
  }
}

type Meta = { requestId: string; ip: string | null; userAgent: string | null };

/** Column per input key. The SQL side of the name is only ever from
 *  here, never from a request. */
const COLUMNS: Record<string, string> = {
  name: "name",
  warehouseTypeId: "warehouse_type_id",
  address: "address",
  landmark: "landmark",
  area: "area",
  cityId: "city_id",
  pincode: "pincode",
  latitude: "latitude",
  longitude: "longitude",
  gmapUrl: "gmap_url",
  totalAreaSqft: "total_area_sqft",
  usableAreaSqft: "usable_area_sqft",
  storageCapacityCbm: "storage_capacity_cbm",
  palletPositions: "pallet_positions",
  dockCount: "dock_count",
  maxVehicleLengthFt: "max_vehicle_length_ft",
  floorCount: "floor_count",
  hasRacking: "has_racking",
  hasCctv: "has_cctv",
  hasWeighbridge: "has_weighbridge",
  contactPerson: "contact_person",
  contactMobile: "contact_mobile",
  alternateMobile: "alternate_mobile",
  isActive: "is_active",
  notes: "notes",
};

const CASTS: Record<string, string> = {
  pincode: "::wms.pincode_in",
  contactMobile: "::wms.mobile_in",
  alternateMobile: "::wms.mobile_in",
};

/**
 * The name has to be unique among live warehouses.
 *
 * Not enforced by an index — the table has none on `name` and adding one
 * would reject the rows a half-finished import might already have left
 * there. Checked here so two "Bhiwandi Hub"s cannot be created through
 * the screen, and reported on the field rather than as a bare failure.
 */
export async function findNameConflict(name: string, exceptId?: number): Promise<boolean> {
  const rows = await getDb().execute<{ hit: boolean }>(sql`
    select true as hit from wms.warehouse
     where deleted_at is null and lower(name) = lower(${name})
       ${exceptId ? sql`and id <> ${exceptId}` : sql``}
     limit 1
  `);
  return rows.length > 0;
}

/** A city and a type that are both real and both switched on. */
async function checkReferences(input: { cityId?: number; warehouseTypeId?: number }): Promise<void> {
  const fields: Record<string, string> = {};
  if (typeof input.cityId === "number") {
    const rows = await getDb().execute<{ id: number }>(sql`
      select id from wms.city where id = ${input.cityId} and is_active and deleted_at is null
    `);
    if (rows.length === 0) fields.cityId = "Not an active city";
  }
  if (typeof input.warehouseTypeId === "number") {
    const rows = await getDb().execute<{ id: number }>(sql`
      select id from wms.warehouse_type
       where id = ${input.warehouseTypeId} and is_active and deleted_at is null
    `);
    if (rows.length === 0) fields.warehouseTypeId = "Not an active warehouse type";
  }
  if (Object.keys(fields).length > 0) {
    throw new WarehouseError("VALIDATION_FAILED", "Please check the highlighted fields", fields);
  }
}

/**
 * Drop the cached public reads after a change.
 *
 * The public pages cache their queries for five minutes, which is what
 * keeps crawler traffic off the database. Without this, an operator who
 * fixes a wrong address or adds a photograph sees the old page and
 * reasonably concludes the save did not work.
 *
 * The TAG is the one that matters — the data is cached in
 * `lib/warehouses/public`, so dropping the rendered pages alone would
 * re-render them from the same stale rows. The two path calls clear the
 * rendered output as well; `"page"` on the second covers every path
 * matching the dynamic route, so the photo handlers do not need to look
 * up a code they were never given.
 *
 * Wrapped, and quiet: outside a request Next can revalidate this
 * throws, and a stale cache is not worth failing a save over.
 */
function refreshPublicSite(): void {
  try {
    revalidateTag(PUBLIC_WAREHOUSE_TAG);
    revalidatePath("/warehouses");
    revalidatePath("/warehouses/[code]", "page");
  } catch (error) {
    console.error("[warehouse] public pages not revalidated", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createWarehouse(
  input: Record<string, unknown>,
  actor: Actor,
  meta: Meta,
): Promise<{ id: number; code: string }> {
  if (await findNameConflict(String(input.name))) {
    throw new WarehouseError("CONFLICT", "A warehouse with that name already exists", {
      name: "Already in use",
    });
  }
  await checkReferences(input as { cityId?: number; warehouseTypeId?: number });

  const keys = Object.keys(COLUMNS).filter((k) => input[k] !== undefined);
  const columns = keys.map((k) => sql.raw(COLUMNS[k]!));
  const values = keys.map((k) =>
    CASTS[k] ? sql`${input[k]}${sql.raw(CASTS[k]!)}` : sql`${input[k]}`,
  );

  // `code` is left out on purpose so the column default assigns WH-0001.
  const rows = await getDb().execute<{ id: number; code: string }>(sql`
    insert into wms.warehouse (${sql.join(columns, sql`, `)}, created_by)
    values (${sql.join(values, sql`, `)}, ${actor.session.userId})
    returning id, code
  `);
  const row = rows[0]!;

  await auditQuietly({
    action: "warehouse.created",
    operation: "INSERT",
    entityType: "warehouse",
    entityId: String(row.id),
    entityLabel: `${row.code} ${String(input.name)}`,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    after: { ...input, code: row.code },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
  refreshPublicSite();
  return { id: Number(row.id), code: row.code };
}

export async function updateWarehouse(
  id: number,
  input: Record<string, unknown>,
  actor: Actor,
  meta: Meta,
): Promise<void> {
  const before = await getDb().execute<Record<string, unknown>>(sql`
    select id, code, name from wms.warehouse where id = ${id} and deleted_at is null
  `);
  if (before.length === 0) throw new WarehouseError("NOT_FOUND", "No such warehouse");

  if (typeof input.name === "string" && (await findNameConflict(input.name, id))) {
    throw new WarehouseError("CONFLICT", "A warehouse with that name already exists", {
      name: "Already in use",
    });
  }
  await checkReferences(input as { cityId?: number; warehouseTypeId?: number });

  const sets: SQL[] = [];
  const touched: string[] = [];
  for (const [key, column] of Object.entries(COLUMNS)) {
    if (!(key in input)) continue;
    touched.push(key);
    const cast = CASTS[key];
    sets.push(
      cast
        ? sql`${sql.raw(column)} = ${input[key] ?? null}${sql.raw(cast)}`
        : sql`${sql.raw(column)} = ${input[key] ?? null}`,
    );
  }
  if (sets.length === 0) throw new WarehouseError("VALIDATION_FAILED", "Nothing to change");
  sets.push(sql`updated_by = ${actor.session.userId}`, sql`updated_at = now()`);

  await getDb().execute(sql`
    update wms.warehouse set ${sql.join(sets, sql`, `)}
     where id = ${id} and deleted_at is null
  `);

  await auditQuietly({
    action: "warehouse.updated",
    operation: "UPDATE",
    entityType: "warehouse",
    entityId: String(id),
    entityLabel: `${String(before[0]!.code)} ${String(before[0]!.name)}`,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    after: Object.fromEntries(touched.map((k) => [k, input[k] ?? null])),
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
  refreshPublicSite();
}

/** "2 staff, 1 transporter" — or "" when nothing points at the row. */
export async function warehouseInUse(id: number): Promise<string> {
  const [row] = await getDb().execute<{ staff: number; transporters: number }>(sql`
    select (select count(*) from wms.user_role_assignment
             where warehouse_id = ${id} and revoked_at is null)::int as staff,
           (select count(*) from wms.warehouse_transporter
             where warehouse_id = ${id} and deleted_at is null)::int as transporters
  `);
  const parts: string[] = [];
  if (row && row.staff > 0) parts.push(`${row.staff} staff ${row.staff === 1 ? "member" : "members"}`);
  if (row && row.transporters > 0) {
    parts.push(`${row.transporters} transporter${row.transporters === 1 ? "" : "s"}`);
  }
  return parts.join(", ");
}

/**
 * Soft delete, refused while anybody is posted there.
 *
 * A warehouse is not a master row: staff are assigned to it and vehicles
 * are routed through it, so removing one out from under a live
 * assignment breaks a person's access rather than tidying a list.
 * The photos go for good, though — they are files, and a file nothing
 * can reach is a file nobody stops paying for.
 */
export async function deleteWarehouse(id: number, actor: Actor, meta: Meta, reason: string): Promise<void> {
  const rows = await getDb().execute<{ code: string; name: string }>(sql`
    select code, name from wms.warehouse where id = ${id} and deleted_at is null
  `);
  if (rows.length === 0) throw new WarehouseError("NOT_FOUND", "No such warehouse");

  const inUse = await warehouseInUse(id);
  if (inUse) {
    throw new WarehouseError(
      "CONFLICT",
      `Still in use by ${inUse}. Move them first, or switch the warehouse off instead.`,
    );
  }

  const images = await listWarehouseImages(id);
  for (const image of images) {
    const removed = await deleteObject(image.storageKey);
    if (!removed.ok) {
      console.error("[warehouse] gallery object not removed", {
        requestId: meta.requestId,
        key: image.storageKey,
        ...removed,
      });
    }
  }
  // The rows go with the warehouse via `on delete cascade`; this makes
  // it explicit, because the warehouse itself is only soft-deleted.
  await getDb().execute(sql`delete from wms.warehouse_image where warehouse_id = ${id}`);

  await getDb().execute(sql`
    update wms.warehouse
       set deleted_at = now(), deleted_by = ${actor.session.userId}, is_active = false
     where id = ${id} and deleted_at is null
  `);

  await auditQuietly({
    action: "warehouse.deleted",
    operation: "DELETE",
    entityType: "warehouse",
    entityId: String(id),
    entityLabel: `${rows[0]!.code} ${rows[0]!.name}`,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    reason,
    before: rows[0],
    metadata: { galleryPhotosRemoved: images.length },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
  refreshPublicSite();
}

// ── Gallery ───────────────────────────────────────────────────────

export type WarehouseImage = {
  id: number;
  warehouseId: number;
  storageKey: string;
  url: string;
  caption: string | null;
  width: number;
  height: number;
  bytes: number;
  sortOrder: number;
  createdAt: string;
};

/** The same row with the storage key taken off.
 *
 *  What a client needs is the CDN URL; the key is what a client could
 *  use to guess at the objects either side of it. Written once, here,
 *  so that "remember to drop the key" is not a thing each caller has to
 *  remember. */
export type PublicWarehouseImage = Omit<WarehouseImage, "storageKey">;

export function publicImage(image: WarehouseImage): PublicWarehouseImage {
  return {
    id: image.id,
    warehouseId: image.warehouseId,
    url: image.url,
    caption: image.caption,
    width: image.width,
    height: image.height,
    bytes: image.bytes,
    sortOrder: image.sortOrder,
    createdAt: image.createdAt,
  };
}

export function galleryFolder(warehouseId: number): string {
  return `wms/gallery/${warehouseId}`;
}

export async function listWarehouseImages(warehouseId: number): Promise<WarehouseImage[]> {
  const rows = await getDb().execute<Record<string, unknown>>(sql`
    select id, warehouse_id, storage_key, url, caption, width, height, bytes, sort_order, created_at
      from wms.warehouse_image
     where warehouse_id = ${warehouseId}
     order by sort_order, id
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    warehouseId: Number(r.warehouse_id),
    storageKey: String(r.storage_key),
    url: String(r.url),
    caption: (r.caption as string | null) ?? null,
    width: Number(r.width),
    height: Number(r.height),
    bytes: Number(r.bytes),
    sortOrder: Number(r.sort_order),
    createdAt: String(r.created_at),
  }));
}

/**
 * Add one photo to a warehouse's gallery.
 *
 * Object first, row second. The reverse would let a failed upload leave
 * a row pointing at nothing, which renders as a broken image in the grid
 * with no way to tell it from a CDN hiccup.
 */
export async function addWarehouseImage(
  warehouseId: number,
  bytes: Uint8Array,
  actor: Actor,
  meta: Meta,
): Promise<WarehouseImage> {
  let size: { width: number; height: number };
  try {
    size = validateWebp(bytes, GALLERY_LIMITS);
  } catch (error) {
    if (error instanceof ImageError) throw new WarehouseError("VALIDATION_FAILED", error.message);
    throw error;
  }
  if (!configured()) {
    throw new WarehouseError("CONFLICT", "Photo storage is not configured on this environment");
  }

  const found = await getDb().execute<{ code: string; name: string }>(sql`
    select code, name from wms.warehouse where id = ${warehouseId} and deleted_at is null
  `);
  if (found.length === 0) throw new WarehouseError("NOT_FOUND", "No such warehouse");

  const key = `${galleryFolder(warehouseId)}/${randomBytes(8).toString("hex")}.webp`;
  const put = await putObject(key, bytes, "image/webp");
  if (!put.ok) {
    console.error("[warehouse] gallery upload failed", { requestId: meta.requestId, key, ...put });
    throw new WarehouseError("INTERNAL", "The image could not be stored. Try again.");
  }
  const url = publicUrl(key);

  let rows: Record<string, unknown>[];
  try {
    rows = await getDb().execute<Record<string, unknown>>(sql`
      insert into wms.warehouse_image
        (warehouse_id, storage_key, url, width, height, bytes, sort_order, created_by)
      values (${warehouseId}, ${key}, ${url}, ${size.width}, ${size.height}, ${bytes.length},
              coalesce((select max(sort_order) + 1 from wms.warehouse_image
                         where warehouse_id = ${warehouseId}), 0),
              ${actor.session.userId})
      returning id, warehouse_id, storage_key, url, caption, width, height, bytes, sort_order, created_at
    `);
  } catch (error) {
    // Nothing points at the object now, so it must not stay.
    await deleteObject(key);
    throw error;
  }
  const r = rows[0]!;

  await auditQuietly({
    action: "warehouse.image_added",
    operation: "INSERT",
    entityType: "warehouse_image",
    entityId: String(r.id),
    entityLabel: `${found[0]!.code} ${found[0]!.name}`,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    after: { warehouseId, storageKey: key, ...size, bytes: bytes.length },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });

  refreshPublicSite();

  return {
    id: Number(r.id),
    warehouseId,
    storageKey: key,
    url,
    caption: null,
    width: size.width,
    height: size.height,
    bytes: bytes.length,
    sortOrder: Number(r.sort_order),
    createdAt: String(r.created_at),
  };
}

/**
 * Remove one photo, from the CDN and from the table.
 *
 * File first: if the delete is refused, the row stays and the photo is
 * still shown, which is recoverable. The other order leaves a paid-for
 * file that nothing in the system remembers.
 */
export async function deleteWarehouseImage(
  warehouseId: number,
  imageId: number,
  actor: Actor,
  meta: Meta,
): Promise<void> {
  const rows = await getDb().execute<{ storage_key: string; url: string }>(sql`
    select storage_key, url from wms.warehouse_image
     where id = ${imageId} and warehouse_id = ${warehouseId}
  `);
  if (rows.length === 0) throw new WarehouseError("NOT_FOUND", "No such photo");
  const key = rows[0]!.storage_key;

  const removed = await deleteObject(key);
  if (!removed.ok) {
    console.error("[warehouse] gallery object not removed", { requestId: meta.requestId, key, ...removed });
    throw new WarehouseError("INTERNAL", "The image could not be removed from storage. Try again.");
  }

  await getDb().execute(sql`
    delete from wms.warehouse_image where id = ${imageId} and warehouse_id = ${warehouseId}
  `);

  await auditQuietly({
    action: "warehouse.image_removed",
    operation: "DELETE",
    entityType: "warehouse_image",
    entityId: String(imageId),
    entityLabel: key,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    reason: "gallery photo removed by a super admin",
    before: { warehouseId, storageKey: key, url: rows[0]!.url },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
  refreshPublicSite();
}
