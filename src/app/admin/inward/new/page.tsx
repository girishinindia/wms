import { redirect } from "next/navigation";

import InwardForm from "@/components/admin/InwardForm";
import { Denied, PageHeader } from "@/components/admin/ui";
import { importerGateFor, importerIdOf, pageGuard } from "@/lib/auth/guard";
import { idFrom } from "@/lib/inward/http";
import { InwardError, lookupsFor } from "@/lib/inward/ops";

export const dynamic = "force-dynamic";

/**
 * An importer-side user writes for their own company. A platform user
 * (SUPER_ADMIN — `inward.request.create` at ALL, no company of their
 * own) writes for any importer: the form opens with an importer picker
 * and the rest fills in once one is chosen.
 */
export default async function NewInwardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = await pageGuard("inward.request.create");
  if (!guard.ok) return <Denied what="inward requests" />;
  const gate = await importerGateFor(guard.actor);
  if (gate.kind === "importer" && !gate.verified) redirect("/admin");

  const own = importerIdOf(guard.actor);
  const chooser = own === null && guard.grant.scope === "ALL";
  if (own === null && !chooser) {
    return <Denied what="inward requests — your account is not linked to an importer" />;
  }

  const raw = await searchParams;
  const wanted = typeof raw.importerId === "string" ? idFrom(raw.importerId) : null;
  const importerId = own ?? wanted;

  let lookups;
  try {
    lookups = await lookupsFor(importerId, { chooser });
  } catch (error) {
    // A stale ?importerId= — back to the picker rather than a 500.
    if (error instanceof InwardError && error.kind === "NOT_FOUND") redirect("/admin/inward/new");
    throw error;
  }

  return (
    <>
      <PageHeader
        title="New inward request"
        subtitle={
          chooser && lookups.importer
            ? `On behalf of ${lookups.importer.name}. Four sections; save a draft any time.`
            : "Four sections. Save a draft any time; submit when the dock should know."
        }
      />
      {/* Keyed on the importer so picking one remounts the form with their lookups. */}
      <InwardForm key={lookups.importer?.id ?? "none"} lookups={lookups} existing={null} />
    </>
  );
}
