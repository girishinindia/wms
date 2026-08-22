"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { ImageIcon, TrashIcon, XIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";
import { encodeToWebp, supportsWebp } from "@/lib/images/client";
import { GALLERY_LIMITS } from "@/lib/images/webp";

import { Card, ConfirmDialog, Empty } from "./ui";

export type GalleryImage = {
  id: number;
  warehouseId: number;
  url: string;
  caption: string | null;
  width: number;
  height: number;
  bytes: number;
  sortOrder: number;
  createdAt: string;
};

/**
 * One warehouse's photographs.
 *
 * Uploads are resized and re-encoded here, in the browser, before
 * anything is sent: a phone photo is four megabytes and 4000px wide, and
 * what the gallery needs is 1600px and about a hundred kilobytes. Doing
 * it on the server would mean uploading the four megabytes first, over
 * the slowest part of the path.
 *
 * Several files at once are handled one after another rather than all at
 * once — twenty parallel uploads on a site connection is how the last
 * few time out, and a progress count that moves is more use than a
 * spinner that does not.
 */
export default function GalleryGrid({
  warehouseId,
  warehouseName,
  images,
  warehouses,
}: {
  warehouseId: number;
  warehouseName: string;
  images: GalleryImage[];
  warehouses: { id: number; label: string; photos: number }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [confirm, setConfirm] = useState<GalleryImage | null>(null);
  const [removing, setRemoving] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  const show = useCallback(
    (index: number) => setLightbox(((index % images.length) + images.length) % images.length),
    [images.length],
  );

  /** Arrows walk the gallery, Escape leaves it — the keys anybody
   *  already tries in a photo viewer. */
  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowRight") show(lightbox + 1);
      if (e.key === "ArrowLeft") show(lightbox - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, show]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!supportsWebp()) {
      toast.error("This browser cannot make WebP images. Try Chrome, Edge, Firefox, or Safari 16.4 or newer.");
      return;
    }
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) {
      toast.error("Choose image files.");
      return;
    }

    let added = 0;
    const failures: string[] = [];
    for (const [index, file] of list.entries()) {
      setBusy({ done: index, total: list.length });
      try {
        const { blob } = await encodeToWebp(file, GALLERY_LIMITS.maxEdge);
        if (blob.size > GALLERY_LIMITS.maxBytes) {
          failures.push(`${file.name} is still too large after resizing`);
          continue;
        }
        const response = await fetch(`/api/v1/admin/warehouses/${warehouseId}/images`, {
          method: "POST",
          headers: { "content-type": "image/webp" },
          credentials: "same-origin",
          body: blob,
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
          failures.push(`${file.name}: ${payload?.error?.message ?? "upload failed"}`);
          continue;
        }
        added += 1;
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : "could not be read"}`);
      }
    }
    setBusy(null);

    if (added > 0) toast.success(`${added} ${added === 1 ? "photo" : "photos"} added.`);
    // Named, not counted: "3 failed" leaves somebody guessing which three.
    if (failures.length > 0) toast.error(failures.slice(0, 3).join(" · "));
    if (added > 0) router.refresh();
  }

  async function remove() {
    if (!confirm) return;
    setRemoving(true);
    const result = await api(`/admin/warehouses/${warehouseId}/images/${confirm.id}`, { method: "DELETE" });
    setRemoving(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Photo removed.");
    setConfirm(null);
    setLightbox(null);
    router.refresh();
  }

  const current = lightbox === null ? null : images[lightbox] ?? null;

  return (
    <>
      <Card className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <label className="block text-xs font-medium text-verdigris-200/80">
            Warehouse
            <select
              value={String(warehouseId)}
              onChange={(e) => router.push(`/admin/warehouses/gallery?warehouse=${e.target.value}`)}
              className="mt-1.5 w-full min-w-64 rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 pr-8 text-sm text-verdigris-50 focus:outline-none focus:ring-2 focus:ring-patina/40"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id} className="bg-ink-850">
                  {w.label}
                  {w.photos > 0 ? ` (${w.photos})` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina">
            {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
            {busy ? `Uploading ${busy.done + 1} of ${busy.total}…` : "Add photos"}
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={busy !== null}
              className="hidden"
              onChange={(e) => {
                void upload(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>

        <p className="mt-3 text-xs text-verdigris-200/55">
          {warehouseName} · JPEG, PNG, HEIC or WebP. Each is resized to {GALLERY_LIMITS.maxEdge}px on
          its longest side and stored as WebP. Click a photo to see it full size.
        </p>
      </Card>

      <div className="mt-6">
        {images.length === 0 ? (
          <Card>
            <Empty
              title="No photos of this warehouse yet."
              hint="Add a few — the loading bays, the racking, the approach road. They are what somebody who has never been there needs to see."
            />
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((image, index) => (
              <div
                key={image.id}
                className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-verdigris-300/12 bg-ink-900/40"
              >
                <button
                  type="button"
                  onClick={() => show(index)}
                  aria-label={`Open photo ${index + 1} of ${images.length}`}
                  className="block h-full w-full"
                >
                  <Image
                    src={image.url}
                    alt={image.caption ?? `Warehouse photo ${index + 1}`}
                    width={image.width}
                    height={image.height}
                    unoptimized
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirm(image)}
                  aria-label={`Delete photo ${index + 1}`}
                  title="Delete"
                  className="absolute right-2 top-2 inline-grid h-8 w-8 place-items-center rounded-lg border border-rose-400/30 bg-ink-900/80 text-rose-200 opacity-0 transition-opacity hover:border-rose-400/60 focus:opacity-100 group-hover:opacity-100"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
                <span className="pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-ink-900/85 to-transparent px-2.5 py-1.5 font-mono text-[0.68rem] text-verdigris-100/80">
                  {image.width}×{image.height} · {Math.round(image.bytes / 1024)} KB
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {current
        ? createPortal(
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 text-left">
              <button
                type="button"
                aria-label="Close"
                onClick={() => setLightbox(null)}
                className="absolute inset-0 bg-ink-900/90"
              />
              <div role="dialog" aria-modal="true" aria-label="Photo" className="relative max-h-full">
                <Image
                  src={current.url}
                  alt={current.caption ?? "Warehouse photo"}
                  width={current.width}
                  height={current.height}
                  unoptimized
                  className="max-h-[82vh] w-auto rounded-xl object-contain"
                />

                <div className="mt-3 flex items-center justify-between gap-4">
                  <span className="font-mono text-xs text-verdigris-200/70">
                    <ImageIcon className="mr-1.5 inline h-3.5 w-3.5" />
                    {lightbox! + 1} / {images.length} · {current.width}×{current.height} ·{" "}
                    {Math.round(current.bytes / 1024)} KB
                  </span>
                  <span className="flex items-center gap-2">
                    {images.length > 1 ? (
                      <>
                        <button
                          type="button"
                          onClick={() => show(lightbox! - 1)}
                          aria-label="Previous photo"
                          className="rounded-lg border border-verdigris-300/20 px-3 py-1.5 text-sm text-verdigris-100 hover:border-verdigris-300/45"
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          onClick={() => show(lightbox! + 1)}
                          aria-label="Next photo"
                          className="rounded-lg border border-verdigris-300/20 px-3 py-1.5 text-sm text-verdigris-100 hover:border-verdigris-300/45"
                        >
                          →
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setConfirm(current)}
                      className="rounded-lg border border-rose-400/30 px-3 py-1.5 text-sm text-rose-200 hover:border-rose-400/60"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setLightbox(null)}
                      aria-label="Close"
                      className="inline-grid h-9 w-9 place-items-center rounded-lg border border-verdigris-300/20 text-verdigris-100 hover:border-verdigris-300/45"
                    >
                      <XIcon className="h-4 w-4" />
                    </button>
                  </span>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {confirm ? (
        <ConfirmDialog
          title="Delete this photo?"
          message="The file is removed from storage and the record goes with it. There is no undo — the audit log keeps that it happened, not the picture."
          confirmLabel="Delete photo"
          busy={removing}
          onConfirm={remove}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </>
  );
}
