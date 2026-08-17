import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { normalizeMobile } from "@/lib/normalize";

/**
 * Account lookup and lockout — the state a login handler needs, read in
 * one go.
 *
 * `users_login_idx` is a covering index over exactly these columns, so
 * this is an index-only scan and a rejected attempt never touches the
 * heap. That is not micro-optimisation: a credential-stuffing run is
 * thousands of failed logins a minute, and each one that reads the table
 * is work an attacker gets you to do for free.
 */

export type AccountRow = {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  mobile: string;
  passwordHash: string | null;
  status: string;
  lockedUntil: Date | null;
  failedLoginCount: number;
  emailVerifiedAt: Date | null;
  mobileVerifiedAt: Date | null;
  mustChangePassword: boolean;
};

/**
 * Find by email or mobile.
 *
 * `identifier` is whatever the user typed. An email match uses `citext`,
 * so case never matters; a mobile match runs through `normalizeMobile`,
 * so "+91 98765 43210" finds the same row as "9876543210".
 */
export async function findAccount(identifier: string): Promise<AccountRow | null> {
  const trimmed = identifier.trim();
  const asMobile = normalizeMobile(trimmed);
  const mobile = /^[6-9]\d{9}$/.test(asMobile) ? asMobile : null;

  const rows = await getDb().execute<{
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    mobile: string;
    password_hash: string | null;
    status: string;
    locked_until: string | null;
    failed_login_count: number;
    email_verified_at: string | null;
    mobile_verified_at: string | null;
    must_change_password: boolean;
  }>(sql`
    select id, email::text as email, first_name, last_name, mobile::text as mobile,
           password_hash, status::text as status, locked_until, failed_login_count,
           email_verified_at, mobile_verified_at, must_change_password
      from wms.users
     where deleted_at is null
       and (email = ${trimmed}::citext
            ${mobile ? sql`or mobile = ${mobile}::wms.mobile_in` : sql``})
     limit 1
  `);

  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    email: r.email,
    firstName: r.first_name,
    lastName: r.last_name,
    mobile: r.mobile,
    passwordHash: r.password_hash,
    status: r.status,
    lockedUntil: r.locked_until ? new Date(r.locked_until) : null,
    failedLoginCount: r.failed_login_count,
    emailVerifiedAt: r.email_verified_at ? new Date(r.email_verified_at) : null,
    mobileVerifiedAt: r.mobile_verified_at ? new Date(r.mobile_verified_at) : null,
    mustChangePassword: r.must_change_password,
  };
}

/**
 * Lockout thresholds.
 *
 * This is the control that survives an Upstash outage, so it is the one
 * that actually stops credential stuffing. The rate limiter is the cheap
 * first line; this is the durable one, because it lives in Postgres
 * alongside the account it protects.
 *
 * Escalating rather than fixed: five failures buys a 15-minute pause,
 * ten buys an hour. A fixed short lockout is barely an obstacle at
 * scale; a fixed long one hands an attacker a way to keep a real user
 * locked out indefinitely by failing on purpose.
 */
const LOCK_STEPS: Array<{ atFailures: number; minutes: number }> = [
  { atFailures: 10, minutes: 60 },
  { atFailures: 5, minutes: 15 },
];

export async function recordFailedLogin(userId: number): Promise<{
  failures: number;
  lockedUntil: Date | null;
}> {
  const rows = await getDb().execute<{
    failed_login_count: number;
    locked_until: string | null;
  }>(sql`
    update wms.users
       set failed_login_count = failed_login_count + 1,
           locked_until = case
             when failed_login_count + 1 >= ${LOCK_STEPS[0].atFailures}
               then now() + make_interval(mins => ${LOCK_STEPS[0].minutes})
             when failed_login_count + 1 >= ${LOCK_STEPS[1].atFailures}
               then now() + make_interval(mins => ${LOCK_STEPS[1].minutes})
             else locked_until
           end
     where id = ${userId}
    returning failed_login_count, locked_until
  `);
  const r = rows[0];
  return {
    failures: r?.failed_login_count ?? 0,
    lockedUntil: r?.locked_until ? new Date(r.locked_until) : null,
  };
}

/** Clear the counter on a successful sign-in, and stamp last-seen. */
export async function recordSuccessfulLogin(userId: number, ip?: string | null): Promise<void> {
  await getDb().execute(sql`
    update wms.users
       set failed_login_count = 0,
           locked_until = null,
           last_login_at = now(),
           last_login_ip = ${ip ?? null}::inet
     where id = ${userId}
  `);
}

export type RoleBinding = {
  role: string;
  domain: string;
  warehouseId: number | null;
  importerId: number | null;
};

/** Live role assignments. Served by `ura_user_active_idx` — index-only. */
export async function rolesFor(userId: number): Promise<RoleBinding[]> {
  const rows = await getDb().execute<{
    role: string;
    role_domain: string;
    warehouse_id: number | null;
    importer_id: number | null;
  }>(sql`
    select role::text as role, role_domain::text as role_domain,
           warehouse_id, importer_id
      from wms.user_role_assignment
     where user_id = ${userId} and revoked_at is null
     order by role::text
  `);
  return rows.map((r) => ({
    role: r.role,
    domain: r.role_domain,
    warehouseId: r.warehouse_id,
    importerId: r.importer_id,
  }));
}

export type EffectivePermission = {
  permission: string;
  scope: "OWN" | "WAREHOUSE" | "ALL";
  warehouseIds: number[];
  importerIds: number[];
};

/**
 * The collapsed permission set.
 *
 * Read from the `user_effective_permission` view, which takes the widest
 * scope per permission across every role the user holds and subtracts
 * deny overrides. Cache it per user rather than joining four tables on
 * every request — it changes when a role changes, which is rare.
 */
export async function permissionsFor(userId: number): Promise<EffectivePermission[]> {
  const rows = await getDb().execute<{
    permission: string;
    scope: "OWN" | "WAREHOUSE" | "ALL";
    warehouse_ids: number[] | null;
    importer_ids: number[] | null;
  }>(sql`
    select permission, scope::text as scope, warehouse_ids, importer_ids
      from wms.user_effective_permission
     where user_id = ${userId}
     order by permission
  `);
  return rows.map((r) => ({
    permission: r.permission,
    scope: r.scope,
    warehouseIds: r.warehouse_ids ?? [],
    importerIds: r.importer_ids ?? [],
  }));
}

/** Mark a channel verified. Idempotent. */
export async function markVerified(
  userId: number,
  channel: "EMAIL" | "SMS",
): Promise<void> {
  const column = channel === "EMAIL" ? sql`email_verified_at` : sql`mobile_verified_at`;
  await getDb().execute(sql`
    update wms.users set ${column} = coalesce(${column}, now()) where id = ${userId}
  `);
}

export async function setPassword(userId: number, hash: string): Promise<void> {
  await getDb().execute(sql`
    update wms.users
       set password_hash = ${hash},
           password_changed_at = now(),
           must_change_password = false,
           failed_login_count = 0,
           locked_until = null
     where id = ${userId}
  `);
}

/**
 * Create a self-registered account.
 *
 * NO ROLE IS ASSIGNED HERE, and that is deliberate. `IMPORTER` is
 * exclusive and immutable — once granted, not even a Super Admin can
 * change or revoke it. Granting it to an unverified signup means a
 * mistyped email address creates an account that can never be repaired.
 * The role goes on when the importer record is approved.
 *
 * Returns null when the email or mobile already exists, so the caller
 * can answer identically either way rather than confirming which
 * addresses are registered.
 */
export async function createSelfRegistration(input: {
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  companyName: string;
  passwordHash: string;
}): Promise<{ id: number } | null> {
  const rows = await getDb().execute<{ id: number }>(sql`
    insert into wms.users
      (email, first_name, last_name, mobile, password_hash,
       password_changed_at, signup_company_name, status)
    select ${input.email}::citext, ${input.firstName}, ${input.lastName},
           ${input.mobile}::wms.mobile_in, ${input.passwordHash}, now(),
           ${input.companyName}, 'PENDING'
     where not exists (
       select 1 from wms.users
        where deleted_at is null
          and (email = ${input.email}::citext or mobile = ${input.mobile}::wms.mobile_in)
     )
    returning id
  `);
  return rows[0] ?? null;
}
