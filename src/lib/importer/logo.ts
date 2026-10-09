import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { auditQuietly } from "@/lib/audit";
import type { Actor } from "@/lib/auth/guard";
import { InwardError, sniffDocument, type Meta } from "@/lib/inward/ops";
import { configured, deleteObject, keyFromUrl, publicUrl, putObject } from "@/lib/storage/bunny";

/**
 * The importer's logo — printed on every carton sticker. Uploaded by the
 * importer from their company page, or by the super admin from the
 * importer's admin page. A picture (JPG, PNG, WebP), 1 MB at most; the
 * browser and the app shrink it first.
 */
export const LOGO_MAX_BYTES = 1024 * 1024;

export async function setImporterLogo(actor: Actor, importerId: number, bytes: Uint8Array, meta: Meta) {
  const rows = await getDb().execute<{ code: string; logo_url: string | null }>(sql`
    select code, logo_url from wms.importer where id = ${importerId} and deleted_at is null
  `);
  const row = rows[0];
  if (!row) throw new InwardError("NOT_FOUND", "No such importer");
  if (bytes.length > LOGO_MAX_BYTES) throw new InwardError("VALIDATION_FAILED", "That logo is over 1 MB");
  const { type, ext } = sniffDocument(bytes);
  if (type === "application/pdf") throw new InwardError("VALIDATION_FAILED", "A logo has to be a picture (JPG, PNG or WebP)");
  if (!configured()) throw new InwardError("CONFLICT", "Image storage is not configured on this environment");

  const key = `importers/${importerId}/logo-${randomBytes(4).toString("hex")}.${ext}`;
  const put = await putObject(key, bytes, type);
  if (!put.ok) throw new InwardError("INTERNAL", "The logo could not be stored. Try again.");
  const url = publicUrl(key);
  await getDb().execute(sql`
    update wms.importer set logo_url = ${url}, updated_by = ${actor.session.userId}, updated_at = now()
     where id = ${importerId}
  `);
  const old = keyFromUrl(row.logo_url);
  if (old) await deleteObject(old);
  await auditQuietly({
    action: "importer.logo.updated",
    operation: "UPDATE",
    entityType: "importer",
    entityId: String(importerId),
    entityLabel: row.code,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    after: { logoUrl: url },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
  return { logoUrl: url };
}

export async function removeImporterLogo(actor: Actor, importerId: number, meta: Meta) {
  const rows = await getDb().execute<{ code: string; logo_url: string | null }>(sql`
    select code, logo_url from wms.importer where id = ${importerId} and deleted_at is null
  `);
  const row = rows[0];
  if (!row) throw new InwardError("NOT_FOUND", "No such importer");
  await getDb().execute(sql`
    update wms.importer set logo_url = null, updated_by = ${actor.session.userId}, updated_at = now() where id = ${importerId}
  `);
  const old = keyFromUrl(row.logo_url);
  if (old) await deleteObject(old);
  await auditQuietly({
    action: "importer.logo.removed",
    operation: "UPDATE",
    entityType: "importer",
    entityId: String(importerId),
    entityLabel: row.code,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    before: { logoUrl: row.logo_url },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
  return { logoUrl: null };
}
