import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import SalesAgentsTable, { type SalesAgentsSpec } from "@/components/admin/SalesAgentsTable";
import { Denied, PageHeader } from "@/components/admin/ui";
import { getDb } from "@/db";
import { loadGeoOptions } from "@/lib/admin/geo";
import { grantFor, importerGateFor, importerIdOf, pageGuard } from "@/lib/auth/guard";
import { listSalesAgents } from "@/lib/sales-agents/ops";
import { agentWhere, isAgentOnly } from "@/lib/sales-agents/scope";

export const dynamic = "force-dynamic";

/**
 * /admin/sales-agents — an importer's field people.
 *
 * Super admin: every importer's agents, with an importer column and an
 * importer picker on Add. Importer: their own, and only once verified —
 * an unverified importer is sent to their profile, which is the only
 * thing they can do until a super admin approves them.
 */
export default async function SalesAgentsPage() {
  const guard = await pageGuard("sales_agent.read");
  if (!guard.ok) return <Denied what="sales agents" />;

  const gate = await importerGateFor(guard.actor);
  if (gate.kind === "importer" && !gate.verified) redirect("/admin");

  /**
   * There is no list for an agent to look at — it would hold one row,
   * themselves — so the screen is not theirs. Their record is the
   * dashboard. The sidebar no longer offers this link; this is what
   * answers the URL typed by hand.
   */
  const selfOnly = isAgentOnly(guard.actor);
  if (selfOnly) redirect("/admin");

  const wide = guard.grant.scope === "ALL";
  const importerId = wide ? null : importerIdOf(guard.actor);
  if (!wide && importerId === null) return <Denied what="sales agents" />;

  /**
   * The self-scope stays even though the redirect above means no agent
   * reaches it. An agent is not a small importer — IMPORTER and
   * SALES_AGENT hold the same grant at the same scope and `importerIdOf`
   * answers with the company for both — and a filter that depends on a
   * redirect one screen up is a filter waiting to be wrong. The two API
   * routes ask `agentWhere` the same question.
   */
  const rows = await listSalesAgents(
    agentWhere({
      importerId: wide ? null : importerId,
      selfUserId: selfOnly ? guard.actor.session.userId : null,
    }),
  );
  const geo = await loadGeoOptions();
  const importers = wide
    ? (
        await getDb().execute<{ id: number; name: string; code: string }>(sql`
          select id, company_name as name, code from wms.importer
           where status = 'ACTIVE' and deleted_at is null order by company_name
        `)
      ).map((r) => ({ id: Number(r.id), name: r.name, code: r.code }))
    : [];

  const spec: SalesAgentsSpec = {
    canCreate: grantFor(guard.actor, "sales_agent.create") !== null,
    canUpdate: grantFor(guard.actor, "sales_agent.update") !== null,
    canDelete: grantFor(guard.actor, "sales_agent.delete") !== null,
    crossImporter: wide,
    importers,
    geo,
  };

  return (
    <>
      <PageHeader
        title="Sales agents"
        subtitle={
          wide
            ? "Field sales people across every importer."
            : "Your field sales people. Each can sign in to the mobile app."
        }
      />
      <SalesAgentsTable rows={rows} spec={spec} />
    </>
  );
}
