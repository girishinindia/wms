"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CameraIcon, RotateIcon, XIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";

import { loadImageSource, supportsWebp, type ImageSource } from "@/lib/images/client";

import Avatar from "./Avatar";

/**
 * Choose a picture, frame it, and send it.
 *
 * The cropping, the rotation and the WebP encoding all happen here, on a
 * canvas, and that is deliberate: it is a direct-manipulation job — you
 * drag until it looks right — so the machine that knows what "right"
 * looks like is the one in front of the person. It also means a 4 MB
 * phone photo never crosses the network; what leaves the browser is the
 * 512px square that was actually chosen, usually about 30 KB.
 *
 * The preview and the file are drawn by the SAME function at two sizes,
 * so the crop that was accepted is the crop that gets saved. Two
 * separate pieces of geometry — one for showing, one for exporting — is
 * how a cropper ends up shipping a picture nobody framed.
 */

/** What the person drags in. */
const VIEW = 288;
/** What is stored. Matches MAX_EDGE on the server. */
const OUT = 512;
const QUALITY = 0.82;

type Source = ImageSource;

/** Rotated extent of the source, in source pixels. */
function extent(src: Source, rotation: number) {
  const swapped = rotation % 180 !== 0;
  return { w: swapped ? src.height : src.width, h: swapped ? src.width : src.height };
}

/** The one piece of geometry, used for the preview and the export. */
function paint(
  ctx: CanvasRenderingContext2D,
  src: Source,
  square: number,
  zoom: number,
  rotation: number,
  ox: number,
  oy: number,
) {
  const { w, h } = extent(src, rotation);
  // At zoom 1 the shorter side exactly fills the square, so the frame is
  // always covered and there is never a bald corner to drag into.
  const scale = (square / Math.min(w, h)) * zoom;

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, square, square);
  ctx.translate(square / 2 + ox, square / 2 + oy);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    src.image,
    (-src.width * scale) / 2,
    (-src.height * scale) / 2,
    src.width * scale,
    src.height * scale,
  );
  ctx.restore();
}

/** How far the picture may be pushed before the frame would show through. */
function limits(src: Source, square: number, zoom: number, rotation: number) {
  const { w, h } = extent(src, rotation);
  const scale = (square / Math.min(w, h)) * zoom;
  return { x: Math.max(0, (w * scale - square) / 2), y: Math.max(0, (h * scale - square) / 2) };
}

const clamp = (v: number, max: number) => Math.min(max, Math.max(-max, v));

export default function PhotoCropper({
  name,
  photoUrl,
  endpoint,
  size = 96,
  canRemove = true,
  onChanged,
}: {
  name: string;
  photoUrl: string | null;
  /** `/profile/photo` or `/admin/users/12/photo` — POST sets, DELETE clears. */
  endpoint: string;
  size?: number;
  canRemove?: boolean;
  onChanged?: (photoUrl: string | null) => void;
}) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const [src, setSrc] = useState<Source | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<string | null>(photoUrl);

  useEffect(() => setCurrent(photoUrl), [photoUrl]);

  const redraw = useCallback(() => {
    const el = canvas.current;
    if (!el || !src) return;
    const ctx = el.getContext("2d");
    if (ctx) paint(ctx, src, VIEW, zoom, rotation, offset.x, offset.y);
  }, [src, zoom, rotation, offset]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  function close() {
    setSrc(null);
    setZoom(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
    if (fileInput.current) fileInput.current.value = "";
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file.");
      return;
    }
    if (!supportsWebp()) {
      toast.error("This browser cannot make WebP images. Try Chrome, Edge, Firefox, or Safari 16.4 or newer.");
      return;
    }
    try {
      const loaded = await loadImageSource(file);
      setSrc(loaded);
      setZoom(1);
      setRotation(0);
      setOffset({ x: 0, y: 0 });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That file could not be read.");
    }
  }

  /** Keep the picture covering the frame whenever the shape changes. */
  function reclamp(nextZoom: number, nextRotation: number, next: { x: number; y: number }) {
    if (!src) return next;
    const max = limits(src, VIEW, nextZoom, nextRotation);
    return { x: clamp(next.x, max.x), y: clamp(next.y, max.y) };
  }

  function onZoom(value: number) {
    setZoom(value);
    setOffset((o) => reclamp(value, rotation, o));
  }

  function onRotate() {
    const next = (rotation + 90) % 360;
    setRotation(next);
    setOffset((o) => reclamp(zoom, next, o));
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (!d || !src) return;
    setOffset(reclamp(zoom, rotation, { x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }));
  }
  function onPointerUp() {
    drag.current = null;
  }

  async function save() {
    if (!src) return;
    const out = document.createElement("canvas");
    out.width = out.height = OUT;
    const ctx = out.getContext("2d");
    if (!ctx) {
      toast.error("This browser could not prepare the image.");
      return;
    }
    // Same geometry, larger square — the offsets are in preview pixels,
    // so they scale with it.
    const k = OUT / VIEW;
    paint(ctx, src, OUT, zoom, rotation, offset.x * k, offset.y * k);

    const blob = await new Promise<Blob | null>((resolve) =>
      out.toBlob(resolve, "image/webp", QUALITY),
    );
    if (!blob || blob.type !== "image/webp") {
      toast.error("This browser could not make a WebP image.");
      return;
    }

    setBusy(true);
    let response: Response;
    try {
      response = await fetch(`/api/v1${endpoint}`, {
        method: "POST",
        headers: { "content-type": "image/webp" },
        credentials: "same-origin",
        body: blob,
      });
    } catch {
      setBusy(false);
      toast.error("Could not reach the server. Check your connection.");
      return;
    }
    const payload = (await response.json().catch(() => null)) as
      | { photoUrl?: string; error?: { message?: string } }
      | null;
    setBusy(false);

    if (!response.ok || !payload?.photoUrl) {
      toast.error(payload?.error?.message ?? "The photo could not be saved.");
      return;
    }
    setCurrent(payload.photoUrl);
    onChanged?.(payload.photoUrl);
    toast.success("Photo updated.");
    close();
  }

  async function remove() {
    setBusy(true);
    let response: Response;
    try {
      response = await fetch(`/api/v1${endpoint}`, { method: "DELETE", credentials: "same-origin" });
    } catch {
      setBusy(false);
      toast.error("Could not reach the server. Check your connection.");
      return;
    }
    const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    setBusy(false);
    if (!response.ok) {
      toast.error(payload?.error?.message ?? "The photo could not be removed.");
      return;
    }
    setCurrent(null);
    onChanged?.(null);
    toast.success("Photo removed.");
  }

  return (
    <>
      <div className="flex items-center gap-4">
        <div className="relative">
          <Avatar name={name} photoUrl={current} size={size} />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            aria-label="Change photo"
            title="Change photo"
            className="absolute -bottom-1 -right-1 inline-grid h-8 w-8 place-items-center rounded-full border border-verdigris-300/25 bg-ink-850 text-verdigris-200/80 transition-colors hover:border-verdigris-300/55 hover:text-verdigris-50"
          >
            <CameraIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="text-xs text-verdigris-200/55">
          <p>JPEG, PNG, HEIC or WebP. You choose the square; it is saved as a {OUT}px WebP.</p>
          {current && canRemove ? (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="mt-2 rounded-lg border border-rose-400/30 px-3 py-1 text-xs text-rose-200 transition-colors hover:border-rose-400/60 disabled:opacity-50"
            >
              Remove photo
            </button>
          ) : null}
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void choose(e.target.files?.[0])}
      />

      {src
        ? createPortal(
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 text-left">
              <button type="button" aria-label="Cancel" onClick={close} className="absolute inset-0 bg-ink-900/75" />
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Frame your photo"
                className="relative w-full max-w-[min(24rem,100vw)] rounded-2xl border border-verdigris-300/20 bg-ink-850 p-5 card-shadow"
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-verdigris-50">Frame your photo</h2>
                    <p className="mt-0.5 text-xs text-verdigris-200/55">Drag to move, slide to zoom.</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={close}
                    className="inline-grid h-8 w-8 place-items-center rounded-lg border border-verdigris-300/15 text-verdigris-200/75 hover:border-verdigris-300/40 hover:text-verdigris-50"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                </div>

                <div className="mx-auto" style={{ width: VIEW }}>
                  <canvas
                    ref={canvas}
                    width={VIEW}
                    height={VIEW}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    className="w-full cursor-grab touch-none rounded-full border border-verdigris-300/20 active:cursor-grabbing"
                  />
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <label className="flex-1 text-xs text-verdigris-200/70">
                    Zoom
                    <input
                      type="range"
                      min={1}
                      max={4}
                      step={0.01}
                      value={zoom}
                      onChange={(e) => onZoom(Number(e.target.value))}
                      className="mt-1 w-full accent-verdigris-400"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={onRotate}
                    aria-label="Rotate a quarter turn"
                    title="Rotate"
                    className="mt-4 inline-grid h-9 w-9 place-items-center rounded-lg border border-verdigris-300/20 text-verdigris-200/80 hover:border-verdigris-300/50 hover:text-verdigris-50"
                  >
                    <RotateIcon className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    disabled={busy}
                    className="rounded-lg border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-lg bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-patina disabled:opacity-60"
                  >
                    {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
                    Save photo
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
