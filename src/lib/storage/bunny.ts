import "server-only";

import { bunnyEnv } from "@/lib/env";

/**
 * Bunny Edge Storage, the three calls we actually use.
 *
 * The whole API is one URL shape with an `AccessKey` header:
 *
 *   PUT     {storage}/{zone}/{key}   body: bytes    → write
 *   DELETE  {storage}/{zone}/{key}                  → remove
 *   GET     {cdn}/{key}                             → what the world sees
 *
 * The key is a write credential for the entire zone, so it lives here
 * and only here — the browser sends its bytes to our route, and our
 * route talks to Bunny. A signed direct-to-Bunny upload would be faster
 * and would also mean handing a zone-wide key to a form.
 *
 * Missing configuration is not a crash. `configured()` answers false and
 * the callers say so in words, the same way the Redis client falls
 * through to Postgres rather than taking the request down with it.
 */

export type BunnyResult = { ok: true } | { ok: false; status: number; detail: string };

/** Trailing slashes off, so joining is unambiguous. */
const trim = (s: string | undefined) => (s ?? "").trim().replace(/\/+$/, "");
const first = (...values: (string | undefined)[]) => values.map(trim).find((v) => v !== "") ?? "";

/**
 * Two naming conventions reach the same four values.
 *
 * `.env.example` in this repo was written around
 * `BUNNY_STORAGE_ACCESS_KEY` and `BUNNY_STORAGE_HOSTNAME`; the tutorial
 * the upload path was modelled on uses `BUNNY_STORAGE_KEY` and
 * `BUNNY_STORAGE_URL`. Both are accepted, because the failure mode of
 * picking one is a 401 from Bunny in production with nothing on screen
 * to explain it.
 */
function config() {
  const env = bunnyEnv();
  const host = first(env.BUNNY_STORAGE_HOSTNAME);
  const region = first(env.BUNNY_STORAGE_REGION);
  const storage =
    first(env.BUNNY_STORAGE_URL) ||
    (host ? (host.startsWith("http") ? host : `https://${host}`) : "") ||
    (region ? `https://${region}.storage.bunnycdn.com` : "");

  return {
    zone: first(env.BUNNY_STORAGE_ZONE),
    key: first(env.BUNNY_STORAGE_KEY, env.BUNNY_STORAGE_ACCESS_KEY),
    storage: trim(storage),
    cdn: first(env.BUNNY_CDN_URL, env.NEXT_PUBLIC_BUNNY_CDN_URL),
    folder: trim(env.BUNNY_PHOTO_FOLDER).replace(/^\/+/, ""),
  };
}

export function configured(): boolean {
  const c = config();
  return Boolean(c.zone && c.key && c.storage && c.cdn);
}

/** The folder every profile photo is written under, no slashes either end. */
export function photoFolder(): string {
  return config().folder;
}

/**
 * A storage key is a path inside the zone. Normalised hard, because it
 * is built from an id and random bytes but goes into a URL: no leading
 * slash, no `..`, no doubled separators.
 */
function normaliseKey(key: string): string {
  const clean = key
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "." && part !== "..")
    .join("/");
  if (clean === "") throw new Error("bunny: empty storage key");
  return clean;
}

/** What a browser fetches. */
export function publicUrl(key: string): string {
  return `${config().cdn}/${normaliseKey(key)}`;
}

/**
 * The reverse: the storage key inside a URL we stored earlier, or null
 * when it points somewhere else.
 *
 * Used to delete the photo being replaced. Deliberately strict — a URL
 * from another host is not ours to delete, and answering null means the
 * old file is left alone rather than a stranger's being removed.
 */
export function keyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const cdn = config().cdn;
  if (!cdn || !url.startsWith(`${cdn}/`)) return null;
  const key = url.slice(cdn.length + 1).split("?")[0] ?? "";
  const folder = config().folder;
  // Only ever inside our own folder, whatever the rest of the URL says.
  if (folder && !key.startsWith(`${folder}/`)) return null;
  try {
    return normaliseKey(key);
  } catch {
    return null;
  }
}

async function call(method: "PUT" | "DELETE", key: string, body?: Uint8Array, contentType?: string): Promise<BunnyResult> {
  const c = config();
  if (!configured()) return { ok: false, status: 503, detail: "Bunny Storage is not configured" };

  const url = `${c.storage}/${c.zone}/${normaliseKey(key)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        AccessKey: c.key,
        ...(contentType ? { "Content-Type": contentType } : {}),
      },
      ...(body ? { body: body as unknown as BodyInit } : {}),
      cache: "no-store",
    });
  } catch (error) {
    return { ok: false, status: 0, detail: error instanceof Error ? error.message : "network error" };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { ok: false, status: response.status, detail: detail.slice(0, 300) };
  }
  return { ok: true };
}

export async function putObject(key: string, bytes: Uint8Array, contentType: string): Promise<BunnyResult> {
  return call("PUT", key, bytes, contentType);
}

/**
 * Remove one object.
 *
 * A 404 counts as success: the caller's intent is "this file should not
 * exist", and a file that never existed already satisfies it. Treating
 * it as failure would make replacing a photo whose file was cleaned up
 * by hand impossible.
 */
export async function deleteObject(key: string): Promise<BunnyResult> {
  const result = await call("DELETE", key);
  if (!result.ok && result.status === 404) return { ok: true };
  return result;
}
