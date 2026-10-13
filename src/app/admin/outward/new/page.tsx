import Link from "next/link";

import CreateDo from "@/components/admin/outward/CreateDo";
import { Denied, PageHeader } from "@/components/admin/ui";
import { pageGuard } from "@/lib/auth/guard";
import { InwardError } from "@/lib/inward/ops";
import { newDoData } from "@/lib/outward/ops";

export const dynamic = "force-dynamic";

/** /admin/outward/new?note={id} — a Dispatch Order from the verified packages of one delivery note. */
export default async function NewDoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const guard = await pageGuard("outward.order.create");
  if (!guard.ok) return <Denied what="dispatch orders" />;
  const noteId = Number((await searchParams).note);
  if (!Number.isInteger(noteId) || noteId <= 0) return <Denied what="this delivery note" />;
  let data;
  try {
    data = await newDoData(guard.actor, noteId);
  } catch (error) {
    if (error instanceof InwardError) return <Denied what="this delivery note" />;
    throw error;
  }
  return (
    <>
      <Link href="/admin/outward" className="mb-4 inline-block text-sm text-verdigris-200/65 hover:text-patina">
        ← Outward
      </Link>
      <PageHeader title="New dispatch order" subtitle={`From delivery note ${data.note.dnNo} — one dispatch order per vehicle.`} />
      <CreateDo data={data} />
    </>
  );
}
