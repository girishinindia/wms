import { Card } from "./ui";

/**
 * What a screen looks like while its data is still being fetched.
 *
 * Rendered by the `loading.tsx` beside each route, which is what turns
 * a page from one long silence into two short ones. Without a loading
 * boundary the server holds the entire response until every query has
 * finished, so the browser has nothing to show and keeps the PREVIOUS
 * page on screen — the whole panel appears to freeze and then swap at
 * once. With one, Next flushes the layout immediately: the sidebar and
 * header are there, and this stands in for the table until the rows
 * arrive.
 *
 * Deliberately the same shape as the real thing — a toolbar, a header
 * row, a body of rows — because a skeleton that does not match causes a
 * second, worse jump when the content lands and everything moves.
 *
 * A server component: nothing here is interactive, and shipping a
 * loading state to the browser as JavaScript would be a strange way to
 * make a page feel faster.
 */

/** One shimmering block. The width varies per cell so a row of them
 *  reads as text rather than as a barcode. */
function Bar({ className = "" }: { className?: string }) {
  return <span className={`skeleton-bar block rounded ${className}`} aria-hidden />;
}

export function TableSkeleton({
  rows = 8,
  columns = 5,
  toolbar = true,
}: {
  rows?: number;
  columns?: number;
  /** Off for screens whose card has no search-and-filter row. */
  toolbar?: boolean;
}) {
  // Uneven, repeating widths: real columns are not all the same size,
  // and eight identical rows look like a loading GIF rather than a table.
  const widths = ["w-28", "w-40", "w-24", "w-32", "w-20", "w-36"];

  return (
    /**
     * One live region for the whole skeleton, not one per bar. A reader
     * should hear "Loading" once; `aria-busy` is what marks the region
     * as incomplete, and every decorative bar inside is hidden.
     */
    <Card className="p-0" >
      <div role="status" aria-busy="true">
        <span className="sr-only">Loading</span>

        {toolbar ? (
          <div className="border-b border-verdigris-300/10 p-4">
            <Bar className="h-4 w-32" />
            <div className="mt-3 flex flex-wrap gap-2">
              <Bar className="h-9 flex-1 min-w-48" />
              <Bar className="h-9 w-24" />
              <Bar className="h-9 w-28" />
            </div>
          </div>
        ) : null}

        <div className="border-b border-verdigris-300/10 px-4 py-3">
          <div className="flex gap-6">
            {Array.from({ length: columns }, (_, i) => (
              <Bar key={i} className={`h-3 ${widths[i % widths.length]}`} />
            ))}
          </div>
        </div>

        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="border-b border-verdigris-300/8 px-4 py-4 last:border-b-0">
            <div className="flex gap-6">
              {Array.from({ length: columns }, (_, c) => (
                <Bar key={c} className={`h-3.5 ${widths[(r + c) % widths.length]}`} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** The title block above a table, so the page does not appear to grow
 *  a heading a moment after it appears. */
export function HeaderSkeleton() {
  return (
    <div className="mb-6" aria-hidden>
      <Bar className="h-7 w-56" />
      <Bar className="mt-3 h-3.5 w-full max-w-2xl" />
    </div>
  );
}

/** The default whole-screen stand-in: heading, then a table. */
export default function PageSkeleton({
  rows,
  columns,
  toolbar,
}: {
  rows?: number;
  columns?: number;
  toolbar?: boolean;
}) {
  return (
    <>
      <HeaderSkeleton />
      <TableSkeleton rows={rows} columns={columns} toolbar={toolbar} />
    </>
  );
}

/** For the screens that are a form or a panel rather than a list. */
export function FormSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <>
      <HeaderSkeleton />
      <Card className="p-6">
        <div role="status" aria-busy="true">
          <span className="sr-only">Loading</span>
          {Array.from({ length: fields }, (_, i) => (
            <div key={i} className={i === 0 ? "" : "mt-5"}>
              <Bar className="h-3 w-24" />
              <Bar className="mt-2 h-9 w-full" />
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
