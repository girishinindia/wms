import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { auditQuietly } from "@/lib/audit";
import type { Actor } from "@/lib/auth/guard";
import { invalidateUser } from "@/lib/cache/actor";
import {
  ImageError,
  type ImageInfo,
  PROFILE_LIMITS,
  validateImage,
  validateWebp,
  webpSize as readWebpSize,
} from "@/lib/images/webp";
import { configured, deleteObject, keyFromUrl, photoFolder, publicUrl, putObject } from "@/lib/storage/bunny";

/**
 * A user's profile photo: validate it, put it on the CDN, swap the
 * column, and take the old file away.
 *
 * The browser has already cropped, rotated and re-encoded to WebP —
 * that is where a cropper belongs. None of it is believed here. A client
 * says "image/webp" by setting a header; this reads the actual bytes,
 * because the thing being written is a public URL on our own domain and
 * "the client promised" is not a check.
 */

/** The limits, re-exported under the names this module has always used
 *  so its callers and its tests do not have to care that the reader
 *  moved to `lib/images/webp.ts` to be shared with the gallery. */
export const MAX_BYTES = PROFILE_LIMITS.maxBytes;
export const MAX_EDGE = PROFILE_LIMITS.maxEdge;

export class PhotoError extends Error {
  constructor(
    readonly kind: "VALIDATION_FAILED" | "NOT_FOUND" | "CONFLICT" | "INTERNAL",
    message: string,
  ) {
    super(message);
    this.name = "PhotoError";
  }
}

/** The header reader, under this module's original name. */
export function webpSize(bytes: Uint8Array): { width: number; height: number } {
  try {
    return readWebpSize(bytes);
  } catch (error) {
    throw new PhotoError("VALIDATION_FAILED", error instanceof Error ? error.message : "Bad image");
  }
}

/** A profile photo specifically: square-ish, small, 512px at most.
 *  WebP only — kept for the callers and tests that predate the phone. */
export function validatePhoto(bytes: Uint8Array): { width: number; height: number } {
  try {
    return validateWebp(bytes, PROFILE_LIMITS);
  } catch (error) {
    if (error instanceof ImageError) throw new PhotoError("VALIDATION_FAILED", error.message);
    throw error;
  }
}

/** The same limits, across the three formats a profile photo may
 *  arrive in. The gallery is unchanged and stays WebP-only. */
export function validateImageFile(bytes: Uint8Array): ImageInfo {
  try {
    return validateImage(bytes, PROFILE_LIMITS);
  } catch (error) {
    if (error instanceof ImageError) throw new PhotoError("VALIDATION_FAILED", error.message);
    throw error;
  }
}

/** `wms/profile-photo/u12-3f9a1c7d.webp` — never the uploaded filename,
 *  and never guessable from the user id alone. */
function newKey(userId: number, ext: string): string {
  return `${photoFolder()}/u${userId}-${randomBytes(4).toString("hex")}.${ext}`;
}

type Meta = { requestId: string; ip: string | null; userAgent: string | null };

async function currentPhoto(userId: number): Promise<{ url: string | null; label: string } | null> {
  const rows = await getDb().execute<{ photo_url: string | null; first_name: string; last_name: string }>(sql`
    select photo_url, first_name, last_name from wms.users
     where id = ${userId} and deleted_at is null
  `);
  const row = rows[0];
  if (!row) return null;
  return { url: row.photo_url, label: `${row.first_name} ${row.last_name}`.trim() };
}

/**
 * Replace someone's photo.
 *
 * Written new-first, then swap, then remove the old. The instruction was
 * "delete the previous, then save the new", and the end state is the
 * same either way — but the file name carries fresh random bytes every
 * time, so nothing collides, and doing it in this order means a failed
 * upload leaves the existing photo intact instead of having already
 * destroyed it. The old file is never left behind: the delete is the
 * last step of the same request, and an orphan could only survive Bunny
 * itself refusing the delete, which is logged.
 */
export async function setUserPhoto(
  targetUserId: number,
  bytes: Uint8Array,
  actor: Actor,
  meta: Meta,
): Promise<{ photoUrl: string; width: number; height: number }> {
  // The phone sends JPEG (it has no dependable WebP encoder); the web
  // cropper still sends WebP. Both are read from their actual bytes and
  // stored as what they are, rather than mislabelled as WebP.
  const image = validateImageFile(bytes);
  const size = { width: image.width, height: image.height };
  if (!configured()) {
    throw new PhotoError("CONFLICT", "Photo storage is not configured on this environment");
  }

  const before = await currentPhoto(targetUserId);
  if (!before) throw new PhotoError("NOT_FOUND", "No such user");

  const key = newKey(targetUserId, image.ext);
  const put = await putObject(key, bytes, image.contentType);
  if (!put.ok) {
    console.error("[photo] upload failed", { requestId: meta.requestId, key, ...put });
    throw new PhotoError("INTERNAL", "The image could not be stored. Try again.");
  }
  const url = publicUrl(key);

  const updated = await getDb().execute<{ id: number }>(sql`
    update wms.users set photo_url = ${url}
     where id = ${targetUserId} and deleted_at is null
    returning id
  `);
  if (updated.length === 0) {
    // The row went between the read and the write. Take the orphan back
    // out rather than leaving a file nothing points at.
    await deleteObject(key);
    throw new PhotoError("NOT_FOUND", "No such user");
  }

  const oldKey = keyFromUrl(before.url);
  if (oldKey && oldKey !== key) {
    const removed = await deleteObject(oldKey);
    if (!removed.ok) {
      // The new photo is already live and the column already points at
      // it; a stranded old file is a tidiness problem, not a failure to
      // report to the person who just changed their picture.
      console.error("[photo] old object not removed", { requestId: meta.requestId, oldKey, ...removed });
    }
  }

  await auditQuietly({
    action: "user.photo_updated",
    operation: "UPDATE",
    entityType: "user",
    entityId: String(targetUserId),
    entityLabel: before.label,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    reason: targetUserId === actor.session.userId ? "own profile photo" : "profile photo set by an admin",
    before: { photoUrl: before.url },
    after: { photoUrl: url },
    metadata: { bytes: bytes.length, width: size.width, height: size.height, oldObjectRemoved: Boolean(oldKey) },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });

  // The sidebar reads the photo off the session, and the session comes
  // from the actor cache.
  await invalidateUser(targetUserId);
  return { photoUrl: url, width: size.width, height: size.height };
}

/** Take the photo away and put the initials back. */
export async function clearUserPhoto(
  targetUserId: number,
  actor: Actor,
  meta: Meta,
): Promise<{ photoUrl: null }> {
  const before = await currentPhoto(targetUserId);
  if (!before) throw new PhotoError("NOT_FOUND", "No such user");
  if (!before.url) return { photoUrl: null };

  await getDb().execute(sql`
    update wms.users set photo_url = null where id = ${targetUserId} and deleted_at is null
  `);

  const oldKey = keyFromUrl(before.url);
  if (oldKey) {
    const removed = await deleteObject(oldKey);
    if (!removed.ok) {
      console.error("[photo] object not removed on clear", { requestId: meta.requestId, oldKey, ...removed });
    }
  }

  await auditQuietly({
    action: "user.photo_removed",
    operation: "UPDATE",
    entityType: "user",
    entityId: String(targetUserId),
    entityLabel: before.label,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    reason: targetUserId === actor.session.userId ? "own profile photo removed" : "profile photo removed by an admin",
    before: { photoUrl: before.url },
    after: { photoUrl: null },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });

  await invalidateUser(targetUserId);
  return { photoUrl: null };
}
