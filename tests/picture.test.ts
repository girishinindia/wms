import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { PHOTO_EDGE, THUMB_EDGE, toWebp, toWebpPair } from "@/lib/storage/picture";

/**
 * Every stored picture is WebP, and lists get a thumbnail: an inward of
 * 50 lines loaded ~10 MB of full photos into 32 px squares before this.
 */
async function jpeg(width: number, height: number) {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: { r: 120, g: 80, b: 40 } } }).jpeg().toBuffer(),
  );
}

describe("pictures are stored as WebP", () => {
  it("makes a photo and a thumbnail, both WebP, both within their edge", async () => {
    const pic = await toWebpPair(await jpeg(3000, 2000));
    expect(pic).not.toBeNull();
    const photo = await sharp(Buffer.from(pic!.photo)).metadata();
    const thumb = await sharp(Buffer.from(pic!.thumb)).metadata();
    expect(photo.format).toBe("webp");
    expect(thumb.format).toBe("webp");
    expect(photo.width).toBe(PHOTO_EDGE);
    expect(thumb.width).toBe(THUMB_EDGE);
    expect(thumb.height).toBe(Math.round((THUMB_EDGE * 2000) / 3000));
    // The point of it: the thumbnail is tiny.
    expect(pic!.thumb.length).toBeLessThan(8 * 1024);
  });

  it("never enlarges a small picture", async () => {
    const out = await toWebp(await jpeg(100, 60), PHOTO_EDGE);
    expect((await sharp(Buffer.from(out!)).metadata()).width).toBe(100);
  });

  it("keeps a logo's transparency when asked", async () => {
    const png = new Uint8Array(
      await sharp({ create: { width: 300, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .png()
        .toBuffer(),
    );
    const out = await toWebp(png, 512, 90, { keepAlpha: true });
    expect((await sharp(Buffer.from(out!)).metadata()).hasAlpha).toBe(true);
  });

  it("answers null for bytes that are not a picture", async () => {
    expect(await toWebp(new Uint8Array([1, 2, 3, 4, 5]), 160)).toBeNull();
  });
});
