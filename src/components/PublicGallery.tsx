"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { XIcon } from "@/components/icons";
import type { PublicWarehousePhoto } from "@/lib/warehouses/public";

/**
 * A warehouse's photographs, for a visitor.
 *
 * A separate component from the admin's `GalleryGrid` rather than that
 * one with an `editable` prop. The admin version knows how to upload and
 * how to delete, and the way a flag like that goes wrong is that it
 * defaults to the permissive value on some path nobody tested. There is
 * no delete button here to leave switched on, because there is no delete
 * button in the file.
 *
 * Same keys as the admin viewer — arrows walk, Escape leaves — because
 * they are the keys anybody already tries in a photo viewer.
 */
export default function PublicGallery({
  photos,
  name,
}: {
  photos: PublicWarehousePhoto[];
  name: string;
}) {
  const [open, setOpen] = useState<number | null>(null);

  const show = useCallback(
    (i: number) => setOpen(((i % photos.length) + photos.length) % photos.length),
    [photos.length],
  );

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") show(open + 1);
      if (e.key === "ArrowLeft") show(open - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, show]);

  if (photos.length === 0) return null;

  const current = open === null ? null : photos[open] ?? null;

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {photos.map((photo, i) => (
          <button
            key={photo.url}
            type="button"
            onClick={() => show(i)}
            aria-label={`Open photo ${i + 1} of ${photos.length} of ${name}`}
            className="group relative aspect-[4/3] overflow-hidden rounded-2xl border border-verdigris-300/10 bg-ink-900/50 transition-colors hover:border-verdigris-300/30 focus:outline-none focus-visible:border-verdigris-300/50"
          >
            <Image
              src={photo.url}
              alt={photo.caption ?? `${name} — photograph ${i + 1}`}
              width={photo.width}
              height={photo.height}
              unoptimized
              // The first two are what somebody sees before scrolling.
              loading={i < 2 ? "eager" : "lazy"}
              sizes="(max-width: 640px) 50vw, 33vw"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
            />
          </button>
        ))}
      </div>

      {current
        ? createPortal(
            <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(null)}
                className="absolute inset-0 bg-ink-900/92 backdrop-blur-sm"
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label={`${name} — photograph ${open! + 1} of ${photos.length}`}
                className="relative max-h-full"
              >
                <Image
                  src={current.url}
                  alt={current.caption ?? `${name} — photograph ${open! + 1}`}
                  width={current.width}
                  height={current.height}
                  unoptimized
                  className="max-h-[82vh] w-auto rounded-2xl object-contain"
                />
                <div className="mt-4 flex items-center justify-between gap-4">
                  <span className="font-mono text-xs text-verdigris-200/70">
                    {open! + 1} / {photos.length}
                    {current.caption ? ` · ${current.caption}` : ""}
                  </span>
                  <span className="flex items-center gap-2">
                    {photos.length > 1 ? (
                      <>
                        <button
                          type="button"
                          onClick={() => show(open! - 1)}
                          aria-label="Previous photo"
                          className="rounded-lg border border-verdigris-300/20 px-3 py-1.5 text-sm text-verdigris-100 transition-colors hover:border-verdigris-300/45"
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          onClick={() => show(open! + 1)}
                          aria-label="Next photo"
                          className="rounded-lg border border-verdigris-300/20 px-3 py-1.5 text-sm text-verdigris-100 transition-colors hover:border-verdigris-300/45"
                        >
                          →
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setOpen(null)}
                      aria-label="Close"
                      className="inline-grid h-9 w-9 place-items-center rounded-lg border border-verdigris-300/20 text-verdigris-100 transition-colors hover:border-verdigris-300/45"
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
    </>
  );
}
