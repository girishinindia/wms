import PageSkeleton from "@/components/admin/Skeleton";

/**
 * The default stand-in for every screen under /admin.
 *
 * A `loading.tsx` here covers this segment and every route nested below
 * it, so one file gives the whole panel a loading state and the handful
 * of screens that are not lists override it beside their own page.
 *
 * What it buys is not decoration. Without a loading boundary the server
 * holds the entire response until the last query returns, and because
 * the panel navigates with full page loads the browser has nothing to
 * paint and keeps showing the PREVIOUS screen. That is why clicking the
 * audit log felt like the whole window froze and then swapped: it did.
 * With this, Next flushes the layout at once — sidebar, header, the lot
 * — and fills the content area in when the rows arrive.
 *
 * Most screens here are a heading over a table, so that is the default.
 */
export default function Loading() {
  return <PageSkeleton rows={8} columns={5} />;
}
