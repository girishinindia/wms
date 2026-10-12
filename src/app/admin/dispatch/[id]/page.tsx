import Link from "next/link";

import WorkStation from "@/components/admin/dispatch/WorkStation";
import { Denied } from "@/components/admin/ui";
import { pageGuard } from "@/lib/auth/guard";
import { canSeeWork, workDetail } from "@/lib/dispatch/ops";
import { InwardError } from "@/lib/inward/ops";

export const dynamic = "force-dynamic";

/** /admin/dispatch/{id} — one delivery note's pick list, scan station and packages. */
export default async function WorkPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await pageGuard("package.read");
  if (!guard.ok || !canSeeWork(guard.actor)) return <Denied what="pick & pack" />;
  const id = Number((await params).id);
  let work;
  try {
    work = await workDetail(guard.actor, id);
  } catch (error) {
    if (error instanceof InwardError) return <Denied what="this delivery note" />;
    throw error;
  }
  return (
    <>
      <Link href="/admin/dispatch" className="mb-4 inline-block text-sm text-verdigris-200/65 hover:text-patina">
        ← Pick &amp; pack
      </Link>
      <WorkStation initial={work} />
    </>
  );
}
