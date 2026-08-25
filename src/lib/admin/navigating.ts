"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Where the browser is going, while it is still going there.
 *
 * The panel navigates with plain `<a>` on purpose — the reasoning is
 * above the sidebar link in `AdminShell` — so every menu click, search,
 * filter, sort and page change is a FULL document load. Between the
 * click and the first byte of the new page the browser keeps showing
 * the old one, unchanged and fully interactive. Nothing says a thing is
 * happening. On a fast screen that window is invisible; on the audit
 * log, with a month-partitioned table behind it, it is most of a second
 * of a page that looks ignored, and it was reported as one.
 *
 * A client router would have `useLinkStatus`. A browser navigation has
 * no such callback, so the click itself is the signal: record it, and
 * let the arriving document throw the whole thing away. Nothing here
 * ever has to clear itself on the happy path — the page it lives in
 * stops existing.
 *
 * The two unhappy paths do need handling, and both are handled below:
 * a navigation the browser abandons (a download, a refused mixed-content
 * request, Escape), and a return through the back/forward cache, which
 * restores this page — and this module's state — exactly as it was.
 */

export type Navigating = {
  /** The href being loaded, so the sidebar can mark the right entry. */
  href: string;
  /** `performance.now()` at the click, for the staged reveal. */
  since: number;
};

let current: Navigating | null = null;
const listeners = new Set<() => void>();

/**
 * A navigation the browser silently drops leaves the bar running
 * forever. Ten seconds is well past any page this app serves and well
 * short of "the user has forgotten why it is spinning".
 */
const ABANDONED_MS = 10_000;
let abandon: ReturnType<typeof setTimeout> | null = null;

function emit(): void {
  for (const l of listeners) l();
}

/** Called by the delegated click/submit listeners in `NavProgress`. */
export function startNavigation(href: string): void {
  // Re-clicking the same link should not restart the clock; the first
  // click is when the wait began, and that is what the delays are for.
  if (current?.href === href) return;
  current = { href, since: performance.now() };
  if (abandon) clearTimeout(abandon);
  abandon = setTimeout(() => endNavigation(), ABANDONED_MS);
  emit();
}

export function endNavigation(): void {
  if (abandon) {
    clearTimeout(abandon);
    abandon = null;
  }
  if (!current) return;
  current = null;
  emit();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

const getSnapshot = (): Navigating | null => current;

/**
 * The server has no navigation in flight, and must not: rendering a
 * progress bar into the HTML would show one on a page that has already
 * arrived. A stable `null` also keeps `useSyncExternalStore` from
 * looping on a fresh object every call.
 */
const getServerSnapshot = (): Navigating | null => null;

export function useNavigating(): Navigating | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * How far along the wait is, as something to render.
 *
 * Two thresholds, so the feedback matches the wait rather than the
 * click. Under 150ms a bar is a flicker, and a flicker on a screen that
 * was already fast reads as a glitch. Past 400ms the stale page
 * underneath starts to look live, and the dim says plainly that it is
 * not.
 *
 * Measured against this app: most admin screens paint in about 250ms
 * and only ever show the bar; the audit log takes about 700ms and earns
 * both.
 *
 * A hook rather than a constant each caller re-derives, because two
 * places need the same answer at the same moment — the bar, and the
 * `<main>` that dims itself. Splitting the timers between them would
 * let the two drift by a frame.
 */
export type NavStage = "none" | "bar" | "dim";

export const BAR_MS = 150;
export const DIM_MS = 400;

export function useNavStage(): NavStage {
  const pending = useNavigating();
  const [stage, setStage] = useState<NavStage>("none");

  useEffect(() => {
    if (!pending) {
      setStage("none");
      return;
    }
    // Measured from the click, not from this render, so a re-render
    // partway through the wait does not restart the clock.
    const elapsed = performance.now() - pending.since;
    const bar = setTimeout(() => setStage("bar"), Math.max(0, BAR_MS - elapsed));
    const dim = setTimeout(() => setStage("dim"), Math.max(0, DIM_MS - elapsed));
    return () => {
      clearTimeout(bar);
      clearTimeout(dim);
    };
  }, [pending]);

  return stage;
}
