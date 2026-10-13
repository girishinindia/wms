"use client";

import { useEffect, useState } from "react";

import type { Color, ValueFormat } from "@/lib/insights/types";

/**
 * Colours that read on both the dark panel and the light theme. Meaning
 * keeps its colour across every dashboard: received = teal, dispatched =
 * blue, waiting = amber, failed = rose.
 */
export const PALETTE: Record<Color, string> = {
  teal: "#2bb39a",
  blue: "#4a8fe0",
  violet: "#8b7cf6",
  amber: "#e0a030",
  rose: "#e0607a",
  slate: "#94a3b8",
  green: "#5bb043",
  cyan: "#38b6c9",
};

/** For donuts and charts without colours of their own, in this order. */
export const ORDER: Color[] = ["teal", "blue", "violet", "amber", "cyan", "rose", "green", "slate"];

export type Theme = { light: boolean; text: string; muted: string; grid: string; surface: string };

function read(): Theme {
  const light = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light";
  return light
    ? { light, text: "#1b3b3a", muted: "#4b6b67", grid: "rgba(16,48,44,0.09)", surface: "#ffffff" }
    : { light, text: "#dff0e8", muted: "rgba(179,214,199,0.7)", grid: "rgba(150,200,187,0.10)", surface: "#0a1b1a" };
}

/** The current theme, updated the moment the sun / moon button is pressed. */
export function useChartTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setTheme(read()));
    obs.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    setTheme(read());
    return () => obs.disconnect();
  }, []);
  return theme;
}

const inr = (v: number, d = 0) => v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: 0 });

/** A value as people read it: 1,23,456 · ₹12,500 · 42% · 3.4 h · 5 days. */
export function fmt(v: number, f: ValueFormat | undefined = "int", short = false): string {
  if (!Number.isFinite(v)) return "—";
  switch (f) {
    case "money":
      if (short && Math.abs(v) >= 1e7) return `₹${inr(v / 1e7, 1)} Cr`;
      if (short && Math.abs(v) >= 1e5) return `₹${inr(v / 1e5, 1)} L`;
      return `₹${inr(v)}`;
    case "pct":
      return `${inr(v, 1)}%`;
    case "hours":
      return `${inr(v, 1)} h`;
    case "days":
      return `${inr(v)} day${v === 1 ? "" : "s"}`;
    case "kg":
      return `${inr(v, 1)} kg`;
    default:
      if (short && Math.abs(v) >= 1e5) return `${inr(v / 1e5, 1)} L`;
      return inr(v, 1);
  }
}
