import { notFound, redirect } from "next/navigation";

import InwardForm from "@/components/admin/InwardForm";
import { Denied, PageHeader } from "@/components/admin/ui";
import { importerGateFor, pageGuard } from "@/lib/auth/guard";
import { getRequest, InwardError, lookupsFor, scopeFor } from "@/lib/inward/ops";

export const dynamic = "force-dynamic";

export default async function EditInwardPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await pageGuard("inward.request.update");
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
  // A request that is no longer the importer's to edit is read, not edited.
  if (!detail.can.edit) redirect(`/admin/inward/${id}`);

  const lookups = await lookupsFor(detail.importer.id);
  return (
    <>
      <PageHeader title={`Edit ${detail.code}`} subtitle={`${detail.statusLabel} · ${detail.warehouse.name}`} />
      <InwardForm lookups={lookups} existing={detail} />
    </>
  );
}
