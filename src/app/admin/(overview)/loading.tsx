import { Card } from "@/components/admin/ui";
import { HeaderSkeleton } from "@/components/admin/Skeleton";

/**
 * The dashboard is a row of figures over a card, not a list.
 *
 * It sits in a route group purely so it can say that. `(overview)`
 * changes no URL — /admin is still /admin — but it gives the dashboard
 * a segment of its own, and therefore a loading state of its own,
 * instead of inheriting the table skeleton that suits the eighteen list
 * screens under here. A skeleton of the wrong shape causes a second
 * jump when the real content lands, which is worse than none.
 */
function Bar({ className = "" }: { className?: string }) {
  return <span className={`skeleton-bar block rounded ${className}`} aria-hidden />;
}

export default function Loading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading</span>
      <HeaderSkeleton />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="p-5">
            <Bar className="h-3 w-20" />
            <Bar className="mt-3 h-7 w-16" />
          </Card>
        ))}
      </div>
      <Card className="mt-6 p-5">
        <Bar className="h-4 w-40" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="mt-4 flex gap-6">
            <Bar className="h-3.5 w-32" />
            <Bar className="h-3.5 w-24" />
            <Bar className="h-3.5 w-40" />
          </div>
        ))}
      </Card>
    </div>
  );
}
