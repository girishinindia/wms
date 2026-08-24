import Link from "next/link";

import { Card, PageHeader } from "@/components/admin/ui";

/**
 * A 404 that stays inside the panel.
 *
 * The root `not-found.tsx` is a full-screen marketing page, and reaching
 * it from an admin URL costs more than a wrong-looking page. Next serves
 * an unmatched route with a FULL document load, and only the admin
 * layout carries the pre-paint script that applies the saved theme and
 * text size — so landing on the marketing 404 snapped a light panel back
 * to dark, with localStorage still saying "light" and the toggle button
 * still claiming it. That was reported as "clicking Audit Log switches
 * the theme": the page behind that link was not deployed yet, so the
 * click left the panel without ever looking like it had.
 *
 * The catch-all beside this file is what routes an unknown /admin URL
 * here rather than out of the app. Rendering inside the admin layout
 * means the boot script runs, the theme holds, and the sidebar is still
 * there to click something else with.
 */
export default function AdminNotFound() {
  return (
    <>
      <PageHeader
        title="Page not found"
        subtitle="Nothing is served at that address. The link may be out of date, or the screen may not have been deployed yet."
      />
      <Card className="p-8 text-center">
        <p className="text-sm text-verdigris-100">
          Check the address, or pick a screen from the menu.
        </p>
        <Link
          href="/admin"
          className="mt-6 inline-block rounded-xl bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina"
        >
          Back to the dashboard
        </Link>
      </Card>
    </>
  );
}
