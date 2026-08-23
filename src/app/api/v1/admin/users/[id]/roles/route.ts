import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { getDb } from "@/db";
import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { auditQuietly } from "@/lib/audit";
import { requirePermission, type Actor } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { invalidateUser } from "@/lib/cache/actor";
import { announce } from "@/lib/notify/announce";
import { absoluteUrl } from "@/lib/url";
import { isImmutableRole, mayManageUser } from "@/lib/users/authority";
import { assignRoleRequestSchema, revokeRoleRequestSchema } from "@/lib/validation/api-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Role assignment.
 *
 * The interesting part of this file is how much of the rulebook it does
 * NOT contain. `wms.role_creation_rule` already says which role may
 * create which, and at what scope; `role.domain` already says whether an
 * assignment needs a warehouse or an importer; two triggers already
 * refuse to let an exclusive role sit beside another, or an immutable
 * one be edited at all. None of that is re-implemented here.
 *
 * What is here is the translation layer: read the rule, and turn a
 * database refusal into a sentence the person clicking the button can
 * act on. A constraint violation surfacing as a 500 is a correct system
 * with an unusable interface.
 */

const DOMAIN_COLUMN: Record<string, "warehouse" | "importer" | "none"> = {
  PLATFORM: "none",
  WAREHOUSE: "warehouse",
  IMPORTER: "importer",
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { id: rawId } = await context.params;
      const targetUserId = Number(rawId);
      if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        return fail("NOT_FOUND", "No such user", requestId);
      }

      const { actor } = await requirePermission("role.assign", {
        entityType: "user",
        entityId: String(targetUserId),
      });

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      }

      const parsed = assignRoleRequestSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const input = parsed.data;

      const target = await getDb().execute<{
        id: number;
        email: string;
        status: string;
        name: string;
      }>(sql`
        select id, email::text as email, status::text as status,
               trim(first_name || ' ' || last_name) as name
          from wms.users where id = ${targetUserId} and deleted_at is null
      `);
      if (target.length === 0) return fail("NOT_FOUND", "No such user", requestId);

      /**
       * ── May this actor touch THIS account at all? ───────────────
       *
       * Distinct from the question below it, and the reason a warehouse
       * admin could previously reach past their own branch: the rule
       * lookup asks "may you grant STORAGE_MANAGER at site 4", which is
       * yes if site 4 is theirs — but says nothing about whether the
       * person receiving it is one of their people or another branch's
       * manager. This asks that.
       */
      const may = await mayManageUser(actor, targetUserId);
      if (may !== true) {
        return fail("FORBIDDEN", may.reason, requestId);
      }

      // An immutable role is granted with the account it belongs to, by
      // the importer and sales-agent flows. Never from here.
      if (isImmutableRole(input.role)) {
        return fail(
          "FORBIDDEN",
          "Importer and Sales Agent roles are bound to a company record and cannot be granted here.",
          requestId,
          { fields: { role: "Cannot be granted" } },
        );
      }

      // ── May this actor grant this role at all? ──────────────────
      const actorRoles = actor.roles.map((r) => r.role);
      if (actorRoles.length === 0) {
        return fail("FORBIDDEN", "Your account holds no role to grant from.", requestId);
      }

      // `in (...)`, not `= any($1::wms.role_key[])`. postgres.js expands
      // a JavaScript array into a parameter list rather than binding one
      // array, so the array cast never sees an array. Each role is still
      // a bound parameter.
      const actorRoleList = sql.join(
        actorRoles.map((r) => sql`${r}::wms.role_key`),
        sql`, `,
      );

      const rule = await getDb().execute<{ scope: string; domain: string }>(sql`
        select rcr.scope::text as scope, r.domain::text as domain
          from wms.role_creation_rule rcr
          join wms.role r on r.key = rcr.target_role
         where rcr.target_role = ${input.role}::wms.role_key
           and rcr.actor_role in (${actorRoleList})
         order by case rcr.scope when 'ANY' then 0 else 1 end
         limit 1
      `);

      if (rule.length === 0) {
        return fail(
          "FORBIDDEN",
          "Your role is not allowed to grant that role.",
          requestId,
          { fields: { role: "Not one you can grant" } },
        );
      }
      const { scope, domain } = rule[0]!;

      if (scope === "SELF_REGISTER") {
        return fail(
          "FORBIDDEN",
          "That role is only ever taken by self-registration, never granted.",
          requestId,
          { fields: { role: "Cannot be granted" } },
        );
      }

      // ── Does the assignment carry the right scope column? ───────
      const needs = DOMAIN_COLUMN[domain] ?? "none";
      if (needs === "warehouse" && !input.warehouseId) {
        return fail("VALIDATION_FAILED", "That role needs a warehouse", requestId, {
          fields: { warehouseId: "Choose a warehouse" },
        });
      }
      if (needs === "importer" && !input.importerId) {
        return fail("VALIDATION_FAILED", "That role needs an importer", requestId, {
          fields: { importerId: "Choose an importer" },
        });
      }
      if (needs === "none" && (input.warehouseId || input.importerId)) {
        return fail(
          "VALIDATION_FAILED",
          "A platform role is not scoped to a warehouse or an importer",
          requestId,
        );
      }

      // ── Is the target inside the actor's own scope? ─────────────
      if (scope === "SAME_WAREHOUSE") {
        const mine = actor.roles.map((r) => r.warehouseId).filter((w): w is number => w != null);
        if (!input.warehouseId || !mine.includes(input.warehouseId)) {
          return fail(
            "FORBIDDEN",
            "You can only grant that role in a warehouse you are assigned to.",
            requestId,
            { fields: { warehouseId: "Not one of yours" } },
          );
        }
      }
      if (scope === "SAME_IMPORTER") {
        const mine = actor.roles.map((r) => r.importerId).filter((i): i is number => i != null);
        if (!input.importerId || !mine.includes(input.importerId)) {
          return fail(
            "FORBIDDEN",
            "You can only grant that role within your own importer.",
            requestId,
            { fields: { importerId: "Not one of yours" } },
          );
        }
      }

      const rows = await getDb().execute<{ id: number }>(sql`
        insert into wms.user_role_assignment
          (user_id, role, role_domain, warehouse_id, importer_id, assigned_by, note)
        values (${targetUserId}, ${input.role}::wms.role_key, ${domain}::wms.role_domain,
                ${needs === "warehouse" ? (input.warehouseId ?? null) : null},
                ${needs === "importer" ? (input.importerId ?? null) : null},
                ${actor.session.userId}, ${input.note ?? null})
        on conflict do nothing
        returning id
      `);

      if (rows.length === 0) {
        return fail("CONFLICT", "They already hold that role here.", requestId);
      }
      // Their cached actor no longer describes what they may do.
      await invalidateUser(targetUserId);

      await auditQuietly({
        action: "user.role_assigned",
        operation: "INSERT",
        entityType: "user_role_assignment",
        entityId: String(rows[0]!.id),
        entityLabel: `${target[0]!.email} → ${input.role}`,
        actorUserId: actor.session.userId,
        actorEmail: actor.session.email,
        actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
        after: {
          userId: targetUserId,
          role: input.role,
          warehouseId: input.warehouseId ?? null,
          importerId: input.importerId ?? null,
        },
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        requestId,
      });

      await tell("user.role_assigned", {
        actor,
        requestId,
        targetUserId,
        targetName: target[0]!.name,
        role: input.role,
        warehouseId: needs === "warehouse" ? (input.warehouseId ?? null) : null,
        importerId: needs === "importer" ? (input.importerId ?? null) : null,
        assignmentId: rows[0]!.id,
      });

      return ok({ ok: true as const }, requestId, 201);
    } catch (error) {
      return translate(error, requestId);
    }
  })();
}

/**
 * DELETE — revoke.
 *
 * Kept as a revoke rather than a delete: `revoked_at` plus a reason is
 * the record of who removed what and why, and the unique index is
 * already partial on `revoked_at is null` so the row can be re-granted
 * afterwards.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { id: rawId } = await context.params;
      const targetUserId = Number(rawId);
      if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        return fail("NOT_FOUND", "No such user", requestId);
      }

      const { actor } = await requirePermission("role.assign", {
        entityType: "user",
        entityId: String(targetUserId),
      });

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      }

      const parsed = revokeRoleRequestSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const { assignmentId, reason } = parsed.data;

      const before = await getDb().execute<{
        id: number;
        role: string;
        is_immutable: boolean;
        warehouse_id: number | null;
        importer_id: number | null;
        name: string;
      }>(sql`
        select ura.id, ura.role::text as role, r.is_immutable,
               ura.warehouse_id, ura.importer_id,
               trim(u.first_name || ' ' || u.last_name) as name
          from wms.user_role_assignment ura
          join wms.role r on r.key = ura.role
          join wms.users u on u.id = ura.user_id
         where ura.id = ${assignmentId} and ura.user_id = ${targetUserId}
           and ura.revoked_at is null
      `);
      if (before.length === 0) {
        return fail("NOT_FOUND", "That role assignment is not active", requestId);
      }

      // The same question the grant path asks: is this account one of
      // yours to touch? A warehouse admin revoking another branch's
      // manager was possible until this line existed.
      const may = await mayManageUser(actor, targetUserId);
      if (may !== true) {
        return fail("FORBIDDEN", may.reason, requestId);
      }

      // Checked here for the message; the `ura_protect_immutable` trigger
      // is what actually enforces it, for everyone, including a super
      // admin going in through psql.
      if (before[0]!.is_immutable) {
        return fail(
          "FORBIDDEN",
          `${before[0]!.role} cannot be revoked — it is bound to the account for its lifetime. ` +
            "Suspend the account instead.",
          requestId,
        );
      }

      await getDb().execute(sql`
        update wms.user_role_assignment
           set revoked_at = now(), revoked_by = ${actor.session.userId},
               revoke_reason = ${reason}
         where id = ${assignmentId} and user_id = ${targetUserId} and revoked_at is null
      `);
      await invalidateUser(targetUserId);

      await auditQuietly({
        action: "user.role_revoked",
        operation: "UPDATE",
        entityType: "user_role_assignment",
        entityId: String(assignmentId),
        entityLabel: before[0]!.role,
        actorUserId: actor.session.userId,
        actorEmail: actor.session.email,
        actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
        reason,
        before: before[0],
        after: { revoked: true },
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        requestId,
      });

      await tell("user.role_revoked", {
        actor,
        requestId,
        targetUserId,
        targetName: before[0]!.name,
        role: before[0]!.role,
        warehouseId: before[0]!.warehouse_id,
        importerId: before[0]!.importer_id,
        assignmentId,
        reason,
      });

      return ok({ ok: true as const }, requestId);
    } catch (error) {
      return translate(error, requestId);
    }
  })();
}

/**
 * Tell the super admins, and never at the cost of the change itself.
 *
 * `announce` resolves its own audience from `notification_rule`, so who
 * hears about a role change is a row rather than a list in this file.
 * Everything it needs that the rule cannot know — the person's name, the
 * site, who did it — is passed in here.
 *
 * The whole thing is wrapped in a catch. A role that was granted and an
 * email that did not send is a smaller problem than a 500 on a request
 * whose database work has already committed.
 */
async function tell(
  eventKey: "user.role_assigned" | "user.role_revoked",
  input: {
    actor: Actor;
    requestId: string;
    targetUserId: number;
    targetName: string;
    role: string;
    warehouseId: number | null;
    importerId: number | null;
    assignmentId: number;
    reason?: string;
  },
): Promise<void> {
  try {
    // One query for the two possible labels; only one of them is ever
    // non-null, and both are null for a platform role.
    const [scope] = await getDb().execute<{ label: string | null }>(sql`
      select coalesce(
               (select w.name from wms.warehouse w where w.id = ${input.warehouseId}),
               (select i.company_name from wms.importer i where i.id = ${input.importerId})
             ) as label
    `);

    const [role] = await getDb().execute<{ name: string }>(sql`
      select name from wms.role where key::text = ${input.role}
    `);

    await announce({
      eventKey,
      values: {
        name: input.targetName,
        role: role?.name ?? input.role,
        whereSuffix: scope?.label ? ` at ${scope.label}` : "",
        actorName: `${input.actor.session.firstName} ${input.actor.session.lastName}`.trim(),
        reason: input.reason ?? "—",
        signInUrl: absoluteUrl("/admin/users") ?? "",
      },
      dedupeSuffix: `assignment-${input.assignmentId}`,
      actorUserId: input.actor.session.userId,
      entityType: "user_role_assignment",
      entityId: String(input.assignmentId),
      warehouseId: input.warehouseId,
      importerId: input.importerId,
      correlationId: input.requestId,
    });
  } catch (error) {
    console.error(`[roles] ${eventKey} not announced`, {
      userId: input.targetUserId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Turn the database's own refusals into something readable.
 *
 * These messages come from the triggers in 06_roles_permissions.sql.
 * Matching on the text is not lovely, but the alternative — duplicating
 * the rule in TypeScript so the UI can pre-empt it — is worse: two
 * copies of a rule drift, and the copy the user sees is the one that
 * stops being true.
 */
function translate(error: unknown, requestId: string) {
  const message = error instanceof Error ? error.message : "";

  if (/exclusive/i.test(message)) {
    return fail(
      "CONFLICT",
      "That role cannot be combined with any other. This account already holds one.",
      requestId,
    );
  }
  if (/immutable/i.test(message)) {
    return fail(
      "FORBIDDEN",
      "That role assignment cannot be changed once made. Suspend the account instead.",
      requestId,
    );
  }
  if (/super.?admin/i.test(message)) {
    return fail("FORBIDDEN", "A super admin's own role can only be changed by them.", requestId);
  }
  if (/role_domain|violates check constraint/i.test(message)) {
    return fail(
      "VALIDATION_FAILED",
      "That role does not take the scope you gave it.",
      requestId,
    );
  }
  return toResponse(error, requestId);
}
