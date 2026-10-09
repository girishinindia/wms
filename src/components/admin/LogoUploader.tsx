"use client";

import { useRef, useState } from "react";

import { initials } from "@/lib/inward/carton-format";
import { useToast } from "@/components/Toast";

/**
 * The importer's logo — printed on every carton sticker. Shrunk in the
 * browser (max 512 px, WebP keeps transparency) before it goes up.
 */
export default function LogoUploader({
  endpoint,
  initial,
  name,
  readOnly = false,
}: {
  /** /importer/me/logo for the importer, /admin/importers/{id}/logo for the super admin. */
  endpoint: string;
  initial: string | null;
  name: string;
  readOnly?: boolean;
}) {
  const toast = useToast();
  const [url, setUrl] = useState(initial);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const shrink = async (blob: Blob): Promise<Blob> => {
    try {
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * scale));
      c.height = Math.max(1, Math.round(bmp.height * scale));
      c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      const out = await new Promise<Blob | null>((r) => c.toBlob(r, "image/webp", 0.9));
      return out && out.size < blob.size ? out : blob;
    } catch {
      return blob;
    }
  };

  const upload = async (f: File) => {
    if (!f.type.startsWith("image/")) {
      toast.error("Choose a picture (JPG, PNG or WebP).");
      return;
    }
    setBusy(true);
    try {
      const body = await shrink(f);
      const res = await fetch(`/api/v1${endpoint}`, { method: "POST", body, credentials: "same-origin" });
      const json = (await res.json().catch(() => null)) as { logoUrl?: string; error?: { message: string } } | null;
      if (!res.ok || !json?.logoUrl) {
        toast.error(json?.error?.message ?? "The logo could not be saved.");
        return;
      }
      setUrl(json.logoUrl);
      toast.success("Logo saved — it prints on every carton sticker.");
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    const res = await fetch(`/api/v1${endpoint}`, { method: "DELETE", credentials: "same-origin" });
    setBusy(false);
    if (res.ok) {
      setUrl(null);
      toast.success("Logo removed — stickers show the initials.");
    } else toast.error("The logo could not be removed.");
  };

  return (
    <section className="rounded-2xl border border-verdigris-300/10 bg-ink-850 p-5 card-shadow" id="company-logo">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Logo on carton stickers</p>
      <div className="mt-3 flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-verdigris-300/15 bg-white">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={`${name} logo`} className="h-full w-full object-contain" />
          ) : (
            <span className="text-lg font-bold text-neutral-800">{initials(name)}</span>
          )}
        </div>
        {readOnly ? (
          <p className="text-xs text-verdigris-200/55">{url ? "Printed on every sticker." : "No logo yet — stickers show the initials."}</p>
        ) : (
          <div className="flex flex-col items-start gap-1.5">
            <input ref={file} type="file" accept="image/*" className="sr-only" id="logo-file" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <button type="button" disabled={busy} onClick={() => file.current?.click()} className="rounded-lg border border-verdigris-300/25 px-3 py-1.5 text-xs font-medium text-verdigris-100 hover:border-patina/50 disabled:opacity-50">
              {busy ? "Saving…" : url ? "Replace logo" : "Upload logo"}
            </button>
            {url ? (
              <button type="button" disabled={busy} onClick={remove} className="text-xs text-verdigris-200/50 hover:text-rose-300">
                Remove
              </button>
            ) : (
              <p className="text-[11px] text-verdigris-200/45">Square works best. Until then, stickers show the initials.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
