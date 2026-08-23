"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PaperclipIcon, TrashIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";
import { encodeToWebp, supportsWebp } from "@/lib/images/client";

/**
 * Files hanging off one row — receipts on an expense.
 *
 * A photo is converted to WebP in the browser before it is sent, the
 * same way the warehouse gallery does it: a phone snap is four megabytes
 * and 4000px wide, and the four megabytes never need to cross the
 * network at all. A PDF goes as it is, because there is nothing useful
 * to do to one client-side.
 *
 * Generic on purpose — it knows an endpoint and what the picker accepts,
 * nothing about expenses.
 */

export type Attachment = {
  id: number;
  url: string;
  contentType: string;
  bytes: number;
  originalName: string | null;
  createdAt: string;
};

const MAX_BYTES = 5 * 1024 * 1024;
const WEBP_MAX_EDGE = 2000;

const readable = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

export default function AttachmentPanel({
  endpoint,
  label,
  hint,
  accept,
  readOnly = false,
  onCountChange,
}: {
  /** Already resolved — `/admin/expenses/12/receipts`. */
  endpoint: string;
  label: string;
  hint: string;
  accept: string;
  readOnly?: boolean;
  onCountChange?: (n: number) => void;
}) {
  const toast = useToast();
  const picker = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<Attachment[] | null>(null);
  const [busy, setBusy] = useState<"load" | "upload" | number | null>("load");

  const load = useCallback(async () => {
    const result = await api<{ receipts: Attachment[] }>(endpoint, { method: "GET" });
    setBusy(null);
    if (!result.ok) {
      setItems([]);
      return;
    }
    setItems(result.data.receipts);
    onCountChange?.(result.data.receipts.length);
    // `onCountChange` is a parent callback and would re-run this on
    // every render if it were a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy("upload");
    const failures: string[] = [];
    let added = 0;

    for (const file of [...files]) {
      try {
        let blob: Blob;
        let type: string;

        if (file.type === "application/pdf") {
          if (file.size > MAX_BYTES) {
            failures.push(`${file.name} is over 5 MB`);
            continue;
          }
          blob = file;
          type = "application/pdf";
        } else if (file.type.startsWith("image/")) {
          if (!supportsWebp()) {
            failures.push("This browser cannot make WebP images — attach a PDF instead");
            continue;
          }
          ({ blob } = await encodeToWebp(file, WEBP_MAX_EDGE));
          type = "image/webp";
        } else {
          failures.push(`${file.name} is not an image or a PDF`);
          continue;
        }

        const response = await fetch(`/api/v1${endpoint}`, {
          method: "POST",
          headers: { "content-type": type, "x-file-name": encodeURIComponent(file.name) },
          credentials: "same-origin",
          body: blob,
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          failures.push(`${file.name}: ${payload?.error?.message ?? "upload failed"}`);
          continue;
        }
        added += 1;
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : "could not be read"}`);
      }
    }

    if (picker.current) picker.current.value = "";
    if (added > 0) {
      toast.success(`${added} ${added === 1 ? "file" : "files"} attached.`);
      await load();
    } else {
      setBusy(null);
    }
    // Named rather than counted: "2 failed" leaves somebody guessing which two.
    if (failures.length > 0) toast.error(failures.slice(0, 2).join(" · "));
  }

  async function remove(item: Attachment) {
    setBusy(item.id);
    const result = await api(`${endpoint}/${item.id}`, { method: "DELETE" });
    if (!result.ok) {
      setBusy(null);
      toast.error(result.error.message);
      return;
    }
    toast.success("Removed.");
    await load();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[0.84rem] font-medium text-verdigris-200/70">{label}</span>
        {readOnly ? null : (
          <button
            type="button"
            onClick={() => picker.current?.click()}
            disabled={busy === "upload"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-verdigris-300/20 px-3 py-1 text-xs text-verdigris-100 transition-colors hover:border-verdigris-300/45 disabled:opacity-55"
          >
            {busy === "upload" ? <Spinner className="h-3 w-3" /> : <PaperclipIcon className="h-3.5 w-3.5" />}
            Attach
          </button>
        )}
      </div>

      <input
        ref={picker}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => void upload(e.target.files)}
      />

      {busy === "load" ? (
        <p className="mt-2 text-xs text-verdigris-200/45">Loading…</p>
      ) : (items?.length ?? 0) === 0 ? (
        <p className="mt-2 text-xs text-amber-300/80">
          Nothing attached yet. {hint}
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items!.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-lg border border-verdigris-300/12 bg-ink-900/40 px-3 py-2"
            >
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-xs text-verdigris-100 hover:text-patina"
                title={item.originalName ?? item.url}
              >
                {item.originalName
                  ? decodeURIComponent(item.originalName)
                  : item.contentType === "application/pdf"
                    ? "Receipt (PDF)"
                    : "Receipt (image)"}
              </a>
              <span className="shrink-0 text-[0.7rem] text-verdigris-200/40">
                {readable(item.bytes)}
              </span>
              {readOnly ? null : (
                <button
                  type="button"
                  aria-label={`Remove ${item.originalName ?? "receipt"}`}
                  onClick={() => void remove(item)}
                  disabled={busy === item.id}
                  className="shrink-0 rounded-md p-1 text-verdigris-200/55 transition-colors hover:text-rose-300 disabled:opacity-50"
                >
                  {busy === item.id ? <Spinner className="h-3.5 w-3.5" /> : <TrashIcon className="h-3.5 w-3.5" />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
