"use client";

/** Shared by the scan station and the store station: the beep, and an id
 *  per scan so a resend after a dropped connection is never counted twice. */

export function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const tone = (freq: number, start: number, len: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      o.type = ok ? "sine" : "square";
      g.gain.value = 0.15;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + start);
      o.stop(ctx.currentTime + start + len);
    };
    if (ok) tone(1046, 0, 0.12);
    else {
      tone(220, 0, 0.16);
      tone(220, 0.22, 0.16);
    }
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* no audio: the colour still says it */
  }
}

export const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Keep the cursor in the scan box — a scanner types wherever focus is —
 * without ever taking it from something the person is using. A click on
 * a dropdown, a text box or anything inside a dialog leaves focus where
 * it is: grabbing it back closed the warehouse and gala dropdowns the
 * moment they opened. After a dropdown is changed, focus returns to the
 * box by itself (its `change` fires and the next click elsewhere does).
 */
export function keepScanFocus(box: { current: HTMLInputElement | null }, paused: () => boolean = () => false) {
  const busy = (el: Element | null) =>
    !!el &&
    (el.matches("select, textarea, input:not([type=checkbox]):not([type=radio]), [contenteditable=true], option, optgroup") ||
      !!el.closest("[role=dialog], [role=alertdialog], dialog, select"));
  const refocus = (e?: Event) => {
    if (paused()) return;
    const target = (e?.target as Element | null) ?? null;
    if (target === box.current) return;
    if (busy(target)) return;
    setTimeout(() => {
      if (paused()) return;
      if (busy(document.activeElement) && document.activeElement !== box.current) return;
      box.current?.focus();
    }, 0);
  };
  // A dropdown just changed: back to the box for the next scan.
  const changed = (e: Event) => {
    if ((e.target as Element | null)?.matches("select") && !paused()) setTimeout(() => box.current?.focus(), 0);
  };
  refocus();
  window.addEventListener("click", refocus);
  window.addEventListener("change", changed);
  return () => {
    window.removeEventListener("click", refocus);
    window.removeEventListener("change", changed);
  };
}
