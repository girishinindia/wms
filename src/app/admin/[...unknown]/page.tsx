import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Claims every /admin URL that no real screen answers.
 *
 * Without it, Next has nothing to match and serves the ROOT 404 — a
 * full-screen marketing page, reached by a full document load. That load
 * skips the admin layout, and with it the pre-paint script that applies
 * the saved theme and text size, so a light panel lands on a dark page
 * while localStorage still reads "light". Clicking a menu entry whose
 * page had not been deployed did exactly that, and it looked like the
 * theme had reset itself.
 *
 * A catch-all is the lowest-priority match in the App Router, so every
 * real route — including `/admin/master/[resource]` — still wins. This
 * only picks up what would otherwise have fallen out of the app, and
 * `notFound()` hands it to `admin/not-found.tsx`, which renders inside
 * the shell with the sidebar intact.
 *
 * The layout above still runs, so an anonymous caller is redirected to
 * sign-in rather than being told a page is missing — the answer to "does
 * this exist" should not depend on being signed out.
 */
export default function AdminCatchAll(): never {
  notFound();
}
