"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { BoxIcon, ChartIcon, CheckShieldIcon, LayersIcon, PinIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";

import type { AdminNavItem } from "./nav";

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
    <div className="flex min-h-full bg-ink-900">
      <aside
        className={`${
          menuOpen ? "flex" : "hidden"
        } fixed inset-y-0 left-0 z-40 w-64 shrink-0 flex-col border-r border-verdigris-300/10 bg-ink-850 lg:flex lg:static`}
      >
        <Link
          href="/admin"
          className="flex items-center gap-2.5 border-b border-verdigris-300/10 px-5 py-4"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-verdigris-500/15 text-verdigris-300">
            <LayersIcon className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-verdigris-50">Genius WMS</span>
        </Link>

        <nav className="flex-1 space-y-0.5 p-3">
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            // `/admin` would otherwise match every child route.
            const active =
              item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-verdigris-500/15 text-verdigris-50"
                    : "text-verdigris-200/70 hover:bg-verdigris-100/5 hover:text-verdigris-100"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
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
        <header className="flex items-center gap-3 border-b border-verdigris-300/10 px-4 py-3 lg:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="rounded-lg border border-verdigris-300/15 px-3 py-1.5 text-sm text-verdigris-200"
          >
            Menu
          </button>
          <span className="text-sm font-semibold text-verdigris-50">Genius WMS</span>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
