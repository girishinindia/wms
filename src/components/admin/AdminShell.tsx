"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import {
  BoxIcon,
  ChartIcon,
  CheckShieldIcon,
  DatabaseIcon,
  GlobeIcon,
  GridIcon,
  LayersIcon,
  MapIcon,
  MenuIcon,
  PinIcon,
  SidebarIcon,
  TruckIcon,
} from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";

import { groupNav, isGroup, type AdminNavItem } from "./nav";
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
} as const;

export type AdminUser = {
  name: string;
  email: string;
  roles: string[];
};

export default function AdminShell({
  items,
  user,
  children,
}: {
  items: AdminNavItem[];
  user: AdminUser;
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
    openGroups[label] ?? pathname.startsWith(match);

  /** Flip a group, starting from whatever it is currently showing —
   *  which is route-derived until someone touches it. */
  const toggleGroup = (label: string) => {
    const node = nodes.find((n) => isGroup(n) && n.label === label);
    const match = node && isGroup(node) ? node.match : null;
    setOpenGroups((g) => ({
      ...g,
      [label]: !(g[label] ?? (match ? pathname.startsWith(match) : false)),
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
        {item.label}
      </a>
    );
  }

  async function signOut() {
    setSigningOut(true);
    const result = await api<{ ok: true }>("/auth/logout");
    // Logout must never appear to fail — a user on a shared terminal who
    // reads "could not sign out" walks away from a live session.
    if (!result.ok) toast.info("Signed out locally.");
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
                    pathname.startsWith(node.match)
                      ? "text-verdigris-50"
                      : "text-verdigris-200/70 hover:bg-verdigris-100/5 hover:text-verdigris-100"
                  }`}
                >
                  {(() => {
                    const Icon = ICONS[node.icon];
                    return <Icon className="h-4 w-4 shrink-0" />;
                  })()}
                  {node.label}
                  <svg
                    aria-hidden
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`ml-auto h-3.5 w-3.5 transition-transform ${
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
          <p className="truncate px-2 text-sm text-verdigris-100">{user.name}</p>
          <p className="truncate px-2 text-xs text-verdigris-200/45">{user.email}</p>
          <p className="mt-1.5 px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-verdigris-400">
            {user.roles.join(" · ") || "no role"}
          </p>
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
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
