import { redirect } from "next/navigation";

import InwardTable from "@/components/admin/InwardTable";
import { Denied, PageHeader } from "@/components/admin/ui";
import { grantFor, importerGateFor, pageGuard } from "@/lib/auth/guard";
import { filtersFromParams } from "@/lib/inward/board";
import { listBoard, scopeFor } from "@/lib/inward/ops";

export const dynamic = "force-dynamic";

/**
 * /admin/inward — both sides of the counter.
 *
 * The importer sees their company's requests and may raise one; the
 * dock sees what is addressed to its sites. `scopeFor` decides from the
 * grant, the same way the API does, so the page and the endpoints can
 * never disagree about who sees what.
 */
export default async function InwardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = await pageGuard("inward.request.read");
  if (!guard.ok) return <Denied what="inward requests" />;

  const gate = await importerGateFor(guard.actor);
  if (gate.kind === "importer" && !gate.verified) redirect("/admin");

  const raw = await searchParams;
  const initial = filtersFromParams(raw);
  const scope = scopeFor(guard.actor, guard.grant);
  // Every request in reach, every status — the screen filters as you type.
  const board = await listBoard(scope);
  const dock = scope.side === "warehouse";

  return (
    <>
      <PageHeader
        title={dock ? "Inward inbox" : "Inward requests"}
        subtitle={
          dock
            ? "Goods importers have told your sites to expect."
            : "Tell the warehouse what is coming, so the dock is ready when the lorry is."
        }
      />
      <InwardTable
        rows={board.rows}
        truncated={board.truncated}
        side={scope.side}
        initial={initial}
        canCreate={!dock && grantFor(guard.actor, "inward.request.create") !== null}
      />
    </>
  );
}
