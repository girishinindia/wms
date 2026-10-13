"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api/client";
import type { FindHit } from "@/lib/search/quick-find";

import type { AdminNavItem } from "./nav";

/**
 * Quick find (Ctrl+K / ⌘K) and the keyboard shortcuts of the panel.
 *
 *   Ctrl+K      find a delivery note, carton, gala, inward or item
 *   g then d    Delivery notes      g then p   Pick & pack
 *   g then s    Store cartons       g then f   Floors and galas
 *   g then i    Inward requests     g then n   Notifications
 *   /           the search box of the page
 *   ?           this list
 *
 * A "g" shortcut only goes where the sidebar already lets the person go.
 * Keys are ignored while typing in a box, so a scanner never triggers them.
 */

const GO: { key: string; href: string; label: string }[] = [
  { key: "d", href: "/admin/delivery-notes", label: "Delivery notes" },
  { key: "p", href: "/admin/dispatch", label: "Pick & pack" },
  { key: "s", href: "/admin/storage", label: "Store cartons" },
  { key: "f", href: "/admin/locations", label: "Floors and galas" },
  { key: "i", href: "/admin/inward", label: "Inward requests" },
  { key: "n", href: "/admin/notifications", label: "Notifications" },
];

const KIND: Record<FindHit["kind"], string> = { NOTE: "Delivery note", CARTON: "Carton", GALA: "Gala", INWARD: "Inward", ITEM: "Item", DISPATCH: "Dispatch order" };

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && !!el.closest("input, select, textarea, [contenteditable=true]");
};

export default function QuickFind({ items }: { items: AdminNavItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<FindHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const gPressed = useRef(0);
  const seq = useRef(0);
  const allowed = GO.filter((g) => items.some((i) => i.href === g.href));

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setHits([]);
    setAt(0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setHelp(false);
        setOpen(true);
        return;
      }
      if (e.key === "Escape") {
        setHelp(false);
        close();
        return;
      }
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        setHelp((v) => !v);
        return;
      }
      if (e.key === "/") {
        const search = document.querySelector<HTMLInputElement>("main input[id$='-search'], main input[type=search]");
        if (search) {
          e.preventDefault();
          search.focus();
        }
        return;
      }
      if (e.key === "g") {
        gPressed.current = Date.now();
        return;
      }
      if (Date.now() - gPressed.current < 1200) {
        const go = allowed.find((g) => g.key === e.key.toLowerCase());
        gPressed.current = 0;
        if (go) {
          e.preventDefault();
          router.push(go.href);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, allowed, close]);

  useEffect(() => {
    if (open) setTimeout(() => box.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setHits([]);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      const r = await api<{ hits: FindHit[] }>(`/find?q=${encodeURIComponent(text)}`, { method: "GET" });
      if (mine !== seq.current) return;
      setBusy(false);
      setAt(0);
      if (r.ok) setHits(r.data.hits);
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  const go = (h: FindHit | undefined) => {
    if (!h) return;
    close();
    router.push(h.href);
  };

  return (
    <>
      <button
        type="button"
        id="quick-find-open"
        onClick={() => setOpen(true)}
        title="Find anything (Ctrl+K) · ? for all shortcuts"
        className="ml-2 hidden items-center gap-2 rounded-lg border border-verdigris-300/15 px-3 py-1.5 text-sm text-verdigris-200/70 hover:border-verdigris-300/40 hover:text-verdigris-50 sm:inline-flex"
      >
        <span aria-hidden="true">⌕</span> Find note, carton, gala…
        <kbd className="rounded border border-verdigris-300/25 px-1 font-mono text-[0.7rem]">Ctrl K</kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Find"
        className="rounded-lg border border-verdigris-300/15 p-2 text-verdigris-200 hover:text-verdigris-50 sm:hidden"
      >
        ⌕
      </button>

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 pt-[12vh]">
          <button type="button" aria-label="Close" onClick={close} className="absolute inset-0 bg-ink-900/70" />
          <div role="dialog" aria-modal="true" aria-label="Quick find" className="relative w-full max-w-xl rounded-2xl border border-verdigris-300/20 bg-ink-850 p-3 card-shadow">
            <input
              ref={box}
              id="quick-find"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setAt((x) => Math.min(hits.length - 1, x + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setAt((x) => Math.max(0, x - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  go(hits[at]);
                }
              }}
              placeholder="Delivery note no., carton no., gala (F1-G03), inward (INR-000016), item…"
              className="w-full rounded-xl border border-verdigris-300/20 bg-ink-900/70 px-4 py-3 text-base text-verdigris-50 placeholder:text-verdigris-200/40"
            />
            <ul className="mt-2 max-h-[55vh] overflow-y-auto" id="quick-find-hits">
              {q.trim().length >= 2 && !busy && hits.length === 0 ? <li className="px-3 py-3 text-sm text-verdigris-200/60">Nothing found.</li> : null}
              {hits.map((h, i) => (
                <li key={`${h.href}-${i}`}>
                  <button
                    type="button"
                    onMouseEnter={() => setAt(i)}
                    onClick={() => go(h)}
                    className={`flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left ${i === at ? "bg-patina/15" : ""}`}
                  >
                    <span className="mt-0.5 w-24 shrink-0 text-[0.7rem] uppercase tracking-[0.1em] text-verdigris-300">{KIND[h.kind]}</span>
                    <span className="min-w-0">
                      <span className="block font-mono text-sm text-verdigris-50">{h.title}</span>
                      <span className="block text-xs text-verdigris-200/70">{h.subtitle}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 px-1 text-[0.72rem] text-verdigris-200/50">↑ ↓ to choose · Enter to open · Esc to close · ? for all shortcuts</p>
          </div>
        </div>
      ) : null}

      {help ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <button type="button" aria-label="Close" onClick={() => setHelp(false)} className="absolute inset-0 bg-ink-900/70" />
          <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" id="shortcuts-help" className="relative w-full max-w-md rounded-2xl border border-verdigris-300/20 bg-ink-850 p-6 card-shadow">
            <h2 className="text-base font-semibold text-verdigris-50">Keyboard shortcuts</h2>
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
              <dt className="font-mono text-verdigris-300">Ctrl K</dt>
              <dd className="text-verdigris-100">Find a note, carton, gala, inward or item</dd>
              {allowed.map((g) => (
                <div key={g.key} className="contents">
                  <dt className="font-mono text-verdigris-300">g then {g.key}</dt>
                  <dd className="text-verdigris-100">{g.label}</dd>
                </div>
              ))}
              <dt className="font-mono text-verdigris-300">/</dt>
              <dd className="text-verdigris-100">The search box of this page</dd>
              <dt className="font-mono text-verdigris-300">← →</dt>
              <dd className="text-verdigris-100">Previous / next gala or floor</dd>
              <dt className="font-mono text-verdigris-300">Alt 1 2 3 4</dt>
              <dd className="text-verdigris-100">Pick &amp; pack note: Pick, At packing, Pack, Verify</dd>
              <dt className="font-mono text-verdigris-300">Alt N · Alt B</dt>
              <dd className="text-verdigris-100">Pick &amp; pack note: new package · new bundle</dd>
              <dt className="font-mono text-verdigris-300">Alt W · P · L</dt>
              <dd className="text-verdigris-100">Pick &amp; pack note: where next · print pick list · print labels</dd>
              <dt className="font-mono text-verdigris-300">?</dt>
              <dd className="text-verdigris-100">This list</dd>
            </dl>
            <p className="mt-3 text-xs text-verdigris-200/60">Shortcuts do nothing while you type in a box or scan — so a scanner never sets them off.</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
