import "server-only";

import { randomInt } from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { auditQuietly } from "@/lib/audit";
import type { Actor } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { invalidateUsers } from "@/lib/cache/actor";
import { sendEmail } from "@/lib/notify/email";
import { absoluteUrl } from "@/lib/url";

/**
 * Sign-in details, minted and sent — never returned.
 *
 * The one rule this file exists to keep: a temporary password leaves the
 * server exactly once, inside an email addressed to the person it
 * belongs to. It is not in an API response, not in a log line, not in
 * `wms.notification`, and not on anybody's screen.
 *
 * That rule is why a "resend" mints a NEW password rather than repeating
 * the old one. The old one only exists as an argon2 hash, and it is
 * meant to: a system that can tell you a password back is a system that
 * stored it.
 *
 * Used twice — once when the account is created, and again whenever the
 * email did not arrive.
 */

/**
 * A temporary password a person can read down a phone line.
 *
 * Upper case and digits only, with `I`, `L`, `O`, `0` and `1` left out —
 * the pairs that are the same shape in most fonts. That is the whole of
 * the claim: `B`/`8`, `S`/`5` and `Z`/`2` are all still in, because
 * removing every arguable pair leaves an alphabet too small to be worth
 * having. Grouped in fours so it can be read out.
 *
 * `randomInt` is the CSPRNG, not `Math.random`. Twelve characters from
 * a 31-symbol alphabet is 59.5 bits — well short of what a permanent
 * password should carry, and ample for one that is rate-limited at the
 * login endpoint and replaced the first time it is used.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function temporaryPassword(): string {
  const pick = () => ALPHABET[randomInt(ALPHABET.length)]!;
  const group = () => Array.from({ length: 4 }, pick).join("");
  return `${group()}-${group()}-${group()}`;
}

/**
 * What happened to the email, passed back so the screen can say
 * something true rather than something reassuring.
 *
 * `SUPPRESSED` is not a failure — it is `APP_ENV` not being production,
 * which is the correct behaviour in a development environment and a
 * disaster in a live one. It is kept distinct from `FAILED` precisely so
 * the message can name the actual cause.
 */
export type InviteStatus = "SENT" | "SUPPRESSED" | "FAILED";

/** The email body. One place, so create and resend cannot drift. */
export function inviteMessage(roleLine: string, temp: string): string {
  return (
    `You have been added to Genius WMS${roleLine}.\n\n` +
    `Sign in with this email address and the temporary password below. ` +
    `You will be asked to choose your own password straight away.\n\n` +
    `Temporary password: ${temp}\n\n` +
    `If you were not expecting this, tell us and we will close the account.`
  );
}

/**
 * Send sign-in details to an address.
 *
 * Does NOT touch the database — the caller decides whether the password
 * being sent is one it just wrote (create) or one this function's
 * sibling has just written (resend). Kept separate so `createUser` can
 * hash the password into its single insert CTE without a second write.
 */
export async function sendInvite(input: {
  toEmail: string;
  toName: string;
  roleLine: string;
  temp: string;
}): Promise<InviteStatus> {
  const outcome = await sendEmail({
    toEmail: input.toEmail,
    toName: input.toName,
    subject: "Your Genius WMS sign-in details",
    message: inviteMessage(input.roleLine, input.temp),
    actionUrl: absoluteUrl("/sign-in") ?? undefined,
    actionLabel: "Sign in",
    // A failed send must never undo an account that exists.
  }).catch(() => ({ status: "FAILED" as const }));
  return outcome.status;
}

export class InviteError extends Error {
  constructor(
    readonly kind: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "InviteError";
  }
}

/**
 * Mint a fresh temporary password for an existing account and email it.
 *
 * The recovery path for "I never got the email", and the only way back
 * from a suppressed or bounced send. Three things happen together:
 *
 *   · a new password replaces the old hash, so the old one — wherever it
 *     got to — stops working the moment this is used;
 *   · `must_change_password` goes back on, so the temporary one cannot
 *     quietly become the permanent one;
 *   · every live session for that account is dropped from the actor
 *     cache, because their rights have not changed but their credentials
 *     have, and a stale cache entry is the wrong answer to both.
 *
 * The caller checks authority BEFORE calling this. `mayActOnUser` is not
 * repeated here on purpose: this module knows how to send an invite, not
 * who is allowed to.
 */
export async function resendInvite(
  userId: number,
  actor: Actor,
  meta: { requestId: string; ip: string | null; userAgent: string | null },
): Promise<{ email: string; status: InviteStatus }> {
  const [user] = await getDb().execute<{
    email: string;
    first_name: string;
    last_name: string;
    status: string;
    role_label: string | null;
    warehouse_name: string | null;
  }>(sql`
    select u.email::text as email, u.first_name, u.last_name, u.status::text as status,
           r.name as role_label, w.name as warehouse_name
      from wms.users u
      left join lateral (
        select ura.role, ura.warehouse_id
          from wms.user_role_assignment ura
          join wms.role rr on rr.key = ura.role
         where ura.user_id = u.id and ura.revoked_at is null
         order by rr.level desc
         limit 1
      ) top on true
      left join wms.role r on r.key = top.role
      left join wms.warehouse w on w.id = top.warehouse_id
     where u.id = ${userId} and u.deleted_at is null
  `);

  if (!user) throw new InviteError("NOT_FOUND", "No such user");

  /**
   * A suspended account must not be handed a working password. The
   * account still exists and the details would still arrive, which is
   * exactly the confusion worth refusing: it reads as reinstatement.
   */
  if (user.status !== "ACTIVE") {
    throw new InviteError(
      "VALIDATION_FAILED",
      `That account is ${user.status.toLowerCase()}. Reactivate it first, then send the details.`,
    );
  }

  const temp = temporaryPassword();
  const hash = await hashPassword(temp);

  await getDb().execute(sql`
    update wms.users
       set password_hash = ${hash},
           password_changed_at = now(),
           must_change_password = true,
           -- A fresh password is also the answer to "locked out after
           -- five bad guesses"; leaving the lock on would make this
           -- look like it had worked and then refuse the new password.
           failed_login_count = 0,
           locked_until = null
     where id = ${userId} and deleted_at is null
  `);

  await invalidateUsers([userId]);

  const name = `${user.first_name} ${user.last_name}`.trim();
  const roleLine = user.role_label
    ? ` as ${user.role_label}${user.warehouse_name ? ` at ${user.warehouse_name}` : ""}`
    : "";

  const status = await sendInvite({
    toEmail: user.email,
    toName: name,
    roleLine,
    temp,
  });

  await auditQuietly({
    action: "user.invite_resent",
    operation: "UPDATE",
    entityType: "user",
    entityId: String(userId),
    entityLabel: user.email,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    reason: "Sign-in details sent again",
    // The address and the outcome. Never the password, and never its
    // hash — an audit row is readable by anyone with `audit_log.read`.
    after: { email: user.email, emailStatus: status },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });

  return { email: user.email, status };
}
