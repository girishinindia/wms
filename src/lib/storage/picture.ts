import "server-only";

/**
 * Every picture the inward side stores goes through here: turned upright
 * (EXIF), shrunk, and saved as WebP — the photo for viewing and a small
 * thumbnail for lists. A goods table of 50 lines then loads 50 × ~5 KB
 * instead of 50 × ~200 KB.
 */

export const PHOTO_EDGE = 1280;
export const THUMB_EDGE = 160;

export type Picture = { photo: Uint8Array; thumb: Uint8Array };

/** The photo and its thumbnail, both WebP. Null when the bytes are not a
 *  picture sharp can read (the caller says so to the person). */
export async function toWebpPair(bytes: Uint8Array, opts: { keepAlpha?: boolean } = {}): Promise<Picture | null> {
  const photo = await toWebp(bytes, PHOTO_EDGE, 82, opts);
  if (!photo) return null;
  const thumb = await toWebp(bytes, THUMB_EDGE, 72, opts);
  return thumb ? { photo, thumb } : null;
}

/** One WebP, at most `edge` px on its long side, never enlarged. */
export async function toWebp(
  bytes: Uint8Array,
  edge: number,
  quality = 82,
  opts: { keepAlpha?: boolean } = {},
): Promise<Uint8Array | null> {
  const { default: sharp } = await import("sharp");
  try {
    let img = sharp(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { failOn: "error" })
      .rotate()
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true });
    // A logo keeps its transparency; a photo of goods has none to keep,
    // and flattening onto white avoids black corners on PNG screenshots.
    if (!opts.keepAlpha) img = img.flatten({ background: "#ffffff" });
    const out = await img.webp({ quality, effort: 4 }).toBuffer();
    return new Uint8Array(out);
  } catch {
    return null;
  }
}
