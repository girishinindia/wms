/**
 * Turning a file somebody picked into the WebP the server will accept —
 * in the browser, before anything crosses the network.
 *
 * A phone photo is four megabytes and 4000px wide; what the gallery
 * needs is 1600px and about a hundred kilobytes. Doing that here rather
 * than on the server means the four megabytes are never uploaded at all,
 * on a connection that is usually the slowest part of the whole path.
 */

export type ImageSource = { image: CanvasImageSource; width: number; height: number };

/**
 * Phone photos carry their orientation in EXIF, and `drawImage` ignores
 * it — `createImageBitmap` is the one that applies it. Without this a
 * portrait shot arrives on its side.
 */
export async function loadImageSource(file: File): Promise<ImageSource> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { image: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      /* fall through to the <img> path */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That file could not be read as an image"));
      el.src = url;
    });
    return { image: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Safari only learned `toBlob("image/webp")` in 16.4; anything older
 * hands back a PNG without complaint, which the server then refuses.
 * Better to say so before the upload than after it.
 */
export function supportsWebp(): boolean {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    return c.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  }
}

/**
 * Scale to fit inside `maxEdge` — never up, only down — and encode.
 *
 * Aspect ratio is kept: a warehouse is a wide room and squaring it off
 * would crop out the half somebody wanted to show.
 */
export async function encodeToWebp(
  file: File,
  maxEdge: number,
  quality = 0.82,
): Promise<{ blob: Blob; width: number; height: number }> {
  const src = await loadImageSource(file);
  const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not prepare the image");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src.image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", quality),
  );
  if (!blob || blob.type !== "image/webp") {
    throw new Error("This browser could not make a WebP image");
  }
  return { blob, width, height };
}
