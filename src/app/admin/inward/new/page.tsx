import { redirect } from "next/navigation";

import InwardForm from "@/components/admin/InwardForm";
import { Denied, PageHeader } from "@/components/admin/ui";
import { importerGateFor, importerIdOf, pageGuard } from "@/lib/auth/guard";
import { lookupsFor } from "@/lib/inward/ops";

export const dynamic = "force-dynamic";

export default async function NewInwardPage() {
  const guard = await pageGuard("inward.request.create");
  if (!guard.ok) return <Denied what="inward requests" />;
  const gate = await importerGateFor(guard.actor);
  if (gate.kind === "importer" && !gate.verified) redirect("/admin");
  const importerId = importerIdOf(guard.actor);
  if (importerId === null) return <Denied what="inward requests — your account is not linked to an importer" />;

  const lookups = await lookupsFor(importerId);
  return (
    <>
      <PageHeader title="New inward request" subtitle="Four sections. Save a draft any time; submit when the dock should know." />
      <InwardForm lookups={lookups} existing={null} />
    </>
  );
}
