"use client";

import { useEffect, useState } from "react";

type State = "checking" | "ok" | "down";

/**
 * Live pill that pings /api/health. Doubles as a public status
 * indicator and as visible proof the API layer is actually running.
 */
export default function HealthBadge() {
  const [state, setState] = useState<State>("checking");
  const [region, setRegion] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    const check = async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        const res = await fetch("/api/health", {
          cache: "no-store",
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!alive) return;
        if (!res.ok) {
          setState("down");
          return;
        }
        const data = (await res.json()) as { region?: string };
        setState("ok");
        setRegion(data.region ?? null);
      } catch {
        if (alive) setState("down");
      }
    };

    check();
    const id = setInterval(check, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const dot =
    state === "ok"
      ? "bg-patina"
      : state === "down"
        ? "bg-amber-400"
        : "bg-verdigris-400";

  const label =
    state === "ok"
      ? `API operational${region && region !== "local" ? ` · ${region}` : ""}`
      : state === "down"
        ? "API unreachable"
        : "Checking API…";

  return (
    <div
      className="glass inline-flex items-center gap-2.5 rounded-full px-3.5 py-1.5"
      role="status"
      aria-live="polite"
    >
      <span className="relative flex h-2 w-2">
        {state === "ok" && (
          <span className="absolute inline-flex h-full w-full animate-pulse-soft rounded-full bg-patina" />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`} />
      </span>
      <span className="font-mono text-[11px] tracking-wide text-verdigris-200">
        {label}
      </span>
    </div>
  );
}
