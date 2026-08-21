"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { BellIcon } from "@/components/icons";
import { api } from "@/lib/api/client";

/**
 * The bell in the admin header.
 *
 * Reads `/notifications` on mount and every minute while the tab is
 * visible, shows the unread count, and lists the newest ten in a
 * dropdown. Opening an item marks it read and follows its action URL —
 * a super admin clicks "profile submitted" and lands on the importer.
 *
 * Polling, not a socket: the volume here is a handful a day, and a
 * once-a-minute GET on a pooled connection costs nothing. It also stops
 * when the tab is hidden, so a forgotten window does not keep asking.
 */

type Item = {
  id: number;
  eventKey: string;
  title: string;
  body: string;
  actionUrl: string | null;
  createdAt: string;
  readAt: string | null;
};

const POLL_MS = 60_000;

/**
 * The notifications screen fires this after it marks or deletes
 * anything, so the badge does not sit there wrong for up to a minute.
 * A window event rather than shared state: the two live in different
 * trees (the shell and the page) and have nothing else to say to
 * each other.
 */
export const NOTIFICATIONS_CHANGED = "wms:notifications-changed";

function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const result = await api<{ unread: number; items: Item[] }>("/notifications?limit=10", {
      method: "GET",
    });
    if (result.ok) {
      setUnread(result.data.unread);
      setItems(result.data.items);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener(NOTIFICATIONS_CHANGED, load);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener(NOTIFICATIONS_CHANGED, load);
    };
  }, [load]);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function markAll() {
    const result = await api<{ marked: number }>("/notifications/read", { body: { all: true } });
    if (result.ok) {
      setUnread(0);
      setItems((list) => list.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })));
    }
  }

  async function openItem(item: Item) {
    if (!item.readAt) {
      // Optimistic; the server call follows. A misfire only means the dot
      // comes back on the next poll.
      setUnread((n) => Math.max(0, n - 1));
      setItems((list) => list.map((i) => (i.id === item.id ? { ...i, readAt: new Date().toISOString() } : i)));
      void api("/notifications/read", { body: { ids: [item.id] } });
    }
    if (item.actionUrl && item.actionUrl.startsWith("/")) {
      window.location.assign(item.actionUrl);
    }
  }

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `${unread} unread notifications` : "Notifications"}
        aria-expanded={open}
        title="Notifications"
        className="relative rounded-lg border border-verdigris-300/15 p-2 text-verdigris-200 hover:border-verdigris-300/40 hover:text-verdigris-50"
      >
        <BellIcon className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-amber-400 px-1 text-[0.72rem] font-bold text-ink-900">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-verdigris-300/15 bg-ink-850 card-shadow sm:w-96"
        >
          <div className="flex items-center justify-between border-b border-verdigris-300/10 px-4 py-2.5">
            <p className="text-sm font-semibold text-verdigris-50">Notifications</p>
            {unread > 0 ? (
              <button
                type="button"
                onClick={markAll}
                className="text-xs text-verdigris-300 hover:text-verdigris-100"
              >
                Mark all read
              </button>
            ) : null}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {!loaded ? (
              <li className="px-4 py-6 text-center text-sm text-verdigris-200/60">Loading…</li>
            ) : items.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-verdigris-200/60">
                Nothing yet.
              </li>
            ) : (
              items.map((item) => (
                <li key={item.id} className="border-b border-verdigris-300/8 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className={`block w-full px-4 py-3 text-left transition-colors hover:bg-verdigris-100/5 ${
                      item.readAt ? "opacity-70" : ""
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!item.readAt ? (
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-hidden />
                      ) : (
                        <span className="mt-1.5 h-2 w-2 shrink-0" aria-hidden />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-verdigris-50">{item.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-verdigris-200/70">{item.body}</p>
                        <p className="mt-1 text-[0.78rem] text-verdigris-200/45">{ago(item.createdAt)}</p>
                      </div>
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>
          <a
            href="/admin/notifications"
            className="block border-t border-verdigris-300/10 px-4 py-2.5 text-center text-xs font-medium text-verdigris-300 transition-colors hover:bg-verdigris-100/5 hover:text-verdigris-100"
          >
            See all notifications
          </a>
        </div>
      ) : null}
    </div>
  );
}
