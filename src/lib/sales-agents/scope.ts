import "server-only";

import { fail } from "@/lib/api/respond";
import { importerIdOf, type Actor, type Grant } from "@/lib/auth/guard";

/**
 * Which importer a sales-agent request is about.
 *
 * ALL scope (super admin): the request may name one; on create it must.
 * OWN scope (importer): always their own, whatever the request says — an
 * id in the body is not an authorisation, it is ignored.
 */
export function resolveImporterScope(
  actor: Actor,
  grant: Grant,
  requested: number | null | undefined,
  requestId: string,
): { importerId: number | null } | { response: ReturnType<typeof fail> } {
  if (grant.scope === "ALL") {
    return { importerId: requested ?? null };
  }
  const own = importerIdOf(actor);
  if (own === null) {
    return { response: fail("FORBIDDEN", "You are not linked to an importer", requestId) };
  }
  return { importerId: own };
}
