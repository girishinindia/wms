/**
 * Reading a WebP header, and deciding whether to accept it.
 *
 * No `server-only`: the limits are quoted in the upload forms too, and a
 * number that appears in a message to the user and in the check that
 * rejects them should be the same number.
 *
 * The browser crops, rotates and encodes; none of that is believed here.
 * A client sets `content-type: image/webp` by typing it. This reads the
 * actual bytes, because what gets written is a public URL on our own
 * CDN and "the client promised" is not a check.
 */

export type ImageLimits = {
  maxBytes: number;
  maxEdge: number;
  /** Below this, it is an icon or a mistake, not a photograph. */
  minEdge: number;
};

/** A square avatar. Small, and never displayed larger. */
export const PROFILE_LIMITS: ImageLimits = { maxBytes: 400 * 1024, maxEdge: 512, minEdge: 32 };

/** A warehouse interior. Wants the detail an avatar does not. */
export const GALLERY_LIMITS: ImageLimits = { maxBytes: 800 * 1024, maxEdge: 1600, minEdge: 200 };

export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageError";
  }
}

const u16 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const u24 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
const u32 = (b: Uint8Array, at: number) =>
  (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
const ascii = (b: Uint8Array, at: number, len: number) =>
  String.fromCharCode(...b.subarray(at, at + len));

/**
 * A WebP's real dimensions, or a refusal.
 *
 * WebP is a RIFF container with three payload shapes, and a validator
 * that knows only the common one waves the other two through unread.
 * All three are handled:
 *
 *   VP8   simple lossy      14-bit width/height at 26 and 28
 *   VP8L  lossless          both packed into 28 bits at 21
 *   VP8X  extended          canvas size as 24-bit minus-one at 24 and 27
 */
export function webpSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 30) throw new ImageError("That file is too small to be an image");
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
    throw new ImageError("That is not a WebP image");
  }
  // The RIFF length must agree with the bytes delivered, give or take
  // the 8-byte header — a mismatch means truncated or padded.
  if (u32(bytes, 4) + 8 > bytes.length) throw new ImageError("That image looks truncated");

  const kind = ascii(bytes, 12, 4);
  if (kind === "VP8 ") {
    if (!(bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)) {
      throw new ImageError("That WebP frame is malformed");
    }
    return { width: u16(bytes, 26) & 0x3fff, height: u16(bytes, 28) & 0x3fff };
  }
  if (kind === "VP8L") {
    if (bytes[20] !== 0x2f) throw new ImageError("That WebP frame is malformed");
    const bits = u32(bytes, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === "VP8X") {
    return { width: u24(bytes, 24) + 1, height: u24(bytes, 27) + 1 };
  }
  throw new ImageError("That is not a WebP image");
}

/** Everything checked before a byte reaches the CDN. */
export function validateWebp(bytes: Uint8Array, limits: ImageLimits): { width: number; height: number } {
  if (bytes.length === 0) throw new ImageError("No image was sent");
  if (bytes.length > limits.maxBytes) {
    throw new ImageError(`That image is over ${Math.round(limits.maxBytes / 1024)} KB`);
  }
  const size = webpSize(bytes);
  if (size.width < limits.minEdge || size.height < limits.minEdge) {
    throw new ImageError(`Images must be at least ${limits.minEdge}px on each side`);
  }
  if (size.width > limits.maxEdge || size.height > limits.maxEdge) {
    throw new ImageError(`Images are ${limits.maxEdge}px at most on each side`);
  }
  return size;
}
