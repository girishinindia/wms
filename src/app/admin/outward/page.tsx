import Link from "next/link";

import OutwardBoard from "@/components/admin/outward/OutwardBoard";
import { Denied, PageHeader } from "@/components/admin/ui";
import { grantFor, pageGuard } from "@/lib/auth/guard";
import { outwardBoard } from "@/lib/outward/ops";

export const dynamic = "force-dynamic";

/**
 * /admin/outward — Dispatch Orders: ready to load → loading → loaded →
 * left (LR pending) → LR verified. The importer and the agent see their
 * own; the warehouse works them.
 */
export default async function OutwardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const guard = await pageGuard("outward.order.read");
  if (!guard.ok) return <Denied what="dispatch orders" />;
  const view = (await searchParams).view ?? null;
  const board = await outwardBoard(guard.actor, { view });
  const create = grantFor(guard.actor, "outward.order.create");
  const series = grantFor(guard.actor, "outward.series.update");
  return (
    <>
      <PageHeader
        title="Outward"
        subtitle="Load each vehicle by scan, confirm it left, attach its Lorry Receipt."
        action={
          series?.scope === "ALL" ? (
            <Link href="/admin/outward/series" className="rounded-xl border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45">
              DO numbering
            </Link>
          ) : undefined
        }
      />
      <OutwardBoard initial={board} canCreate={!!create && create.scope !== "OWN"} />
    </>
  );
}
