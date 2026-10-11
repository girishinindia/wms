import Link from "next/link";

import DeliveryNoteDetail from "@/components/admin/delivery/DeliveryNoteDetail";
import { Denied } from "@/components/admin/ui";
import { pageGuard } from "@/lib/auth/guard";
import { dnScope, getNote } from "@/lib/delivery/ops";
import { InwardError } from "@/lib/inward/ops";

export const dynamic = "force-dynamic";

export default async function DeliveryNotePage({ params }: { params: Promise<{ id: string }> }) {
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
  return (
    <>
      <Link href="/admin/delivery-notes" className="mb-4 inline-block text-sm text-verdigris-200/65 hover:text-patina">
        ← Delivery notes
      </Link>
      <DeliveryNoteDetail note={note} />
    </>
  );
}
