"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * The scroll region a table's rows live in.
 *
 * Why this exists at all: `DataTable` wrapped every table in a plain
 * `overflow-x-auto`, and CSS turns that into a scroll container on BOTH
 * axes — if one axis is `visible` and the other is not, `visible`
 * computes to `auto`. So the wrapper became the sticky containing block
 * while never actually scrolling (its `scrollHeight` and `clientHeight`
 * were identical), and a `position: sticky` header had nothing to stick
 * to. Measured on the cities screen: at `scrollY 596` the header sat at
 * `top: -286` — gone.
 *
 * Deleting the wrapper fixes sticky (the same measurement gives
 * `top: 0`) but loses horizontal scrolling, and the Users and Expenses
 * tables overflow a 1500px screen. So the rows get their OWN bounded
 * region instead: one scrollbar, both axes, with the toolbar above and
 * the pager below staying put.
 *
 * ── The height ───────────────────────────────────────────────────
 *
 * Measured at runtime rather than hard-coded. The chrome above and
 * below the rows came out at a consistent 392px across three screens,
 * which is tempting to freeze as `calc(100vh - 24.5rem)` — but it moves
 * when a page subtitle wraps to two lines, when the toolbar wraps on a
 * narrow window, and when the bulk-actions bar appears after a row is
 * ticked. A frozen number leaves the pager half off-screen in exactly
 * those cases, so the box measures its own position instead and watches
 * for anything that changes it.
 */

/** Never smaller than this, however short the window. Below roughly
 *  four rows the box stops being a list and starts being a peephole. */
const MIN_HEIGHT = 288;

/** `useLayoutEffect` warns during SSR; the measurement genuinely needs
 *  to happen before paint, so pick the right one per environment
 *  rather than downgrading to `useEffect` and accepting a flash. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function StickyTableBox({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;

    /**
     * The box's offset in the DOCUMENT, not the viewport.
     *
     * `getBoundingClientRect().top` alone shrinks as the page scrolls,
     * so measuring mid-scroll would give a shorter box, which would
     * make the page scroll further, which would shrink it again. Adding
     * `scrollY` makes the figure independent of where the page happens
     * to be sitting.
     */
    const top = el.getBoundingClientRect().top + window.scrollY;

    /**
     * Everything after the box that still has to be visible — the
     * pager, and anything a screen puts below it — plus the padding at
     * the bottom of the scrolling area.
     */
    let reserve = 0;
    for (let sib = el.nextElementSibling; sib; sib = sib.nextElementSibling) {
      reserve += sib.getBoundingClientRect().height;
    }
    const main = el.closest("main");
    if (main) reserve += Number.parseFloat(getComputedStyle(main).paddingBottom) || 0;

    const available = window.innerHeight - top - reserve;
    el.style.maxHeight = `${Math.max(MIN_HEIGHT, Math.floor(available))}px`;
  }, []);

  useIsomorphicLayoutEffect(() => {
    fit();

    const el = box.current;
    if (!el) return;

    /**
     * Three things move the box and none of them is a window resize:
     * the toolbar wrapping to another line, the bulk-actions bar
     * appearing when a row is ticked, and the pager gaining a digit.
     * One observer over the card catches all three.
     */
    const watched = el.parentElement ?? el;
    const observer = new ResizeObserver(fit);
    observer.observe(watched);
    for (let sib = el.nextElementSibling; sib; sib = sib.nextElementSibling) {
      observer.observe(sib);
    }

    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [fit]);

  return (
    <div
      ref={box}
      /**
       * `overflow-auto` and not `overflow-x-auto`: asking for one axis
       * is what created the problem this component exists to solve.
       * Both axes, deliberately and visibly.
       */
      className={`overflow-auto ${className}`}
    >
      {children}
    </div>
  );
}
