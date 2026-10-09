import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import InwardDetail from "@/components/admin/InwardDetail";
import { Denied, PageHeader } from "@/components/admin/ui";
import { importerGateFor, pageGuard } from "@/lib/auth/guard";
import { getRequest, InwardError, scopeFor } from "@/lib/inward/ops";

export const dynamic = "force-dynamic";

export default async function InwardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await pageGuard("inward.request.read");
  if (!guard.ok) return <Denied what="inward requests" />;
  const gate = await importerGateFor(guard.actor);
  if (gate.kind === "importer" && !gate.verified) redirect("/admin");

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  let detail;
  try {
    detail = await getRequest(guard.actor, scopeFor(guard.actor, guard.grant), id);
  } catch (error) {
    if (error instanceof InwardError && error.kind === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <>
      <PageHeader
        title={detail.code}
        subtitle={`${detail.statusLabel} · ${detail.importer.name} → ${detail.warehouse.name}`}
        leading={
          <Link href="/admin/inward" className="text-sm text-verdigris-200/60 hover:text-patina" aria-label="Back to inward requests">
            ←
          </Link>
        }
      />
      <InwardDetail detail={detail} />
    </>
  );
}
