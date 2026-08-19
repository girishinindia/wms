"use client";

import { useEffect } from "react";

/**
 * What the admin area shows when a page fails to render.
 *
 * There was no boundary here, and its absence is part of why "I click
 * the menu and nothing happens" was so hard to pin down. Without one, a
 * server component that throws during a client-side navigation takes the
 * navigation down with it: React has nowhere to put the error, the
 * router keeps the page you were already on, and nothing is printed. The
 * symptom is a dead menu item, which points at the link rather than at
 * the page behind it.
 *
 * With a boundary the failure has somewhere to go, and says which page
 * and why.
 *
 * `reset()` re-renders the segment, which is the right first try for
 * anything transient — a database connection that was briefly gone. The
 * full reload is the second try, because it also replaces the tab's
 * JavaScript, which is what to do when the deployment has moved on.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is what ties this to the server log entry; without it
    // an operator has a screenshot and no way to find the cause.
    console.error("[admin] page failed to render", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="grid min-h-[60vh] place-items-center px-6">
      <div className="max-w-lg rounded-2xl border border-rose-400/25 bg-rose-500/[0.06] p-8 text-center">
        <h1 className="text-lg font-semibold text-verdigris-50">This screen did not load</h1>
        <p className="mt-2 text-sm text-verdigris-200/70">
          The rest of the panel still works — use the menu to go somewhere else, or try again.
        </p>

        {error.digest ? (
          <p className="mt-4 font-mono text-[0.78rem] text-verdigris-200/45">
            Reference {error.digest}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-xl bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-xl border border-verdigris-300/20 px-5 py-2.5 text-sm text-verdigris-100 transition-colors hover:border-verdigris-300/45"
          >
            Reload the page
          </button>
        </div>
      </div>
    </div>
  );
}
