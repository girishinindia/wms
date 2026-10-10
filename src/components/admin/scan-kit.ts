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
