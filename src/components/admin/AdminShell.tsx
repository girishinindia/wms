"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import {
  BellIcon,
  ClockIcon,
  ImageIcon,
  HelpIcon,
  KeyIcon,
  RupeeIcon,
  SitemapIcon,
  WarehouseIcon,
  BoxIcon,
  BuildingIcon,
  ChartIcon,
  CheckShieldIcon,
  DatabaseIcon,
  GlobeIcon,
  GridIcon,
  LayersIcon,
  LockIcon,
  MapIcon,
  MenuIcon,
  MoonIcon,
  PinIcon,
  SidebarIcon,
  SunIcon,
  TruckIcon,
  UsersIcon,
} from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";

import {
  applyFont,
  applyTheme,
  clearPrefs,
  DEFAULT_FONT,
  FONT_STEPS,
  readFont,
  readTheme,
  type FontStep,
  type Theme,
} from "@/lib/admin/prefs";

import Avatar from "./Avatar";
import { useUnreadCount } from "@/lib/notifications/unread";

import { groupNav, inSection, isGroup, type AdminNavItem } from "./nav";
import NotificationBell from "./NotificationBell";
import RouterRecovery, { rememberIntent } from "./RouterRecovery";

/**
 * The frame every admin page renders inside.
 *
 * A client component only because the sidebar has to know which route is
 * current and the sign-out button has to call an endpoint. Everything
 * that decides *what* is in here — which links, which user — is computed
 * on the server in `app/admin/layout.tsx` and passed down, so the
 * permission check never depends on the browser.
 */

const ICONS = {
  chart: ChartIcon,
  box: BoxIcon,
  shield: CheckShieldIcon,
  pin: PinIcon,
  database: DatabaseIcon,
  globe: GlobeIcon,
  map: MapIcon,
  grid: GridIcon,
  truck: TruckIcon,
  users: UsersIcon,
  building: BuildingIcon,
  bell: BellIcon,
  warehouse: WarehouseIcon,
  image: ImageIcon,
  help: HelpIcon,
  rupee: RupeeIcon,
  key: KeyIcon,
  clock: ClockIcon,
  sitemap: SitemapIcon,
} as const;

export type AdminUser = {
  name: string;
  email: string;
  roles: string[];
  photoUrl?: string | null;
};

/**
 * Where an importer stands. Absent for platform users. When `verified`
 * is false the sidebar has already been cut down to the company profile
 * (the layout did that), and any other route renders the lock card
 * below instead of its page — the pages refuse on the server too; this
 * only makes the refusal readable.
 */
export type ImporterLock = {
  verified: boolean;
  kycStatus: string;
  status: string;
};

/**
 * The unread count beside the sidebar's Notifications entry.
 *
 * Its own component so that only this pill re-renders when the number
 * moves — putting the hook in `AdminShell` would re-render the whole
 * shell, sidebar and page frame included, once a minute forever.
 *
 * It reads the same store the header bell reads, so the two can never
 * disagree and marking everything read clears both in the same tick
 * without a second request.
 */
function UnreadBadge() {
  const unread = useUnreadCount();
  if (unread <= 0) return null;
  return (
    <>
      {/* The real count, read aloud. "99+" is a drawing, not a number,
          so the spoken version always gives the figure itself. */}
      <span className="sr-only">{unread} unread</span>
      <span
        // `tabular-nums` so the pill does not jitter in width as the
        // count changes; hidden from the reader because the line above
        // already said it, and better.
        aria-hidden
        className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-amber-400 px-1.5 text-[0.7rem] font-bold tabular-nums text-ink-900"
      >
        {unread > 99 ? "99+" : unread}
      </span>
    </>
  );
}

export default function AdminShell({
  items,
  user,
  lock = null,
  showBell = true,
  children,
}: {
  items: AdminNavItem[];
  user: AdminUser;
  lock?: ImporterLock | null;
  showBell?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /**
   * Desktop: the sidebar can be hidden to give a wide table the whole
   * screen. Remembered per browser so it stays the way it was left.
   */
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem("wms.admin.sidebar") === "hidden");
    } catch {
      /* private mode: forget between loads, nothing else */
    }
  }, []);
  /**
   * Theme and text size. The boot script in the layout already applied
   * the saved values before paint; this mirrors them into state so the
   * buttons show the right thing, and applies changes.
   */
  const [theme, setTheme] = useState<Theme>("dark");
  const [font, setFont] = useState<FontStep>(DEFAULT_FONT);
  useEffect(() => {
    /**
     * Re-APPLY, not merely mirror.
     *
     * The boot script covers a full page load, but a client navigation
     * that passed through a screen this shell does not own can leave
     * `<html>` stripped of both attributes. Applying them again here
     * means arriving on any admin screen repairs the panel instead of
     * leaving the buttons claiming one theme while the page shows the
     * other. Idempotent when nothing is wrong, which is most of the time.
     */
    const saved = readTheme();
    const size = readFont();
    setTheme(saved);
    setFont(size);
    applyTheme(saved);
    applyFont(size);
    return () => {
      /**
       * Clear only when the panel is genuinely being left.
       *
       * This used to run unconditionally, and "the shell unmounted" is
       * not the same fact as "the user left the admin area". A client
       * navigation to an /admin URL with no page behind it — an
       * undeployed route, a stale link, a typo — unmounts the shell as
       * well, and took the light theme with it: the panel snapped to
       * dark while localStorage still said light. The router has
       * already moved the address by the time cleanup runs, so ask it
       * where we actually went.
       *
       * Sign-out clears explicitly too, so this never has to be the
       * only thing standing between the light theme and the marketing
       * page.
       */
      if (!window.location.pathname.startsWith("/admin")) clearPrefs();
    };
  }, []);
  const switchTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  };
  const stepFont = (dir: -1 | 0 | 1) => {
    const i = FONT_STEPS.indexOf(font);
    const next = dir === 0 ? DEFAULT_FONT : (FONT_STEPS[Math.min(FONT_STEPS.length - 1, Math.max(0, i + dir))] ?? DEFAULT_FONT);
    setFont(next);
    applyFont(next);
  };

  const toggleSidebar = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem("wms.admin.sidebar", c ? "shown" : "hidden");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };
  /**
   * Which groups the user has explicitly opened or closed.
   *
   * Absent from the map means "follow the route": a section containing
   * the current page is open, everything else is shut. So arriving on a
   * master screen from a link shows you where you are, and closing the
   * section stays closed while you move around inside it.
   */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const nodes = groupNav(items);

  const isOpen = (label: string, match: string) =>
    openGroups[label] ?? inSection(match, pathname);

  /** Flip a group, starting from whatever it is currently showing —
   *  which is route-derived until someone touches it. */
  const toggleGroup = (label: string) => {
    const node = nodes.find((n) => isGroup(n) && n.label === label);
    const match = node && isGroup(node) ? node.match : null;
    setOpenGroups((g) => ({
      ...g,
      [label]: !(g[label] ?? (match ? inSection(match, pathname) : false)),
    }));
  };

  function renderItem(item: AdminNavItem, nested: boolean) {
    const Icon = ICONS[item.icon];
    // `/admin` would otherwise match every child route.
    const active =
      item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
    return (
      /**
       * A plain anchor, not `<Link>`, and deliberately so.
       *
       * Client-side routing has now produced three separate reports of
       * "I click the menu and nothing happens", from three different
       * causes: chunks 404ing after a deploy, a navigation aborting with
       * nothing in the console, and a router that simply stopped
       * responding in one tab. They share a failure mode — when client
       * routing fails it fails SILENTLY, leaving a page that looks fine
       * and a menu that is dead.
       *
       * A browser navigation cannot do that. It either shows the page or
       * shows an error, and no stale bundle, wedged router or misbehaving
       * extension can swallow it.
       *
       * The cost is a full page load per click. That cost is unusually
       * low here: every admin page is `force-dynamic`, so a `<Link>` was
       * already round-tripping to the server for the RSC payload — the
       * only saving was not re-parsing the shell. Measured at roughly
       * 700ms locally. Reliability is worth more than that on a screen
       * somebody uses to approve customers.
       */
      <a
        key={item.href}
        href={item.href}
        onClick={() => {
          setMenuOpen(false);
          rememberIntent(item.href);
        }}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-3 rounded-lg text-sm transition-colors ${
          nested ? "px-3 py-1.5" : "px-3 py-2"
        } ${
          active
            ? "bg-verdigris-500/15 text-verdigris-50"
            : "text-verdigris-200/70 hover:bg-verdigris-100/5 hover:text-verdigris-100"
        }`}
      >
        <Icon className={nested ? "h-3.5 w-3.5 shrink-0" : "h-4 w-4 shrink-0"} />
        {/*
          The label needs a box of its own.

          As a bare text node it is an ANONYMOUS flex item: it shrinks to
          its content width and, the moment the text wraps to a second
          line, centres itself inside that box. "Transporters & Vehicles"
          started 28px further right than every other row and sat
          centred. `flex-1` takes the leftover width so the text starts
          where every other label starts, `text-left` kills the centring,
          `min-w-0` lets it wrap without shoving a trailing badge out of
          the row.
        */}
        <span className="min-w-0 flex-1 text-left">{item.label}</span>
        {item.badge === "notifications" ? <UnreadBadge /> : null}
      </a>
    );
  }

  async function signOut() {
    setSigningOut(true);
    const result = await api<{ ok: true }>("/auth/logout");
    // Logout must never appear to fail — a user on a shared terminal who
    // reads "could not sign out" walks away from a live session.
    if (!result.ok) toast.info("Signed out locally.");
    // The one client-route exit from the panel. Said here rather than
    // left to the unmount, so the marketing page never inherits the
    // admin's light palette however the cleanup is guarded.
    clearPrefs();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen bg-ink-900">
      <RouterRecovery />
      {/*
        The sidebar is the height of the SCREEN, not of the page.

        As a plain flex child it grew and shrank with the content beside
        it: a short screen (five states) gave a short sidebar with the
        page's background showing under it, a long screen gave a sidebar
        that scrolled away with the table. `sticky top-0 h-screen` pins
        it to the viewport for the whole page and lets a very long menu
        scroll on its own; `self-start` keeps the flex row from
        stretching it back to the content's height.
      */}
      <aside
        className={`${
          menuOpen ? "flex" : "hidden"
        } fixed inset-y-0 left-0 z-40 w-64 shrink-0 flex-col overflow-y-auto border-r border-verdigris-300/10 bg-ink-850 lg:sticky lg:top-0 lg:h-screen lg:self-start ${
          collapsed ? "lg:hidden" : "lg:flex"
        }`}
      >
        <a
          href="/admin"
          className="flex items-center gap-2.5 border-b border-verdigris-300/10 px-5 py-4"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-verdigris-500/15 text-verdigris-300">
            <LayersIcon className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-verdigris-50">Genius WMS</span>
        </a>

        <nav className="flex-1 space-y-0.5 p-3">
          {nodes.map((node) =>
            isGroup(node) ? (
              <div key={node.label}>
                <button
                  type="button"
                  onClick={() => toggleGroup(node.label)}
                  aria-expanded={isOpen(node.label, node.match)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    inSection(node.match, pathname)
                      ? "text-verdigris-50"
                      : "text-verdigris-200/70 hover:bg-verdigris-100/5 hover:text-verdigris-100"
                  }`}
                >
                  {(() => {
                    const Icon = ICONS[node.icon];
                    return <Icon className="h-4 w-4 shrink-0" />;
                  })()}
                  {/* Same anonymous-flex-item trap as in `renderItem`. */}
                  <span className="min-w-0 flex-1 text-left">{node.label}</span>
                  <svg
                    aria-hidden
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                      isOpen(node.label, node.match) ? "rotate-180" : ""
                    }`}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>

                {isOpen(node.label, node.match) ? (
                  <div className="ml-[1.4rem] mt-0.5 space-y-0.5 border-l border-verdigris-300/12 pl-2">
                    {node.children.map((child) => renderItem(child, true))}
                  </div>
                ) : null}
              </div>
            ) : (
              renderItem(node, false)
            ),
          )}
        </nav>

        <div className="border-t border-verdigris-300/10 p-3">
          <a
            href="/admin/profile"
            title="My profile"
            className="block rounded-lg px-2 py-1 transition-colors hover:bg-verdigris-100/5"
          >
            <span className="flex items-center gap-2.5">
              <Avatar name={user.name} photoUrl={user.photoUrl} size={34} />
              <span className="min-w-0 flex-1">
                <p className="truncate text-sm text-verdigris-100">{user.name}</p>
                <p className="truncate text-xs text-verdigris-200/45">{user.email}</p>
              </span>
            </span>
            <p className="mt-1.5 font-mono text-[0.72rem] uppercase tracking-[0.14em] text-verdigris-400">
              {/* De-duplicated: a warehouse admin over three sites holds
                  three assignments of the same role, and "WAREHOUSE_ADMIN ·
                  WAREHOUSE_ADMIN · WAREHOUSE_ADMIN" is noise, not
                  information. The sites are on their profile. */}
              {[...new Set(user.roles)].join(" · ") || "no role"} ·{" "}
              <span className="text-verdigris-300">my profile</span>
            </p>
          </a>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-verdigris-300/15 px-3 py-2 text-sm text-verdigris-200/80 transition-colors hover:border-verdigris-300/35 hover:text-verdigris-100 disabled:opacity-55"
          >
            {signingOut ? <Spinner className="h-3.5 w-3.5" /> : null}
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>

      {menuOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-30 bg-ink-900/70 lg:hidden"
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-verdigris-300/10 px-4 py-2.5">
          {/* Small screens: opens the drawer. Large screens: hides or
              shows the sidebar, and remembers. */}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="rounded-lg border border-verdigris-300/15 p-2 text-verdigris-200 hover:border-verdigris-300/40 hover:text-verdigris-50 lg:hidden"
          >
            <MenuIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
            aria-pressed={collapsed}
            title={collapsed ? "Show sidebar" : "Hide sidebar"}
            className="hidden rounded-lg border border-verdigris-300/15 p-2 text-verdigris-200 hover:border-verdigris-300/40 hover:text-verdigris-50 lg:inline-grid"
          >
            <SidebarIcon className="h-4 w-4" />
          </button>
          <span className={`text-sm font-semibold text-verdigris-50 ${collapsed ? "" : "lg:hidden"}`}>
            Genius WMS
          </span>

          <div className="ml-auto flex items-center gap-1.5">
            {/* Text size: smaller, reset, larger. Scales the root font,
                and everything here is in rem, so everything scales. */}
            <div
              role="group"
              aria-label="Text size"
              className="inline-flex items-center rounded-lg border border-verdigris-300/15"
            >
              <button
                type="button"
                onClick={() => stepFont(-1)}
                disabled={font === FONT_STEPS[0]}
                aria-label="Smaller text"
                title="Smaller text"
                className="px-2 py-1.5 text-[0.78rem] font-semibold text-verdigris-200 hover:text-verdigris-50 disabled:opacity-35"
              >
                A−
              </button>
              <button
                type="button"
                onClick={() => stepFont(0)}
                aria-label={`Text size ${font}%. Reset to default`}
                title={`${font}% — reset`}
                className={`border-x border-verdigris-300/15 px-2 py-1.5 text-[0.84rem] font-semibold hover:text-verdigris-50 ${
                  font === DEFAULT_FONT ? "text-verdigris-200/60" : "text-verdigris-50"
                }`}
              >
                A
              </button>
              <button
                type="button"
                onClick={() => stepFont(1)}
                disabled={font === FONT_STEPS[FONT_STEPS.length - 1]}
                aria-label="Larger text"
                title="Larger text"
                className="px-2 py-1.5 text-[0.9rem] font-semibold text-verdigris-200 hover:text-verdigris-50 disabled:opacity-35"
              >
                A+
              </button>
            </div>

            {showBell ? <NotificationBell /> : null}

            <button
              type="button"
              onClick={switchTheme}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              aria-pressed={theme === "light"}
              title={theme === "dark" ? "Light theme" : "Dark theme"}
              className="rounded-lg border border-verdigris-300/15 p-2 text-verdigris-200 hover:border-verdigris-300/40 hover:text-verdigris-50"
            >
              {theme === "dark" ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        {lock && !lock.verified ? (
          <div className="border-b border-amber-400/25 bg-amber-400/10 px-4 py-2 text-sm text-amber-100 sm:px-8">
            {lock.status === "SUSPENDED"
              ? "Your company has been suspended. Contact the warehouse to have it reinstated."
              : lock.kycStatus === "SUBMITTED"
              ? "Your company profile is with our team for verification. You will be able to use the rest of the portal once it is approved."
              : lock.kycStatus === "REJECTED"
                ? "Your company profile was returned with remarks. Fix them and submit again."
                : "Complete your company profile and submit it for verification to unlock the portal."}
          </div>
        ) : null}

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
          {lock && !lock.verified && pathname !== "/admin" ? (
            <div className="mx-auto mt-10 max-w-md rounded-2xl border border-verdigris-300/10 bg-ink-850 p-8 text-center card-shadow">
              <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-amber-400/15 text-amber-300">
                <LockIcon className="h-5 w-5" />
              </span>
              <h1 className="mt-4 text-lg font-semibold text-verdigris-50">Not yet verified</h1>
              <p className="mt-2 text-sm text-verdigris-200/70">
                This part of the portal opens after a super admin verifies your company. Complete
                your profile and submit it — you will be notified when it is approved.
              </p>
              <a
                href="/admin"
                className="mt-6 inline-block rounded-xl bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina"
              >
                Go to my company profile
              </a>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
