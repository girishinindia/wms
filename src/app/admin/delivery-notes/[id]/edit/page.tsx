import Link from "next/link";

import DeliveryNoteEdit from "@/components/admin/delivery/DeliveryNoteEdit";
import { Denied, PageHeader } from "@/components/admin/ui";
import { pageGuard } from "@/lib/auth/guard";
import { dnScope, getNote } from "@/lib/delivery/ops";
import { InwardError } from "@/lib/inward/ops";

export const dynamic = "force-dynamic";

export default async function EditDeliveryNotePage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await pageGuard("dispatch.order.read");
  if (!guard.ok) return <Denied what="delivery notes" />;
  const id = Number((await params).id);
  let note;
  try {
    note = await getNote(dnScope(guard.actor, guard.grant), guard.actor, id);
  } catch (error) {
    if (error instanceof InwardError) return <Denied what="this delivery note" />;
    throw error;
  }
  if (!note.can.edit) {
    return (
      <>
        <PageHeader title={`Delivery note ${note.dnNo}`} />
        <p className="text-sm text-verdigris-200/70">
          {note.status === "REJECTED"
            ? "A rejected delivery note cannot be changed. Make a new one."
            : "Only the sales agent who made it, or the importer, can change it."}{" "}
          <Link href={`/admin/delivery-notes/${note.id}`} className="text-patina underline">Back</Link>
        </p>
      </>
    );
  }
  const isImporter = guard.actor.roles.some((r) => r.role === "IMPORTER" && r.importerId === note.importerId);
  return (
    <>
      <PageHeader title={`Edit ${note.dnNo}`} subtitle={`${note.warehouseName} · ${note.buyerName}`} />
      <DeliveryNoteEdit note={note} isImporter={isImporter} />
    </>
  );
}
