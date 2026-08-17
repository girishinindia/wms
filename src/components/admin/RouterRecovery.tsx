"use client";

import { useEffect } from "react";

/**
 * Surviving a deploy that happens while the panel is open.
 *
 * Next fingerprints every client chunk, and a deploy replaces them all.
 * A tab that was loaded from the previous build still holds the previous
 * filenames, and those now 404 — so the first `<Link>` click after a
 * deploy asks for a file that is gone. The router cannot complete the
 * navigation and gives up. Nothing is thrown into the console, the URL
 * does not move, and the page simply does not respond to the menu. It
 * reads exactly like a broken link, which is how it was reported.
 *
 * Typing the URL works throughout, because that is a fresh server
 * render with a fresh set of chunk names — which is the tell.
 *
 * The fix is not to prevent the skew, which is inherent to shipping, but
 * to fall back to what a browser did before client routing existed: ask
 * the server for the page. `rememberIntent` records where the user was
 * trying to go, so the recovery lands on the page they clicked rather
 * than reloading the one they are stuck on.
 */

let intent: { href: string; at: number } | null = null;

/** Called by the sidebar just before a client navigation starts. */
export function rememberIntent(href: string): void {
  intent = { href, at: Date.now() };
}

const CHUNK_ERROR =
  /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i;

/** One recovery per tab. Without this a chunk that 404s on the fresh
 *  load too would reload forever. */
const GUARD = "wms.admin.recovered";

export default function RouterRecovery() {
  useEffect(() => {
    function recover(reason: unknown) {
      const text =
        reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason ?? "");
      if (!CHUNK_ERROR.test(text)) return;

      if (sessionStorage.getItem(GUARD)) return;
      sessionStorage.setItem(GUARD, "1");

      // Within a few seconds of a click, the click is what failed.
      const recent = intent && Date.now() - intent.at < 10_000 ? intent.href : null;
      if (recent) window.location.assign(recent);
      else window.location.reload();
    }

    const onError = (event: ErrorEvent) => recover(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => recover(event.reason);

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    // A navigation that completes means the chunks are fine, so the
    // guard should not persist and block a genuine recovery later.
    sessionStorage.removeItem(GUARD);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
