import "server-only";

import { cookies, headers } from "next/headers";
import { cache } from "react";

import { HandledError } from "@/lib/api/respond";
import { auditQuietly } from "@/lib/audit";
import { authEnv } from "@/lib/env";

import {
  permissionsFor,
  rolesFor,
  type EffectivePermission,
  type RoleBinding,
} from "./account";
import { resolveSession, type ResolvedSession } from "./session";

/**
 * One place that answers "who is asking, and may they do this".
 *
 * There is deliberately no `middleware.ts`. Next middleware runs on the
 * edge runtime, where the Postgres driver does not exist — so a
 * middleware could check that a cookie is *present* but not that the
 * session behind it is live, that the user is still active, or what they
 * are allowed to do. Every handler would then have to check again, and
 * two authorisation paths that must agree are how a system ends up with
 * a route only one of them protects.
 *
 * So: one guard, called explicitly, in the request runtime where it can
 * see the database.
 *
 * The permission set comes from `wms.user_effective_permission`, which
 * has already collapsed every role the user holds to the widest scope
 * per permission and subtracted deny overrides. Nothing here reasons
 * about role names, and it should stay that way — the day somebody
 * writes `if (role === 'SUPER_ADMIN')` in a handler is the day the
 * permission matrix stops being the answer.
 */

export type Actor = {
  session: ResolvedSession;
  roles: RoleBinding[];
  permissions: EffectivePermission[];
  /** From a live SUPER_ADMIN assignment, for display only — never for
   *  an access decision. Use `grantFor` for those. */
  isSuperAdmin: boolean;
};

export type Grant = EffectivePermission;

/**
 * Read the caller's session from the cookie, or a bearer token.
 *
 * Bearer first, matching `/api/v1/devices`: a native client holds a
 * token and has no cookie jar, and a browser never sends the header.
 *
 * Wrapped in React's `cache()` below, so read the export, not this.
 */
async function resolveActor(): Promise<Actor | null> {
  const env = authEnv();
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);

  const bearer = headerList.get("authorization")?.replace(/^Bearer\s+/i, "");
  const session = await resolveSession(bearer || cookieStore.get(env.AUTH_COOKIE_NAME)?.value);
  if (!session) return null;

  const [roles, permissions] = await Promise.all([
    rolesFor(session.userId),
    permissionsFor(session.userId),
  ]);

  return {
    session,
    roles,
    permissions,
    isSuperAdmin: roles.some((r) => r.role === "SUPER_ADMIN"),
  };
}

/**
 * Once per request, however many times it is asked.
 *
 * Every admin page resolved the actor twice: the layout calls this to
 * decide which nav entries to render, and the page calls `pageGuard`,
 * which calls it again. Each resolution is three round trips — session,
 * roles, permissions — so a single screen opened with six auth queries
 * before it ran a query of its own, and Next renders the layout and the
 * page *concurrently*, so all six were in flight against a connection
 * pool sized at one. They queued behind each other, and the tab sat
 * there loading. That is the "keeps processing" report.
 *
 * `cache()` is per-request memoisation, not a cache in the ordinary
 * sense: the entry lives and dies with the request, and two users can
 * never see each other's actor. That property is what makes this safe to
 * apply to an authorisation lookup — anything with a longer life would
 * mean a signed-out session still resolving, or a revoked role still
 * granting.
 *
 * Deduplication is by argument, and this takes none, so the second call
 * anywhere in the request — layout, page, nested guard — gets the first
 * call's promise.
 */
export const currentActor = cache(resolveActor);

/** Signed in, or a 401. */
export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new HandledError("UNAUTHENTICATED", "Sign in to continue.");
  return actor;
}

/** The grant for a permission, or null when the actor does not hold it. */
export function grantFor(actor: Actor, permission: string): Grant | null {
  return actor.permissions.find((p) => p.permission === permission) ?? null;
}

export type RequireOptions = {
  /**
   * Which warehouse the action touches. A WAREHOUSE-scoped grant only
   * covers the warehouses named on the actor's own role assignments.
   */
  warehouseId?: number | null;
  /** Same, for an IMPORTER-domain grant. */
  importerId?: number | null;
  /** Recorded on the denial row so the log says what was refused. */
  entityType?: string;
  entityId?: string;
};

/**
 * Signed in AND holding the permission, at a scope that covers the
 * target — or a 403 with a `DENIED` audit row behind it.
 *
 * The audit row is the reason this is not three lines inline in each
 * handler. A refusal that leaves no trace answers "what happened" and
 * cannot answer "was somebody probing us", and the second question is
 * the one that gets asked after an incident.
 */
export async function requirePermission(
  permission: string,
  options: RequireOptions = {},
): Promise<{ actor: Actor; grant: Grant }> {
  const actor = await requireActor();
  const grant = grantFor(actor, permission);

  const refuse = async (reason: string): Promise<never> => {
    const headerList = await headers();
    await auditQuietly({
      action: `admin.${permission}`,
      operation: "DENY",
      entityType: options.entityType ?? permission.split(".").slice(0, -1).join("."),
      entityId: options.entityId ?? String(options.warehouseId ?? options.importerId ?? "-"),
      actorUserId: actor.session.userId,
      actorEmail: actor.session.email,
      actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
      result: "DENIED",
      reason,
      ip: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: headerList.get("user-agent"),
      metadata: {
        permission,
        warehouseId: options.warehouseId ?? null,
        importerId: options.importerId ?? null,
        heldScope: grant?.scope ?? null,
      },
    });
    // The same message whichever way it failed. "You do not hold
    // importer.approve" and "you hold it but not for warehouse 4" are
    // both a map of the permission matrix if you send enough requests.
    throw new HandledError("FORBIDDEN", "You do not have permission to do that.");
  };

  if (!grant) return refuse(`missing permission ${permission}`);

  if (grant.scope === "ALL") return { actor, grant };

  if (grant.scope === "WAREHOUSE") {
    // A warehouse-scoped grant with no warehouse named on the request is
    // a list or a create — the caller narrows the query with
    // grant.warehouseIds instead of asking here.
    if (options.warehouseId == null && options.importerId == null) {
      return { actor, grant };
    }
    if (options.warehouseId != null && grant.warehouseIds.includes(options.warehouseId)) {
      return { actor, grant };
    }
    if (options.importerId != null && grant.importerIds.includes(options.importerId)) {
      return { actor, grant };
    }
    return refuse(
      `scope WAREHOUSE does not cover warehouse ${options.warehouseId ?? "-"} / importer ${options.importerId ?? "-"}`,
    );
  }

  // OWN. Whether a row is "own" depends on the entity, so the handler
  // decides; the grant is returned so it can.
  return { actor, grant };
}

/**
 * The same check, for a server component that renders a page.
 *
 * Returns a verdict rather than throwing, because a page redirects to
 * the sign-in screen where an API route returns 401 — and a thrown
 * HandledError inside a React render is a 500, not a redirect.
 */
export async function pageGuard(
  permission: string,
): Promise<
  { ok: true; actor: Actor; grant: Grant } | { ok: false; reason: "anonymous" | "forbidden" }
> {
  const actor = await currentActor();
  if (!actor) return { ok: false, reason: "anonymous" };
  const grant = grantFor(actor, permission);
  if (!grant) return { ok: false, reason: "forbidden" };
  return { ok: true, actor, grant };
}
