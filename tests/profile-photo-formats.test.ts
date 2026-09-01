import { describe, expect, it } from "vitest";

import {
  ImageError,
  PROFILE_LIMITS,
  sniff,
  validateImage,
} from "../src/lib/images/webp";

/**
 * A profile photo may now arrive as WebP, JPEG or PNG.
 *
 * The reason is the phone: Flutter has no dependable WebP encoder on
 * both platforms, so a WebP-only endpoint meant no avatar from the app
 * at all. What did NOT change is the rule that made the endpoint safe —
 * the dimensions come out of the actual bytes, never out of a header
 * the client typed.
 */

/** A 1×1 PNG, by hand: signature + IHDR. Enough for the reader. */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  b.set([(width >> 24) & 255, (width >> 16) & 255, (width >> 8) & 255, width & 255], 16);
  b.set([(height >> 24) & 255, (height >> 16) & 255, (height >> 8) & 255, height & 255], 20);
  return b;
}

/** A JPEG whose SOF0 sits AFTER a fat APP1 — the camera's own shape. */
function jpeg(width: number, height: number, exifBytes = 2000): Uint8Array {
  const app1 = 2 + exifBytes;
  const b = new Uint8Array(2 + 2 + app1 + 2 + 17);
  let at = 0;
  b.set([0xff, 0xd8], at); at += 2;                      // SOI
  b.set([0xff, 0xe1, (app1 >> 8) & 255, app1 & 255], at); // APP1 + length
  at += 2 + app1;
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], at);             // SOF0, len 17, 8-bit
  b.set([(height >> 8) & 255, height & 255], at + 5);
  b.set([(width >> 8) & 255, width & 255], at + 7);
  return b;
}

describe("sniffing", () => {
  it("names the format from the bytes", () => {
    expect(sniff(png(10, 10))).toBe("png");
    expect(sniff(jpeg(10, 10))).toBe("jpeg");
  });

  it("refuses anything else", () => {
    expect(() => sniff(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(ImageError);
  });
});

describe("validateImage", () => {
  it("reads a PNG's real size and stores it as a PNG", () => {
    const info = validateImage(png(256, 256), PROFILE_LIMITS);
    expect(info).toMatchObject({
      width: 256,
      height: 256,
      kind: "png",
      contentType: "image/png",
      ext: "png",
    });
  });

  it("walks past a camera's EXIF block to find a JPEG's frame", () => {
    // The whole point: the dimensions are not at a fixed offset, and a
    // phone photo is exactly the case with a big APP1 in front.
    const info = validateImage(jpeg(512, 512), PROFILE_LIMITS);
    expect(info).toMatchObject({ width: 512, height: 512, kind: "jpeg", ext: "jpg" });
  });

  it("applies the same edge limits it always did", () => {
    expect(() => validateImage(png(4000, 4000), PROFILE_LIMITS)).toThrow(
      /512px at most/,
    );
    expect(() => validateImage(png(8, 8), PROFILE_LIMITS)).toThrow(
      /at least 32px/,
    );
  });

  it("still refuses a file that merely claims to be an image", () => {
    const lying = new Uint8Array(64);
    lying.set([0x00, 0x00, 0x00, 0x00], 0);
    expect(() => validateImage(lying, PROFILE_LIMITS)).toThrow(ImageError);
  });
});
