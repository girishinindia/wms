import Link from "next/link";

import DoStation from "@/components/admin/outward/DoStation";
import { Denied } from "@/components/admin/ui";
import { pageGuard } from "@/lib/auth/guard";
import { InwardError } from "@/lib/inward/ops";
import { doDetail } from "@/lib/outward/ops";

export const dynamic = "force-dynamic";

/** /admin/outward/{id} — one Dispatch Order: checks, transport, loading scan, departure, LR. */
export default async function DoPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await pageGuard("outward.order.read");
  if (!guard.ok) return <Denied what="dispatch orders" />;
  const id = Number((await params).id);
  let order;
  try {
    order = await doDetail(guard.actor, id);
  } catch (error) {
    if (error instanceof InwardError) return <Denied what="this dispatch order" />;
    throw error;
  }
  return (
    <>
      <Link href="/admin/outward" className="mb-4 inline-block text-sm text-verdigris-200/65 hover:text-patina">
        ← Outward
      </Link>
      <DoStation initial={order} />
    </>
  );
}
