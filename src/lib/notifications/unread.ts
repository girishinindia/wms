"use client";

import { useSyncExternalStore } from "react";

import { api } from "@/lib/api/client";

/**
 * One notifications poll, shared by everything that shows a count.
 *
 * Two things display the same number now — the bell in the header and
 * the badge on the sidebar's Notifications entry — and a third could
 * follow. Each owning its own `useState` and its own timer would mean
 * two requests a minute instead of one, and worse: two numbers that
 * disagree for up to a minute every time somebody marks one read.
 *
 * So the fetch, the timer and the number live here, once, and the
 * components subscribe. `useSyncExternalStore` rather than a context
 * because there is no provider to place: the store starts itself when
 * the first component subscribes and stops when the last one leaves,
 * which is also what makes it safe on the marketing pages that render
 * neither.
 *
 * Polling, not a socket: the volume is a handful a day, and a
 * once-a-minute GET on a pooled connection costs nothing. It stops
 * while the tab is hidden, so a forgotten window does not keep asking.
 */

export type NotificationItem = {
  id: number;
  eventKey: string;
  title: string;
  body: string;
  actionUrl: string | null;
  createdAt: string;
  readAt: string | null;
};

export type NotificationState = {
  unread: number;
  items: NotificationItem[];
  /** False until the first response lands, so the dropdown can say
   *  "Loading…" rather than "Nothing yet." */
  loaded: boolean;
};

const POLL_MS = 60_000;

/** How many the dropdown lists. The `unread` count that comes back is a
 *  count over ALL the recipient's rows, not just these — see the route. */
const PAGE = 10;

/**
 * The notifications screen fires this after it marks or deletes
 * anything, so a badge does not sit there wrong for up to a minute.
 * A window event rather than an import, because the screen and the
 * shell live in different trees and have nothing else to say to each
 * other.
 */
export const NOTIFICATIONS_CHANGED = "wms:notifications-changed";

const EMPTY: NotificationState = { unread: 0, items: [], loaded: false };

let state: NotificationState = EMPTY;
const listeners = new Set<() => void>();
let timer: number | null = null;
let inFlight = false;

function emit() {
  for (const fn of listeners) fn();
}

/** Replace the state and tell everyone. Always a new object — an
 *  in-place mutation would be invisible to `useSyncExternalStore`. */
function set(next: Partial<NotificationState>) {
  state = { ...state, ...next };
  emit();
}

export async function refresh(): Promise<void> {
  // A slow response must not queue three more behind it.
  if (inFlight) return;
  inFlight = true;
  try {
    const result = await api<{ unread: number; items: NotificationItem[] }>(
      `/notifications?limit=${PAGE}`,
      { method: "GET" },
    );
    if (result.ok) {
      set({ unread: result.data.unread, items: result.data.items, loaded: true });
    } else {
      // A failed poll is not news. Keep the last good number and mark
      // the store loaded so the dropdown stops saying "Loading…"
      // forever on an account that cannot read notifications.
      set({ loaded: true });
    }
  } finally {
    inFlight = false;
  }
}

/**
 * Optimistic local edits, for the two places that already know the
 * answer before the server confirms it: opening one item, and marking
 * everything read. A misfire only means the real number comes back on
 * the next poll.
 */
export function markAllReadLocally() {
  const now = new Date().toISOString();
  set({
    unread: 0,
    items: state.items.map((i) => ({ ...i, readAt: i.readAt ?? now })),
  });
}

export function markOneReadLocally(id: number) {
  const item = state.items.find((i) => i.id === id);
  // Only a genuinely unread item moves the counter — clicking a read
  // one twice must not push it below zero.
  if (item && item.readAt) return;
  set({
    unread: Math.max(0, state.unread - 1),
    items: state.items.map((i) =>
      i.id === id ? { ...i, readAt: i.readAt ?? new Date().toISOString() } : i,
    ),
  });
}

function tick() {
  if (document.visibilityState === "visible") void refresh();
}

function start() {
  void refresh();
  timer = window.setInterval(tick, POLL_MS);
  document.addEventListener("visibilitychange", tick);
  window.addEventListener(NOTIFICATIONS_CHANGED, onChanged);
}

function stop() {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", tick);
  window.removeEventListener(NOTIFICATIONS_CHANGED, onChanged);
}

function onChanged() {
  void refresh();
}

function subscribe(fn: () => void): () => void {
  const first = listeners.size === 0;
  listeners.add(fn);
  if (first) start();
  return () => {
    listeners.delete(fn);
    // React double-invokes effects in dev StrictMode, so the last
    // unsubscribe is routinely followed by a fresh subscribe a tick
    // later. Tearing the timer down immediately is still correct —
    // `start` refetches — it just costs one extra request in dev.
    if (listeners.size === 0) stop();
  };
}

const getSnapshot = () => state;

/**
 * The server render has no store and must not start one. Returning the
 * same frozen object every time is what keeps `useSyncExternalStore`
 * from looping — a fresh literal here would be a new reference on every
 * call and an infinite re-render.
 */
const getServerSnapshot = () => EMPTY;

/** The whole state: bell dropdown. */
export function useNotifications(): NotificationState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Just the number: sidebar badge, and anything else that only counts. */
export function useUnreadCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => state.unread,
    () => 0,
  );
}
