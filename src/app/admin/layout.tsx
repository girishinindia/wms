import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import AdminShell from "@/components/admin/AdminShell";
import { ForceChangePassword } from "@/components/admin/ProfileForms";
import { visibleNav } from "@/components/admin/nav";
import { currentActor, grantFor, importerGateFor } from "@/lib/auth/guard";
import { isAgentOnly } from "@/lib/sales-agents/scope";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  // The panel is behind a login and has nothing a search engine should
  // ever hold. Overrides the site-wide index/follow from the root layout.
  robots: { index: false, follow: false },
};

/**
 * The gate.
 *
 * Every admin page renders inside this layout, so the session check
 * happens once per navigation and cannot be forgotten on a new screen.
 * Each page still asserts its own permission — this only answers "do you
 * belong in the admin area at all", which is a coarser question.
 *
 * Anonymous callers are redirected with `next=`, so signing in returns
 * them to the page they asked for rather than dumping them on a
 * dashboard. Signed-in callers who hold nothing get an explanation
 * instead of a redirect loop back to a sign-in form they have already
 * completed.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const actor = await currentActor();
  if (!actor) redirect("/sign-in?next=/admin");

  // A temporary password opens exactly one door: the form that replaces
  // it. Rendering the gate here, in the layout, means no admin URL can
  // route around it.
  // The theme and text size are applied by the root layout's head, which
  // covers this branch and every other one without each having to
  // remember to say so.
  if (actor.session.mustChangePassword) {
    return <ForceChangePassword name={actor.session.firstName} />;
  }

  /**
   * A sales agent's whole presence in the panel is their own record, and
   * that is the dashboard. `agentOnly` is what keeps them admitted while
   * the "Sales agents" entry — a list of one, themselves — goes away.
   */
  let items = visibleNav(actor.permissions, { agentOnly: isAgentOnly(actor) });

  /**
   * An importer who has not been verified yet gets exactly one screen:
   * the dashboard, which for an importer IS their company profile. The
   * sidebar is cut down here, on the server, and the shell renders a
   * lock card for any other route — the pages refuse on their own as
   * well, so this is presentation, not the guard.
   */
  const gate = await importerGateFor(actor);
  const lock =
    gate.kind === "importer"
      ? { verified: gate.verified, kycStatus: gate.kycStatus, status: gate.status }
      : null;
  if (lock && !lock.verified) {
    items = items.filter((i) => i.href === "/admin");
  }

  if (items.length === 0) {
    return (
      <div className="grid min-h-full place-items-center bg-ink-900 px-6 py-20">
        <div className="max-w-md rounded-2xl border border-verdigris-300/10 bg-ink-850 p-8 text-center card-shadow">
          <h1 className="text-lg font-semibold text-verdigris-50">No admin access</h1>
          <p className="mt-2 text-sm text-verdigris-200/60">
            Your account is signed in but holds no permission that this area uses. If that is
            wrong, a super admin can assign the role you need.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-xl bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina"
          >
            Back to the site
          </Link>
        </div>
      </div>
    );
  }

  /*
   * Theme and text size are NOT applied here any more.
   *
   * This layout renders inside `<body>`, and a script there loses to
   * the stylesheet in `<head>`: the browser paints the dark background
   * first and repaints when the script arrives — invisible on a fast
   * connection, a black blink on a real one. It runs from the root
   * layout's head now, where nothing can paint ahead of it.
   */
  return (
    <>
      <AdminShell
        items={items}
        lock={lock}
        showBell={grantFor(actor, "notification.read") !== null}
        user={{
          name: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
          email: actor.session.email,
          roles: actor.roles.map((r) => r.role),
          photoUrl: actor.session.photoUrl,
        }}
      >
        {children}
      </AdminShell>
    </>
  );
}
