import { redirect } from "next/navigation";

import DeliveryNoteForm from "@/components/admin/delivery/DeliveryNoteForm";
import { Denied, PageHeader } from "@/components/admin/ui";
import { importerGateFor, importerIdOf, pageGuard } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/** /admin/delivery-notes/new — the sales agent (or the importer) sends goods to a buyer. */
export default async function NewDeliveryNotePage() {
  const guard = await pageGuard("dispatch.order.create");
  if (!guard.ok || importerIdOf(guard.actor) === null) return <Denied what="new delivery notes" />;
  const gate = await importerGateFor(guard.actor);
  if (gate.kind === "importer" && !gate.verified) redirect("/admin");
  return (
    <>
      <PageHeader title="New delivery note" subtitle="Buyer, transport and the cartons to send. One note per warehouse." />
      <DeliveryNoteForm />
    </>
  );
}
