import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { fail } from "@/lib/api/respond";
import { importerIdOf, type Actor, type Grant } from "@/lib/auth/guard";

/**
 * Which sales agents a request is about.
 *
 * There are three answers, not two, and missing the third is what let a
 * sales agent read their colleagues:
 *
 *   ALL scope, super admin    every agent, or one company's with ?importerId=
 *   OWN scope, the owner      their company's agents
 *   OWN scope, an agent       themselves, and nobody else
 *
 * The trap is that the last two are indistinguishable by permission —
 * IMPORTER and SALES_AGENT both hold `sales_agent.read` at OWN, and
 * `importerIdOf()` answers with the COMPANY for either of them, because
 * an agent's role assignment names the company they work for. Asked only
 * "which importer?", the honest answer for an agent is still the whole
 * company. So the question has to be asked differently.
 */

export type AgentScope = {
  /** null with ALL scope and no `?importerId=` — every company. */
  importerId: number | null;
  /** Set when the caller is an agent: their own row is the whole world. */
  selfUserId: number | null;
};

/** Someone who works FOR a company rather than owning it. */
export function isAgentOnly(actor: Actor): boolean {
  return (
    actor.roles.some((r) => r.role === "SALES_AGENT") &&
    !actor.roles.some((r) => r.role === "IMPORTER")
  );
}

export function resolveImporterScope(
  actor: Actor,
  grant: Grant,
  requested: number | null | undefined,
  requestId: string,
): AgentScope | { response: ReturnType<typeof fail> } {
  if (grant.scope === "ALL") {
    return { importerId: requested ?? null, selfUserId: null };
  }
  const own = importerIdOf(actor);
  if (own === null) {
    return { response: fail("FORBIDDEN", "You are not linked to an importer", requestId) };
  }
  // An id in the body is not an authorisation, so it is ignored here.
  return {
    importerId: own,
    selfUserId: isAgentOnly(actor) ? actor.session.userId : null,
  };
}

/**
 * The one WHERE clause every listing builds from, so the page, the list
 * endpoint and the by-id endpoint cannot come to different conclusions
 * about who is visible.
 */
export function agentWhere(scope: AgentScope): SQL {
  if (scope.selfUserId !== null) return sql`a.user_id = ${scope.selfUserId}`;
  if (scope.importerId === null) return sql`true`;
  return sql`a.importer_id = ${scope.importerId}`;
}

/** Whether one already-loaded agent falls inside the scope. */
export function agentInScope(
  scope: AgentScope,
  agent: { importerId: number; userId: number | null },
): boolean {
  if (scope.selfUserId !== null) return agent.userId === scope.selfUserId;
  if (scope.importerId === null) return true;
  return agent.importerId === scope.importerId;
}
