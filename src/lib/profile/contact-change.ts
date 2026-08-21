import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { auditQuietly } from "@/lib/audit";
import type { Actor } from "@/lib/auth/guard";
import { dispatchOtp, type DispatchResult } from "@/lib/auth/dispatch-otp";
import { verifyOtp } from "@/lib/auth/otp";
import { revokeAllSessions } from "@/lib/auth/session";

/**
 * Changing the address you sign in with — email or mobile — is not an
 * edit, it is a hand-over. The new address has to prove it is really
 * reachable (an OTP goes THERE, never to the old one), and once it is
 * proved, every session is revoked so the change takes effect cleanly
 * at the next sign-in.
 *
 * The pending target is not stored in a column of its own: the OTP row
 * already carries `sent_to`, so the verified token IS the record of
 * where the code went — nothing to reconcile.
 */

type Meta = { requestId: string; ip: string | null; userAgent: string | null };

export async function startEmailChange(
  actor: Actor,
  newEmail: string,
  meta: Meta,
): Promise<{ error: string } | { dispatched: DispatchResult }> {
  const taken = await getDb().execute<{ id: number }>(sql`
    select id from wms.users where deleted_at is null and email = ${newEmail}::citext
  `);
  if (taken.length > 0) return { error: "That email already belongs to another account" };
  return {
    dispatched: await dispatchOtp({
      userId: actor.session.userId,
      purpose: "updateEmail",
      firstName: actor.session.firstName,
      email: newEmail,
      mobile: "",
      only: "EMAIL",
      ip: meta.ip,
      correlationId: meta.requestId,
    }),
  };
}

export async function startMobileChange(
  actor: Actor,
  newMobile: string,
  meta: Meta,
): Promise<{ error: string } | { dispatched: DispatchResult }> {
  const taken = await getDb().execute<{ id: number }>(sql`
    select id from wms.users where deleted_at is null and mobile = ${newMobile}::wms.mobile_in
  `);
  if (taken.length > 0) return { error: "That mobile number already belongs to another account" };
  return {
    dispatched: await dispatchOtp({
      userId: actor.session.userId,
      purpose: "updateMobile",
      firstName: actor.session.firstName,
      email: "",
      mobile: newMobile,
      only: "SMS",
      ip: meta.ip,
      correlationId: meta.requestId,
    }),
  };
}

/**
 * Verify the code and swap the address. Returns the new address, or an
 * error string the form can show. The token's own `sent_to` is the
 * target — the client cannot verify a code for one address and have a
 * different one written.
 */
export async function verifyContactChange(
  actor: Actor,
  kind: "email" | "mobile",
  code: string,
  meta: Meta,
): Promise<{ ok: true; address: string } | { error: string }> {
  const channel = kind === "email" ? ("EMAIL" as const) : ("SMS" as const);
  const purpose = kind === "email" ? ("EMAIL_VERIFY" as const) : ("MOBILE_VERIFY" as const);
  const userId = actor.session.userId;

  const result = await verifyOtp({ userId, purpose, channel, code });
  if (!result.ok) {
    return {
      error:
        result.reason === "EXPIRED"
          ? "That code has expired — request a new one"
          : result.reason === "TOO_MANY_ATTEMPTS"
            ? "Too many wrong attempts — request a new code"
            : "That code is not right",
    };
  }

  const tokenRows = await getDb().execute<{ sent_to: string }>(sql`
    select sent_to from wms.user_verification_token where id = ${result.tokenId}
  `);
  const address = tokenRows[0]?.sent_to;
  if (!address) return { error: "Could not find where the code was sent" };

  // The uniqueness re-check happens here as the UPDATE: the partial
  // unique index refuses a race, and the caller reports it kindly.
  if (kind === "email") {
    await getDb().execute(sql`
      update wms.users
         set email = ${address}::citext, email_verified_at = now(), updated_by = ${userId}
       where id = ${userId} and deleted_at is null
    `);
  } else {
    await getDb().execute(sql`
      update wms.users
         set mobile = ${address}::wms.mobile_in, mobile_verified_at = now(), updated_by = ${userId}
       where id = ${userId} and deleted_at is null
    `);
  }

  // Importer-domain profiles carry the contact too; keep them in step.
  if (kind === "email") {
    await getDb().execute(sql`
      update wms.sales_agent set email = ${address}::citext where user_id = ${userId} and deleted_at is null
    `);
  } else {
    await getDb().execute(sql`
      update wms.sales_agent set mobile = ${address}::wms.mobile_in where user_id = ${userId} and deleted_at is null
    `).catch(() => { /* per-importer unique may refuse; the login is the truth */ });
  }

  const revoked = await revokeAllSessions(userId, `${kind} changed by the user`);
  await auditQuietly({
    action: kind === "email" ? "user.email_changed" : "user.mobile_changed",
    operation: "UPDATE",
    entityType: "user",
    entityId: String(userId),
    entityLabel: actor.session.email,
    actorUserId: userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    before: { [kind]: kind === "email" ? actor.session.email : undefined },
    after: { [kind]: address },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
    metadata: { sessionsRevoked: revoked },
  });
  return { ok: true, address };
}
