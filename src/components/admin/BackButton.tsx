"use client";

import { useRouter } from "next/navigation";

/**
 * The ← before a page title: back to where the person came from, or to
 * [fallback] when the page was opened directly (a bookmark, a new tab).
 */
export default function BackButton({ fallback, label = "Back" }: { fallback: string; label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      id="page-back"
      aria-label={label}
      title={label}
      onClick={() => {
        const sameSite = (() => {
          try {
            return !!document.referrer && new URL(document.referrer).origin === window.location.origin;
          } catch {
            return false;
          }
        })();
        if (sameSite && window.history.length > 1) router.back();
        else router.push(fallback);
      }}
      className="text-sm text-verdigris-200/60 hover:text-patina"
    >
      ←
    </button>
  );
}
