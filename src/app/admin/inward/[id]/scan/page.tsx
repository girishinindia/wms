import Link from "next/link";
import { notFound } from "next/navigation";

import ScanStation from "@/components/admin/ScanStation";
import { Denied, PageHeader } from "@/components/admin/ui";
import { pageGuard } from "@/lib/auth/guard";
import { cartonOverview } from "@/lib/inward/cartons";
import { InwardError, scopeFor } from "@/lib/inward/ops";

export const dynamic = "force-dynamic";

/**
 * The dock's scan station: a handheld (or USB) scanner types each QR into
 * the one box on this page and presses Enter. Super admin, warehouse
 * admin and inward manager — `inward.goods.update`.
 */
export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await pageGuard("inward.goods.update");
  if (!guard.ok) return <Denied what="carton scanning" />;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  let overview;
  try {
    overview = await cartonOverview(guard.actor, scopeFor(guard.actor, guard.grant), id);
  } catch (error) {
    if (error instanceof InwardError && error.kind === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <>
      <PageHeader
        title={`Scan · ${overview.request.code}`}
        subtitle={`${overview.request.importer} → ${overview.request.warehouse}`}
        leading={
          <Link href={`/admin/inward/${id}`} className="text-sm text-verdigris-200/60 hover:text-patina" aria-label="Back to the request">
            ←
          </Link>
        }
      />
      <ScanStation initial={overview} />
    </>
  );
}
