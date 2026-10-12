import DispatchQueue from "@/components/admin/dispatch/DispatchQueue";
import { Denied, PageHeader } from "@/components/admin/ui";
import { pageGuard } from "@/lib/auth/guard";
import { canSeeWork, workQueue } from "@/lib/dispatch/ops";

export const dynamic = "force-dynamic";

/**
 * /admin/dispatch — pick & pack: the delivery notes the warehouse is
 * working on. Super admin, warehouse admin, package, storage and outward
 * managers (package.read at WAREHOUSE or ALL).
 */
export default async function DispatchPage() {
  const guard = await pageGuard("package.read");
  if (!guard.ok || !canSeeWork(guard.actor)) return <Denied what="pick & pack" />;
  const notes = await workQueue(guard.actor, { view: "OPEN" });
  return (
    <>
      <PageHeader
        title="Pick & pack"
        subtitle="Delivery notes to pick, pack and verify. Open one to see where its cartons are and to scan them."
      />
      <DispatchQueue initial={notes} />
    </>
  );
}
