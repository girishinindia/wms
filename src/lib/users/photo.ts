import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { auditQuietly } from "@/lib/audit";
import type { Actor } from "@/lib/auth/guard";
import { invalidateUser } from "@/lib/cache/actor";
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

/** A 512px WebP at q0.82 lands around 20–40 KB. The cap is generous
 *  enough for a busy photograph and far below anything worth hosting. */
export const MAX_BYTES = 400 * 1024;
/** What the cropper produces. Bigger means the file did not come from it. */
export const MAX_EDGE = 512;

export class PhotoError extends Error {
  constructor(
    readonly kind: "VALIDATION_FAILED" | "NOT_FOUND" | "CONFLICT" | "INTERNAL",
    message: string,
  ) {
    super(message);
    this.name = "PhotoError";
  }
}

const u16 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const u24 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
const u32 = (b: Uint8Array, at: number) =>
  (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
const ascii = (b: Uint8Array, at: number, len: number) =>
  String.fromCharCode(...b.subarray(at, at + len));

/**
 * Read a WebP's real dimensions, or refuse the bytes.
 *
 * WebP is a RIFF container with three payload shapes, and a validator
 * that only knows the lossy one waves through the other two blind. All
 * three are read here:
 *
 *   VP8   simple lossy      14-bit width/height at 26 and 28
 *   VP8L  lossless          both packed into 28 bits at 21
 *   VP8X  extended          canvas size as 24-bit minus-one at 24 and 27
 */
export function webpSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 30) throw new PhotoError("VALIDATION_FAILED", "That file is too small to be an image");
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
    throw new PhotoError("VALIDATION_FAILED", "That is not a WebP image");
  }
  // The RIFF length must agree with the bytes actually delivered, give
  // or take the 8-byte header — a mismatch means a truncated or padded file.
  const declared = u32(bytes, 4) + 8;
  if (declared > bytes.length) {
    throw new PhotoError("VALIDATION_FAILED", "That image looks truncated");
  }

  const kind = ascii(bytes, 12, 4);
  if (kind === "VP8 ") {
    if (!(bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)) {
      throw new PhotoError("VALIDATION_FAILED", "That WebP frame is malformed");
    }
    return { width: u16(bytes, 26) & 0x3fff, height: u16(bytes, 28) & 0x3fff };
  }
  if (kind === "VP8L") {
    if (bytes[20] !== 0x2f) throw new PhotoError("VALIDATION_FAILED", "That WebP frame is malformed");
    const bits = u32(bytes, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === "VP8X") {
    return { width: u24(bytes, 24) + 1, height: u24(bytes, 27) + 1 };
  }
  throw new PhotoError("VALIDATION_FAILED", "That is not a WebP image");
}

/** Everything checked before a single byte reaches the CDN. */
export function validatePhoto(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length === 0) throw new PhotoError("VALIDATION_FAILED", "No image was sent");
  if (bytes.length > MAX_BYTES) {
    throw new PhotoError("VALIDATION_FAILED", `That image is over ${Math.round(MAX_BYTES / 1024)} KB`);
  }
  const size = webpSize(bytes);
  if (size.width < 32 || size.height < 32) {
    throw new PhotoError("VALIDATION_FAILED", "That image is too small to be a photo");
  }
  if (size.width > MAX_EDGE || size.height > MAX_EDGE) {
    throw new PhotoError("VALIDATION_FAILED", `Photos are ${MAX_EDGE}px at most on each side`);
  }
  return size;
}

/** `wms/profile-photo/u12-3f9a1c7d.webp` — never the uploaded filename,
 *  and never guessable from the user id alone. */
function newKey(userId: number): string {
  return `${photoFolder()}/u${userId}-${randomBytes(4).toString("hex")}.webp`;
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
  const size = validatePhoto(bytes);
  if (!configured()) {
    throw new PhotoError("CONFLICT", "Photo storage is not configured on this environment");
  }

  const before = await currentPhoto(targetUserId);
  if (!before) throw new PhotoError("NOT_FOUND", "No such user");

  const key = newKey(targetUserId);
  const put = await putObject(key, bytes, "image/webp");
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
