import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { dropCachedActor, invalidateUser } from "@/lib/cache/actor";
import { authEnv } from "@/lib/env";

import { generateSessionToken, hashToken } from "./tokens";

/**
 * Sessions, in `wms.user_session`.
 *
 * Database-backed rather than a self-contained JWT, and that is the
 * central choice here. A JWT cannot be revoked: "log out everywhere" and
 * "this account was compromised, kill its sessions" both become "wait
 * for the token to expire". For a warehouse system where a lost handset
 * is a routine event, that is the wrong trade. The cost is one indexed
 * lookup per request, served by `user_session_user_idx` and the unique
 * index on `token_hash`.
 *
 * Two lifetimes, both enforced:
 *   idle     — a session unused for AUTH_SESSION_IDLE_TTL dies, so an
 *              abandoned session on a shared terminal does not live on.
 *   absolute — every session dies at AUTH_SESSION_ABSOLUTE_TTL from
 *              issue, however active it has been. Without this an
 *              attacker who gets a token keeps it forever by using it.
 */

export type SessionContext = {
  ip?: string | null;
  userAgent?: string | null;
  deviceName?: string | null;
  platform?: "WEB" | "ANDROID" | "IOS" | null;
};

export type IssuedSession = {
  /** The plaintext token. Goes in the cookie; never stored. */
  token: string;
  sessionId: number;
  expiresAt: Date;
};

/**
 * `expires_at` on the row is the ABSOLUTE deadline. Idle expiry is
 * derived from `last_seen_at` at read time, so extending an active
 * session is an UPDATE of one timestamp rather than a re-issue.
 */
export async function issueSession(
  userId: number,
  context: SessionContext = {},
): Promise<IssuedSession> {
  const env = authEnv();
  const token = generateSessionToken();

  const rows = await getDb().execute<{ id: number; expires_at: string }>(sql`
    insert into wms.user_session
      (user_id, token_hash, ip, user_agent, device_name, platform, expires_at)
    values (
      ${userId}, ${hashToken(token)}, ${context.ip ?? null}::inet,
      ${context.userAgent ?? null}, ${context.deviceName ?? null},
      ${context.platform ?? null},
      now() + make_interval(secs => ${env.AUTH_SESSION_ABSOLUTE_TTL})
    )
    returning id, expires_at
  `);

  const row = rows[0];
  if (!row) throw new Error("Failed to create a session");
  return { token, sessionId: row.id, expiresAt: new Date(row.expires_at) };
}

export type ResolvedSession = {
  sessionId: number;
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  activeRole: string | null;
  activeWarehouseId: number | null;
  activeImporterId: number | null;
};

/**
 * Resolve a cookie token to a live session, and touch `last_seen_at`.
 *
 * One statement. A SELECT followed by an UPDATE would let a request
 * squeeze through between the two after another request revoked the
 * session, and would double the round trips on the hottest path in the
 * application.
 *
 * The user's own state is checked here too: a suspended or soft-deleted
 * account must stop working immediately, not at the next login. Without
 * the join, deactivating somebody leaves their existing session alive
 * for up to thirty days.
 */
export async function resolveSession(token: string | undefined): Promise<ResolvedSession | null> {
  if (!token) return null;
  const env = authEnv();

  const rows = await getDb().execute<{
    id: number;
    user_id: number;
    email: string;
    first_name: string;
    last_name: string;
    status: string;
    active_role: string | null;
    active_warehouse_id: number | null;
    active_importer_id: number | null;
  }>(sql`
    update wms.user_session s
       set last_seen_at = now()
      from wms.users u
     where s.token_hash = ${hashToken(token)}
       and u.id = s.user_id
       and s.revoked_at is null
       and s.expires_at > now()
       and s.last_seen_at > now() - make_interval(secs => ${env.AUTH_SESSION_IDLE_TTL})
       and u.deleted_at is null
       and u.status = 'ACTIVE'
    returning s.id, s.user_id, u.email::text as email, u.first_name, u.last_name,
              u.status::text as status, s.active_role::text as active_role,
              s.active_warehouse_id, s.active_importer_id
  `);

  const row = rows[0];
  if (!row) return null;
  return {
    sessionId: row.id,
    userId: row.user_id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    status: row.status,
    activeRole: row.active_role,
    activeWarehouseId: row.active_warehouse_id,
    activeImporterId: row.active_importer_id,
  };
}

/** Revoke one session — logout. Idempotent. */
export async function revokeSession(token: string, reason = "logout"): Promise<void> {
  await getDb().execute(sql`
    update wms.user_session
       set revoked_at = now(), revoked_reason = ${reason}
     where token_hash = ${hashToken(token)}
       and revoked_at is null
  `);
  await dropCachedActor(token);
}

/**
 * Revoke every session for a user.
 *
 * Called after a password reset. If the reason someone reset their
 * password is that somebody else had it, leaving that person's session
 * alive defeats the whole exercise — which is the single most common
 * way a "successful" password reset achieves nothing.
 *
 * `exceptSessionId` lets the caller keep the session doing the resetting.
 */
export async function revokeAllSessions(
  userId: number,
  reason: string,
  exceptSessionId?: number,
): Promise<number> {
  const rows = await getDb().execute<{ id: number }>(sql`
    update wms.user_session
       set revoked_at = now(), revoked_reason = ${reason}
     where user_id = ${userId}
       and revoked_at is null
       ${exceptSessionId ? sql`and id <> ${exceptSessionId}` : sql``}
    returning id
  `);
  // Cached actors for this user must go with the sessions — including
  // the one kept alive by `exceptSessionId`, which is rebuilt on its next
  // request with the current rights.
  await invalidateUser(userId);
  return rows.length;
}

/**
 * Cookie options.
 *
 * `httpOnly` so script cannot read the token; `sameSite: lax` so it
 * still travels on a top-level navigation back from an email link but
 * not on a cross-site POST; `secure` off only in local development,
 * where there is no TLS to be secure over.
 *
 * `domain` is left UNSET unless AUTH_COOKIE_DOMAIN is deliberately
 * populated. Setting it to the bare domain shares the session cookie
 * with every sibling host — a staging site, a marketing page, anything
 * on the same apex — which is a much wider blast radius than it looks.
 */
export function sessionCookieOptions(maxAgeSeconds: number) {
  const env = authEnv();
  return {
    name: env.AUTH_COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
    ...(env.AUTH_COOKIE_DOMAIN ? { domain: env.AUTH_COOKIE_DOMAIN } : {}),
  };
}

/**
 * Delete expired and long-revoked rows.
 *
 * Not a nightly truncate: revoked sessions are evidence. Kept for seven
 * days so "which device was this signed in from when the incident
 * happened" is still answerable, then removed.
 */
export async function pruneSessions(): Promise<number> {
  const rows = await getDb().execute<{ id: number }>(sql`
    delete from wms.user_session
     where (expires_at < now() - interval '7 days')
        or (revoked_at is not null and revoked_at < now() - interval '7 days')
    returning id
  `);
  return rows.length;
}
