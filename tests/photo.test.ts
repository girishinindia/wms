import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Profile photos: what the server refuses, and what it says to Bunny.
 *
 * The validation half matters because the browser is the thing that
 * cropped and encoded the image, and the browser is not trustworthy —
 * "image/webp" is a header anybody can type. The transport half matters
 * because a storage AccessKey is a write credential for the whole zone
 * and the request that carries it is worth pinning down.
 */

// ── Building WebP headers by hand ──────────────────────────────────
// The container has three payload shapes and a validator that only
// knows the common one lets the other two through unread, so each is
// constructed here exactly as the spec lays it out.

function riff(payload: Uint8Array, minLength = 0): Uint8Array {
  const total = Math.max(12 + payload.length, minLength);
  const b = new Uint8Array(total);
  b.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  const size = total - 8;
  b.set([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff], 4);
  b.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  b.set(payload, 12);
  return b;
}

/** Simple lossy: 14-bit width and height after the 9d 01 2a start code. */
function vp8(width: number, height: number): Uint8Array {
  const p = new Uint8Array(18);
  p.set([0x56, 0x50, 0x38, 0x20], 0); // "VP8 "
  p.set([0x0a, 0, 0, 0], 4); // chunk length, not read
  p.set([0x9d, 0x01, 0x2a], 11); // start code at file offset 23
  p.set([width & 0xff, (width >> 8) & 0x3f], 14); // file offset 26
  p.set([height & 0xff, (height >> 8) & 0x3f], 16); // file offset 28
  return riff(p, 30);
}

/** Lossless: both dimensions packed, minus one, into 28 bits. */
function vp8l(width: number, height: number): Uint8Array {
  const p = new Uint8Array(14);
  p.set([0x56, 0x50, 0x38, 0x4c], 0); // "VP8L"
  p.set([0x0a, 0, 0, 0], 4);
  p[8] = 0x2f; // signature at file offset 20
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  p.set([bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff], 9);
  return riff(p, 30);
}

/** Extended: canvas size as two 24-bit minus-one values. */
function vp8x(width: number, height: number): Uint8Array {
  const p = new Uint8Array(18);
  p.set([0x56, 0x50, 0x38, 0x58], 0); // "VP8X"
  p.set([0x0a, 0, 0, 0], 4);
  const w = width - 1;
  const h = height - 1;
  p.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 12); // file offset 24
  p.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 15); // file offset 27
  return riff(p, 30);
}

describe("what counts as a profile photo", () => {
  it("reads every WebP flavour, not just the common one", async () => {
    const { webpSize } = await import("@/lib/users/photo");
    expect(webpSize(vp8(512, 512))).toEqual({ width: 512, height: 512 });
    expect(webpSize(vp8l(512, 384))).toEqual({ width: 512, height: 384 });
    expect(webpSize(vp8x(400, 512))).toEqual({ width: 400, height: 512 });
  });

  it("refuses anything that is not a WebP, whatever the header claimed", async () => {
    const { validatePhoto } = await import("@/lib/users/photo");
    // A PNG, correctly signed and completely unwelcome.
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    expect(() => validatePhoto(png)).toThrow(/not a WebP/i);
    // RIFF, but a WAV.
    const wav = new Uint8Array(64);
    wav.set([0x52, 0x49, 0x46, 0x46], 0);
    wav.set([0x57, 0x41, 0x56, 0x45], 8);
    expect(() => validatePhoto(wav)).toThrow(/not a WebP/i);
  });

  it("refuses a file whose RIFF length promises more than arrived", async () => {
    const { validatePhoto } = await import("@/lib/users/photo");
    const bytes = vp8(512, 512);
    bytes.set([0xff, 0xff, 0, 0], 4); // claims ~64 KB, delivers 30 bytes
    expect(() => validatePhoto(bytes)).toThrow(/truncated/i);
  });

  it("holds the line at 512px, which is what the cropper produces", async () => {
    const { validatePhoto, MAX_EDGE } = await import("@/lib/users/photo");
    expect(validatePhoto(vp8(MAX_EDGE, MAX_EDGE))).toEqual({ width: 512, height: 512 });
    expect(() => validatePhoto(vp8(MAX_EDGE + 1, MAX_EDGE))).toThrow(/512px at most/i);
    expect(() => validatePhoto(vp8l(2000, 2000))).toThrow(/512px at most/i);
    // Below 32px it is a favicon or a mistake, not a face. The reader
    // is now shared with the warehouse gallery, which has its own floor
    // — hence a message that names the number rather than one that says
    // "too small" and leaves the person guessing which number.
    expect(() => validatePhoto(vp8(16, 16))).toThrow(/at least 32px/i);
  });

  it("caps the byte size before anything reaches the CDN", async () => {
    const { validatePhoto, MAX_BYTES } = await import("@/lib/users/photo");
    const huge = new Uint8Array(MAX_BYTES + 1);
    huge.set(vp8(512, 512), 0);
    expect(() => validatePhoto(huge)).toThrow(/over \d+ KB/);
    expect(() => validatePhoto(new Uint8Array(0))).toThrow(/No image/i);
  });
});

// ── The Bunny client, against a server that speaks its protocol ────

const seen: { method: string; url: string; accessKey: string | null; contentType: string | null; body: number }[] = [];
let server: Server;
let origin = "";

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({
        method: req.method ?? "",
        url: req.url ?? "",
        accessKey: (req.headers.accesskey as string | undefined) ?? null,
        contentType: req.headers["content-type"] ?? null,
        body: Buffer.concat(chunks).length,
      });
      // One path answers 404 so the "already gone counts as gone" rule
      // has something to be true about.
      if ((req.url ?? "").includes("missing")) {
        res.writeHead(404).end("Not found");
        return;
      }
      res.writeHead(201).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;

  process.env.BUNNY_STORAGE_ZONE = "test-zone";
  process.env.BUNNY_STORAGE_KEY = "test-access-key";
  process.env.BUNNY_STORAGE_URL = origin;
  process.env.BUNNY_CDN_URL = "https://cdn.example.test";
  process.env.BUNNY_PHOTO_FOLDER = "wms/profile-photo";
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("talking to Bunny Storage", () => {
  it("PUTs to {storage}/{zone}/{key} with the AccessKey in a header", async () => {
    const { putObject } = await import("@/lib/storage/bunny");
    seen.length = 0;
    const result = await putObject("wms/profile-photo/u7-abc.webp", vp8(512, 512), "image/webp");
    expect(result).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      method: "PUT",
      url: "/test-zone/wms/profile-photo/u7-abc.webp",
      accessKey: "test-access-key",
      contentType: "image/webp",
    });
    expect(seen[0]!.body).toBeGreaterThan(0);
  });

  it("DELETEs the same URL, and treats a file that is already gone as gone", async () => {
    const { deleteObject } = await import("@/lib/storage/bunny");
    seen.length = 0;
    expect(await deleteObject("wms/profile-photo/u7-abc.webp")).toEqual({ ok: true });
    expect(seen[0]).toMatchObject({ method: "DELETE", url: "/test-zone/wms/profile-photo/u7-abc.webp" });
    // 404 from Bunny — the intent "this should not exist" is satisfied.
    expect(await deleteObject("wms/profile-photo/missing.webp")).toEqual({ ok: true });
  });

  it("refuses to build a key out of traversal or empty segments", async () => {
    const { putObject } = await import("@/lib/storage/bunny");
    seen.length = 0;
    await putObject("wms//profile-photo/../../etc/passwd", vp8(512, 512), "image/webp");
    expect(seen[0]!.url).toBe("/test-zone/wms/profile-photo/etc/passwd");
  });
});

describe("finding our own file inside a stored URL", () => {
  it("recognises a URL it wrote", async () => {
    const { keyFromUrl, publicUrl } = await import("@/lib/storage/bunny");
    const url = publicUrl("wms/profile-photo/u7-abc.webp");
    expect(url).toBe("https://cdn.example.test/wms/profile-photo/u7-abc.webp");
    expect(keyFromUrl(url)).toBe("wms/profile-photo/u7-abc.webp");
  });

  it("reads the key and the endpoint under either naming convention", async () => {
    // This repo's .env.example and the tutorial the upload path came
    // from name these differently. Whichever pair a deployment holds has
    // to work, or the symptom is a bare 401 from Bunny in production.
    vi.resetModules();
    const saved = { ...process.env };
    delete process.env.BUNNY_STORAGE_KEY;
    delete process.env.BUNNY_STORAGE_URL;
    delete process.env.BUNNY_CDN_URL;
    process.env.BUNNY_STORAGE_ACCESS_KEY = "other-name-key";
    process.env.BUNNY_STORAGE_HOSTNAME = "sg.storage.bunnycdn.com";
    process.env.NEXT_PUBLIC_BUNNY_CDN_URL = "https://cdn.example.test";

    const mod = await import("@/lib/storage/bunny");
    expect(mod.configured()).toBe(true);
    expect(mod.publicUrl("wms/profile-photo/x.webp")).toBe(
      "https://cdn.example.test/wms/profile-photo/x.webp",
    );

    // And a bare region code builds the same hostname.
    vi.resetModules();
    delete process.env.BUNNY_STORAGE_HOSTNAME;
    process.env.BUNNY_STORAGE_REGION = "sg";
    expect((await import("@/lib/storage/bunny")).configured()).toBe(true);

    process.env = saved;
    vi.resetModules();
  });

  it("will not delete somebody else's host, or anything outside its own folder", async () => {
    const { keyFromUrl } = await import("@/lib/storage/bunny");
    // A photo_url pointing elsewhere is not ours to remove — answering
    // null leaves the stranger's file alone.
    expect(keyFromUrl("https://evil.example/wms/profile-photo/u7.webp")).toBeNull();
    // Right host, wrong folder: still not ours.
    expect(keyFromUrl("https://cdn.example.test/invoices/2026/march.pdf")).toBeNull();
    expect(keyFromUrl(null)).toBeNull();
    expect(keyFromUrl("")).toBeNull();
  });
});
