"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Toasts, with no dependency.
 *
 * A form that redirects on success without saying anything reads as "did
 * that work?" — the user is on a new page with no acknowledgement that
 * the last one did what it said. And a failure rendered only inside the
 * form is missed entirely once the page has scrolled.
 *
 * Three things this gets right that a naive implementation does not:
 *
 *   - `role="status"` + `aria-live="polite"` for success, `role="alert"`
 *     + `assertive` for errors. A screen reader announces the failure
 *     immediately and does not interrupt for a success.
 *   - Timers are cleared on unmount and on manual dismiss, so a fast
 *     navigation cannot fire setState against a dead component.
 *   - `prefers-reduced-motion` removes the slide, because a message that
 *     animates in is a message some people cannot read.
 */

export type ToastTone = "success" | "error" | "info";

type Toast = { id: number; tone: ToastTone; message: string };

type ToastApi = {
  show: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/** Errors linger; a success has been read by the time it fades. */
const DURATION: Record<ToastTone, number> = {
  success: 4000,
  info: 5000,
  error: 8000,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, message }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DURATION[tone]),
      );
    },
    [dismiss],
  );

  // Every pending timer dies with the provider.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m) => show(m, "success"),
      error: (m) => show(m, "error"),
      info: (m) => show(m, "info"),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
        // The region itself is a landmark; each toast carries its own
        // live semantics so the tone decides how loudly it announces.
        aria-live="polite"
        aria-relevant="additions"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const TONE_STYLES: Record<ToastTone, string> = {
  success: "border-verdigris-300/40 bg-verdigris-500/15 text-verdigris-50",
  error: "border-rose-400/40 bg-rose-500/15 text-rose-100",
  info: "border-verdigris-300/25 bg-ink-900/90 text-verdigris-100",
};

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      aria-live={toast.tone === "error" ? "assertive" : "polite"}
      className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg shadow-black/30 backdrop-blur motion-safe:animate-[toast-in_180ms_ease-out] ${TONE_STYLES[toast.tone]}`}
    >
      <span aria-hidden className="mt-0.5 shrink-0">
        {toast.tone === "success" ? <TickIcon /> : toast.tone === "error" ? <CrossIcon /> : <DotIcon />}
      </span>
      <p className="flex-1 leading-relaxed">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 shrink-0 rounded p-1 opacity-60 transition hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-current/40"
      >
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

const TickIcon = () => (
  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CrossIcon = () => (
  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="10" cy="10" r="7.5" />
    <path d="M10 6v5M10 13.5v.5" strokeLinecap="round" />
  </svg>
);
const DotIcon = () => (
  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="10" cy="10" r="7.5" />
    <path d="M10 6.5v4M10 13.5v.5" strokeLinecap="round" />
  </svg>
);

/**
 * Throws outside a provider rather than silently doing nothing — a
 * missing provider means every message the app tries to show is lost,
 * which is exactly the bug that hides until production.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}
