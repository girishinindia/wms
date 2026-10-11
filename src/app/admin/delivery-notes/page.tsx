import Link from "next/link";
import { redirect } from "next/navigation";

import DeliveryNotesTable from "@/components/admin/delivery/DeliveryNotesTable";
import { Denied, PageHeader } from "@/components/admin/ui";
import { grantFor, importerGateFor, importerIdOf, pageGuard } from "@/lib/auth/guard";
import { dnScope, listNotes } from "@/lib/delivery/ops";

export const dynamic = "force-dynamic";

/**
 * /admin/delivery-notes — every delivery note this person may see, pending
 * ones first. The sales agent sees their own; the importer their company's;
 * the warehouse admin, package manager and outward manager their sites';
 * the super admin all. The page asks `dnScope` exactly as the API does.
 */
export default async function DeliveryNotesPage() {
  const guard = await pageGuard("dispatch.order.read");
  if (!guard.ok) return <Denied what="delivery notes" />;
  const gate = await importerGateFor(guard.actor);
  if (gate.kind === "importer" && !gate.verified) redirect("/admin");

  const scope = dnScope(guard.actor, guard.grant);
  const notes = await listNotes(scope);
  const canCreate = grantFor(guard.actor, "dispatch.order.create") !== null && importerIdOf(guard.actor) !== null;
  const isImporter = guard.actor.roles.some((r) => r.role === "IMPORTER");

  return (
    <>
      <PageHeader
        title="Delivery notes"
        subtitle={
          scope.kind === "agent"
            ? "Goods you are sending to your buyers — one note per warehouse."
            : scope.kind === "importer"
              ? "Your sales agents' delivery notes. Approve or reject the pending ones."
              : "Goods going out of your warehouses to buyers."
        }
        action={
          <div className="flex flex-wrap gap-2">
            {isImporter ? (
              <Link
                href="/admin/delivery-notes/settings"
                className="rounded-xl border border-verdigris-300/20 px-4 py-2.5 text-sm text-verdigris-100 hover:border-verdigris-300/45"
              >
                Numbering
              </Link>
            ) : null}
            {canCreate ? (
              <Link
                href="/admin/delivery-notes/new"
                id="dn-new"
                className="rounded-xl bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 hover:bg-patina"
              >
                New delivery note
              </Link>
            ) : null}
          </div>
        }
      />
      <DeliveryNotesTable notes={notes} showImporter={scope.kind === "all" || scope.kind === "warehouse"} showAgent={scope.kind !== "agent"} />
    </>
  );
}
