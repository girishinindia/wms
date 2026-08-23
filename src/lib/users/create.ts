import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { auditQuietly } from "@/lib/audit";
import type { Actor } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { announce } from "@/lib/notify/announce";
import { absoluteUrl } from "@/lib/url";
import { mayAssign } from "@/lib/users/authority";
import { type InviteStatus, sendInvite, temporaryPassword } from "@/lib/users/invite";

/**
 * Creating a staff login.
 *
 * Every rule about who may do this lives in `authority.ts`, which reads
 * `role_creation_rule`. This file is the doing: make a password, write
 * the row, bind the role, tell the people who need telling.
 *
 * The password itself is minted and sent by `invite.ts` and never comes
 * back out of this function — see `CreatedUser`.
 */

export class UserCreateError extends Error {
  constructor(
    readonly kind: "VALIDATION_FAILED" | "CONFLICT" | "FORBIDDEN",
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "UserCreateError";
  }
}

/** Re-exported: it lived here first, and `tests/users.test.ts` and any
 *  future caller should not have to know it moved. */
export { temporaryPassword };

export type CreateUserInput = {
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  role: string;
  warehouseId: number | null;
  note?: string;
};

export type CreatedUser = {
  id: number;
  email: string;
  name: string;
  role: string;
  roleLabel: string;
  warehouseLabel: string | null;
  /**
   * What happened to the email — NOT the password.
   *
   * The password used to be returned here and shown in a dialog. That
   * put it in the API response, in the browser's network tab, and in
   * front of whoever was standing behind the person creating the
   * account. It now leaves the server only inside the email, and the
   * way back from a send that did not happen is
   * `POST /admin/users/{id}/invite`, which mints a new one.
   */
  emailStatus: InviteStatus;
};

type Meta = { requestId: string; ip: string | null; userAgent: string | null };

export async function createUser(
  input: CreateUserInput,
  actor: Actor,
  meta: Meta,
): Promise<CreatedUser> {
  // Authority first: no row is written for a request that was never
  // allowed to write one.
  const verdict = await mayAssign(actor, input.role, input.warehouseId);
  if (!verdict.ok) {
    /**
     * A refused attempt is worth as much as a successful one.
     *
     * `requirePermission` writes a DENIED row for the refusals IT makes,
     * and a warehouse admin reaching for another branch's staff sails
     * straight past it — they do hold `user.create`. Without this line
     * that attempt leaves no trace at all, which is precisely the kind
     * of attempt worth being able to look up later.
     */
    if (verdict.kind === "FORBIDDEN") {
      await auditQuietly({
        action: "admin.user.create",
        operation: "DENY",
        entityType: "user",
        entityId: "-",
        entityLabel: input.email,
        actorUserId: actor.session.userId,
        actorEmail: actor.session.email,
        actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
        result: "DENIED",
        reason: verdict.reason,
        metadata: { role: input.role, warehouseId: input.warehouseId },
        ip: meta.ip,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
      });
    }
    throw new UserCreateError(
      verdict.kind,
      verdict.reason,
      verdict.field ? { [verdict.field]: verdict.reason } : undefined,
    );
  }

  const [role] = await getDb().execute<{ name: string }>(sql`
    select name from wms.role where key::text = ${input.role}
  `);
  if (!role) throw new UserCreateError("VALIDATION_FAILED", "No such role", { role: "Unknown role" });

  let warehouseLabel: string | null = null;
  if (verdict.warehouseId !== null) {
    const [w] = await getDb().execute<{ label: string }>(sql`
      select code || ' · ' || name as label
        from wms.warehouse
       where id = ${verdict.warehouseId} and deleted_at is null and is_active
    `);
    if (!w) {
      throw new UserCreateError("VALIDATION_FAILED", "Not an active warehouse", {
        warehouseId: "Not an active warehouse",
      });
    }
    warehouseLabel = w.label;
  }

  const temp = temporaryPassword();
  const hash = await hashPassword(temp);
  const name = `${input.firstName} ${input.lastName}`.trim();

  /**
   * One statement, so a login can never exist without its role.
   *
   * The `where not exists` is the duplicate check and the insert at the
   * same time — checking first and inserting after is a race two people
   * adding the same person can lose.
   */
  const rows = await getDb().execute<{ id: number }>(sql`
    with new_user as (
      insert into wms.users
        (email, first_name, last_name, mobile, password_hash, password_changed_at,
         email_verified_at, mobile_verified_at, status, must_change_password, created_by)
      select ${input.email}::citext, ${input.firstName}, ${input.lastName},
             ${input.mobile}::wms.mobile_in, ${hash}, now(), now(), now(),
             'ACTIVE', true, ${actor.session.userId}
       where not exists (
         select 1 from wms.users
          where deleted_at is null
            and (email = ${input.email}::citext or mobile = ${input.mobile}::wms.mobile_in)
       )
      returning id
    ),
    bound as (
      insert into wms.user_role_assignment
        (user_id, role, role_domain, warehouse_id, assigned_by, note)
      select id, ${input.role}::wms.role_key, ${verdict.domain}::wms.role_domain,
             ${verdict.warehouseId}, ${actor.session.userId},
             ${input.note ?? "Created from the Users screen"}
        from new_user
      returning user_id
    )
    select id from new_user
  `);

  const id = rows[0]?.id;
  if (!id) {
    throw new UserCreateError("CONFLICT", "An account with that email or mobile already exists", {
      email: "Already in use",
    });
  }

  await auditQuietly({
    action: "user.created",
    operation: "INSERT",
    entityType: "user",
    entityId: String(id),
    entityLabel: `${name} <${input.email}>`,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    // Never the password, and never its hash.
    after: { email: input.email, role: input.role, warehouseId: verdict.warehouseId },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });

  /**
   * Two messages, and the split is deliberate.
   *
   * `announce` renders from templates and PERSISTS what it renders into
   * `wms.notification`. A temporary password put through it would be
   * stored in the database in plain text, readable by anyone with the
   * notifications screen — worse than the email it was trying to
   * replace. So `announce` carries the news (super admins get in-app,
   * email and push; the new user gets a confirmation) and the password
   * travels in a direct send that is not stored.
   */
  const whereSuffix = warehouseLabel ? ` at ${warehouseLabel}` : "";
  await announce({
    eventKey: "user.created",
    values: {
      name,
      role: role.name,
      whereSuffix,
      actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
      // `absoluteUrl` returns null when APP_URL is unset; the
      // template then reads "" rather than "null".
      signInUrl: absoluteUrl("/sign-in") ?? "",
    },
    dedupeSuffix: `user-${id}`,
    actorUserId: actor.session.userId,
    entityType: "user",
    entityId: String(id),
    warehouseId: verdict.warehouseId,
    correlationId: meta.requestId,
  }).catch((error: unknown) => {
    // A notification that fails must not undo an account that exists.
    console.error("[users] user.created not announced", {
      userId: id,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const emailStatus = await sendInvite({
    toEmail: input.email,
    toName: name,
    roleLine: ` as ${role.name}${whereSuffix}`,
    temp,
  });

  return {
    id: Number(id),
    email: input.email,
    name,
    role: input.role,
    roleLabel: role.name,
    warehouseLabel,
    emailStatus,
  };
}
