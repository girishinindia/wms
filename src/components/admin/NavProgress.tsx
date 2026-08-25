"use client";

import { useEffect } from "react";

import { endNavigation, startNavigation, useNavStage } from "@/lib/admin/navigating";

/**
 * The bar across the top of the panel while a page is on its way.
 *
 * Every navigation here is a full document load, so there is no router
 * event to hook — the gesture is the only thing that happens on this
 * side of the wait. This listens for the two gestures that cause one:
 *
 *   · a click on an internal link (the sidebar, sort headers, the
 *     pager, Clear, the row links)
 *   · a submit of a GET form (the search box, and the filter selects,
 *     which submit their form on change)
 *
 * Both are caught at the document in the CAPTURE phase, so a handler
 * that stops propagation further down cannot hide the navigation from
 * the bar.
 *
 * Nothing here clears the bar when the page arrives, because nothing
 * needs to: the document is replaced and this component ceases to
 * exist. Only the two ways a navigation can NOT arrive are handled —
 * `pageshow` for a back/forward-cache restore, which brings this page
 * and its state back exactly as they were, and the abandonment timeout
 * inside the store.
 */

/** Whether the click would have navigated this tab at all. */
function navigates(event: MouseEvent, link: HTMLAnchorElement): boolean {
  // A modified click opens a tab or downloads; this page stays put.
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (link.target && link.target !== "_self") return false;
  if (link.hasAttribute("download")) return false;

  const href = link.getAttribute("href");
  if (!href) return false;
  // Anchors, mailto:, tel:, and anything off-site.
  if (href.startsWith("#")) return false;
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  // Same page, same query — the browser does nothing worth reporting.
  if (url.href === window.location.href) return false;
  return true;
}

export default function NavProgress() {
  const stage = useNavStage();

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a");
      if (!link || !(link instanceof HTMLAnchorElement)) return;
      if (!navigates(event, link)) return;
      startNavigation(new URL(link.href, window.location.href).pathname);
    };

    /**
     * The list toolbar is a GET form: the search box, the status
     * filter and every per-module select submit it. `submit` fires for
     * all of them, including Enter in the search box, so one listener
     * covers the lot.
     */
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (event.defaultPrevented) return;
      // A drawer saves over fetch and calls preventDefault; only a form
      // the browser will actually navigate for counts.
      const method = (form.getAttribute("method") ?? "get").toLowerCase();
      if (method !== "get") return;
      startNavigation(form.getAttribute("action") || window.location.pathname);
    };

    /**
     * Coming back through the back/forward cache restores this page
     * frozen mid-navigation, bar and all. `persisted` is how the
     * browser says that is what happened.
     */
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) endNavigation();
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  if (stage === "none") return null;

  /*
   * The bar only. The dim belongs to `<main>`, which is the element
   * that actually knows where the content area is — the sidebar
   * collapses, and an overlay here would have to duplicate that
   * arithmetic and get it wrong the first time somebody changes the
   * layout.
   *
   * Announced as a status rather than as a paragraph that appears:
   * `role="status"` with `aria-live="polite"` is read once, after
   * whatever the reader was already saying, which is the right
   * interruption level for "the next page is coming".
   */
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60]"
    >
      <span className="sr-only">Loading the next page</span>
      <span aria-hidden className="nav-progress block h-0.5 bg-verdigris-400" />
    </div>
  );
}
