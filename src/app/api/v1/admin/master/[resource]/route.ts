import { sql, type SQL } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { getDb } from "@/db";
import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { auditQuietly } from "@/lib/audit";
import { grantFor, requirePermission, type Actor } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { deleteOne, dependentCounts, dropPublicCache, identifier } from "@/lib/admin/master-ops";
import { invalidateGeo } from "@/lib/admin/geo";
import { resolveResource, type MasterResource } from "@/lib/admin/master-registry";
import { announceSubmitted } from "@/lib/expenses/ops";
import { actorWarehouseIds } from "@/lib/users/authority";
import { constraintNameOf, isCheckViolation, isUniqueViolation } from "@/lib/db-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One handler for four master tables.
 *
 * The alternative was four route files that differ by a table name and a
 * schema, which is four places to fix a bug in and three of them get
 * missed. The shape lives in `master-registry.ts` and this reads it.
 *
 * The safety property that makes it acceptable: `resolveResource` looks
 * the URL segment up in a frozen record and returns null for anything
 * else, so by the time an identifier is interpolated it is a literal
 * from that file. Column names come from the same place. A request never
 * reaches an identifier position — only a bound parameter.
 *
 * DELETE removes a row outright, and only when nothing points at it —
 * see `HARD_DELETE_WHEN_UNUSED` in the registry for why it is not a soft
 * delete. The bulk variant lives in ./bulk/route.ts and shares
 * `deleteOne` / `setActive` below.
 */

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ resource: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { resource: slug } = await context.params;
      const resource = resolveResource(slug);
      if (!resource) return fail("NOT_FOUND", "No such master table", requestId);

      const { actor } = await requirePermission(`${resource.permission}.create`, {
        entityType: resource.table,
      });

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      }

      const parsed = resource.createSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const input = parsed.data as Record<string, unknown>;

      // A row under a parent that is switched off would be invisible the
      // moment it was created. Checked here so it reads as a field error.
      if (resource.parent) {
        const parentId = input[resource.parent.key];
        const parentRow = await getDb().execute<{ id: number; is_active: boolean }>(sql`
          select id, is_active from wms.${identifier(resource.parent.table)}
           where id = ${parentId} and deleted_at is null
        `);
        if (parentRow.length === 0 || !parentRow[0]!.is_active) {
          return fail("VALIDATION_FAILED", `Choose an active ${resource.parent.label.toLowerCase()}`, requestId, {
            fields: { [resource.parent.key]: "Not available" },
          });
        }
      }

      // The site has to be one of the caller's before a row exists for it.
      if (resource.scope) {
        const refusal = outsideScope(resource, actor, input[resource.scope.key]);
        if (refusal) {
          return fail("FORBIDDEN", refusal, requestId, {
            fields: { [resource.scope.key]: "Not one of yours" },
          });
        }
        const site = await getDb().execute<{ is_active: boolean }>(sql`
          select is_active from wms.${identifier(resource.scope.table)}
           where id = ${input[resource.scope.key]} and deleted_at is null
        `);
        if (site.length === 0 || !site[0]!.is_active) {
          return fail("VALIDATION_FAILED", `Choose an active ${resource.scope.label.toLowerCase()}`, requestId, {
            fields: { [resource.scope.key]: "Not available" },
          });
        }
      }

      const columns: SQL[] = [];
      const values: SQL[] = [];

      if (resource.parent) {
        columns.push(identifier(resource.parent.column));
        values.push(sql`${input[resource.parent.key]}`);
      }
      if (resource.scope) {
        columns.push(identifier(resource.scope.column));
        values.push(sql`${input[resource.scope.key]}`);
      }

      /**
       * Approved on arrival, or waiting.
       *
       * The rule in one line: an author who already holds the approve
       * permission does not have to ask themselves. That is the whole of
       * "a super admin's entry needs no approval" — and because the
       * approve endpoint asks for the same permission, the two can never
       * disagree about who is exempt.
       */
      const autoApprove =
        resource.approval !== undefined &&
        grantFor(actor, resource.approval.autoApprovePermission) !== null;
      if (resource.approval) {
        columns.push(identifier(resource.approval.column));
        values.push(sql`${autoApprove ? "APPROVED" : "PENDING"}`);
        if (autoApprove) {
          columns.push(identifier("approved_by"));
          values.push(sql`${actor.session.userId}`);
          columns.push(identifier("approved_at"));
          values.push(sql`now()`);
        }
      }
      for (const field of resource.fields) {
        const value = input[field.key];
        if (value === undefined) continue;
        columns.push(identifier(field.column));
        values.push(sql`${value}`);
      }
      columns.push(identifier("created_by"));
      values.push(sql`${actor.session.userId}`);

      const rows = await getDb().execute<{ id: number }>(sql`
        insert into wms.${identifier(resource.table)} (${sql.join(columns, sql`, `)})
        values (${sql.join(values, sql`, `)})
        returning id
      `);

      await auditQuietly({
        action: `${resource.permission}.created`,
        operation: "INSERT",
        entityType: resource.permission,
        entityId: String(rows[0]?.id ?? 0),
        entityLabel: String(input.name ?? input.code ?? ""),
        actorUserId: actor.session.userId,
        actorEmail: actor.session.email,
        actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
        after: input,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        requestId,
      });

      // Somebody has to be told it is waiting. Nobody has to be told
      // about an entry that was approved as it was typed.
      if (resource.approval && !autoApprove && rows[0]?.id) {
        await announceSubmitted(Number(rows[0].id), actor, {
          requestId,
          ip: clientIp(request.headers),
          userAgent: request.headers.get("user-agent"),
        });
      }

      await invalidateGeo();
      dropPublicCache(resource);
      return ok({ id: rows[0]?.id ?? 0 }, requestId, 201);
    } catch (error) {
      return translate(error, requestId, await context.params.then((p) => p.resource));
    }
  })();
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ resource: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { resource: slug } = await context.params;
      const resource = resolveResource(slug);
      if (!resource) return fail("NOT_FOUND", "No such master table", requestId);

      const { actor } = await requirePermission(`${resource.permission}.update`, {
        entityType: resource.table,
      });

      const id = Number(request.nextUrl.searchParams.get("id"));
      if (!Number.isInteger(id) || id <= 0) {
        return fail("VALIDATION_FAILED", "Which row?", requestId);
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      }

      const parsed = resource.updateSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const input = parsed.data as Record<string, unknown>;

      const before = await getDb().execute<Record<string, unknown>>(sql`
        select * from wms.${identifier(resource.table)}
         where id = ${id} and deleted_at is null
      `);
      if (before.length === 0) return fail("NOT_FOUND", `No such ${resource.singular}`, requestId);

      /**
       * Where the row is NOW, before anything about where it is going.
       *
       * Checking only the incoming warehouse would let one branch pull
       * another's expense across into its own books, which is a worse
       * version of editing it in place.
       */
      if (resource.scope) {
        const here = outsideScope(resource, actor, before[0]![resource.scope.column]);
        if (here) return fail("FORBIDDEN", here, requestId);
        if (input[resource.scope.key] !== undefined) {
          const there = outsideScope(resource, actor, input[resource.scope.key]);
          if (there) {
            return fail("FORBIDDEN", there, requestId, {
              fields: { [resource.scope.key]: "Not one of yours" },
            });
          }
        }
      }

      /**
       * Switching a row off is the one change with consequences beyond
       * the row, so it is the one that gets counted first. Everything
       * pointing at it keeps working; what breaks is every picker that
       * filters on `is_active`, and nobody connects the two later.
       */
      if (input.isActive === false && before[0]!.is_active === true) {
        const counts = await getDb().execute<Record<string, number>>(sql`
          select ${sql.join(
            dependentCounts(resource, sql`${id}`).map((c, i) => sql`${c}::int as c${sql.raw(String(i))}`),
            sql`, `,
          )}
        `);
        const total = Object.values(counts[0] ?? {}).reduce((a, b) => a + Number(b), 0);
        if (total > 0 && request.nextUrl.searchParams.get("force") !== "true") {
          const detail = resource.dependents
            .map((d, i) => `${counts[0]?.[`c${i}`] ?? 0} ${d.noun}`)
            .filter((s) => !s.startsWith("0 "))
            .join(", ");
          return fail(
            "CONFLICT",
            `${detail} still use this ${resource.singular}. Deactivating it hides it from every picker; the existing records keep working.`,
            requestId,
          );
        }
      }

      const sets: SQL[] = [];
      for (const field of resource.fields) {
        if (!(field.key in input)) continue;
        const value = input[field.key];
        sets.push(sql`${identifier(field.column)} = ${value ?? null}`);
      }
      // Moving a row to another parent (a city to another state). Same
      // active-parent rule as create.
      if (resource.parent && input[resource.parent.key] !== undefined) {
        const parentRow = await getDb().execute<{ id: number; is_active: boolean }>(sql`
          select id, is_active from wms.${identifier(resource.parent.table)}
           where id = ${input[resource.parent.key]} and deleted_at is null
        `);
        if (parentRow.length === 0 || !parentRow[0]!.is_active) {
          return fail("VALIDATION_FAILED", `Choose an active ${resource.parent.label.toLowerCase()}`, requestId, {
            fields: { [resource.parent.key]: "Not available" },
          });
        }
        sets.push(sql`${identifier(resource.parent.column)} = ${input[resource.parent.key]}`);
      }
      if (resource.scope && input[resource.scope.key] !== undefined) {
        sets.push(sql`${identifier(resource.scope.column)} = ${input[resource.scope.key]}`);
      }

      /**
       * Editing an approved row sends it back for a decision.
       *
       * Otherwise approval means nothing: record ₹500, get it approved,
       * then edit it to ₹50,000 and the row still says APPROVED with
       * somebody else's name against it. A caller who can approve is
       * exempt — they would only be re-approving their own edit.
       */
      const resubmit =
        resource.approval !== undefined &&
        grantFor(actor, resource.approval.permission) === null &&
        before[0]![resource.approval.column] !== "PENDING" &&
        resource.fields.some((f) => f.key in input);
      if (resubmit && resource.approval) {
        sets.push(sql`${identifier(resource.approval.column)} = 'PENDING'`);
        sets.push(sql`${identifier("approved_by")} = null`);
        sets.push(sql`${identifier("approved_at")} = null`);
        sets.push(sql`${identifier("approval_note")} = null`);
      }

      if (input.isActive !== undefined) {
        sets.push(sql`${identifier("is_active")} = ${input.isActive}`);
      }
      if (sets.length === 0) return fail("VALIDATION_FAILED", "Nothing to change", requestId);
      sets.push(sql`${identifier("updated_by")} = ${actor.session.userId}`);

      const rows = await getDb().execute<{ id: number }>(sql`
        update wms.${identifier(resource.table)}
           set ${sql.join(sets, sql`, `)}
         where id = ${id} and deleted_at is null
        returning id
      `);
      if (rows.length === 0) return fail("NOT_FOUND", `No such ${resource.singular}`, requestId);

      /**
       * Both sides of the diff in the same key space.
       *
       * `wms.jsonb_diff` compares keys, and the row comes back in
       * snake_case while the request arrives in camelCase — so handing
       * it the raw row against the parsed body reported every column in
       * the table as changed, including `created_at` and `deleted_by`.
       * A diff that says everything changed says nothing.
       *
       * Narrowed to the fields this request actually touched, named the
       * way the request named them.
       */
      const touched: Record<string, unknown> = {};
      for (const field of resource.fields) {
        if (!(field.key in input)) continue;
        const raw = before[0]![field.column];
        touched[field.key] =
          raw === null || raw === undefined
            ? null
            : field.type === "number"
              ? Number(raw)
              : String(raw).trim();
      }
      if (input.isActive !== undefined) touched.isActive = before[0]!.is_active;
      if (resource.parent && input[resource.parent.key] !== undefined) {
        touched[resource.parent.key] = before[0]![resource.parent.column] ?? null;
      }

      await auditQuietly({
        action: `${resource.permission}.updated`,
        operation: "UPDATE",
        entityType: resource.permission,
        entityId: String(id),
        entityLabel: String(before[0]!.name ?? before[0]!.code ?? ""),
        actorUserId: actor.session.userId,
        actorEmail: actor.session.email,
        actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
        before: touched,
        after: input,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        requestId,
      });

      if (resubmit) {
        await announceSubmitted(id, actor, {
          requestId,
          ip: clientIp(request.headers),
          userAgent: request.headers.get("user-agent"),
        });
      }

      await invalidateGeo();
      dropPublicCache(resource);
      return ok({ ok: true as const, resubmitted: resubmit }, requestId);
    } catch (error) {
      return translate(error, requestId, await context.params.then((p) => p.resource));
    }
  })();
}


export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ resource: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { resource: slug } = await context.params;
      const resource = resolveResource(slug);
      if (!resource) return fail("NOT_FOUND", "No such master table", requestId);

      const { actor } = await requirePermission(`${resource.permission}.delete`, {
        entityType: resource.table,
      });

      const id = Number(request.nextUrl.searchParams.get("id"));
      if (!Number.isInteger(id) || id <= 0) {
        return fail("VALIDATION_FAILED", "Which row?", requestId);
      }

      if (resource.scope) {
        const row = await getDb().execute<Record<string, unknown>>(sql`
          select ${identifier(resource.scope.column)} as site
            from wms.${identifier(resource.table)}
           where id = ${id} and deleted_at is null
        `);
        if (row.length === 0) return fail("NOT_FOUND", `No such ${resource.singular}`, requestId);
        const refusal = outsideScope(resource, actor, row[0]!.site);
        if (refusal) return fail("FORBIDDEN", refusal, requestId);
      }

      const outcome = await deleteOne(resource, id, actor, {
        requestId,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
      });
      if (!outcome.ok && outcome.reason === "not_found") {
        return fail("NOT_FOUND", `No such ${resource.singular}`, requestId);
      }
      if (!outcome.ok) {
        return fail(
          "CONFLICT",
          `${outcome.detail} still use this ${resource.singular}. Switch it off instead, or move those records first.`,
          requestId,
        );
      }
      await invalidateGeo();
      dropPublicCache(resource);
      return ok({ ok: true as const }, requestId);
    } catch (error) {
      return translate(error, requestId, await context.params.then((p) => p.resource));
    }
  })();
}

/**
 * Is this site one the caller may write to?
 *
 * `requirePermission` cannot answer it: a WAREHOUSE-scoped grant with no
 * warehouse named on the request is let through, which is correct for a
 * list and for a create, and here the warehouse arrives in the BODY (on
 * create) or sits on the existing ROW (on update and delete). Both are
 * measured against the caller's own live assignments.
 */
function outsideScope(
  resource: MasterResource,
  actor: Actor,
  warehouseId: unknown,
): string | null {
  if (!resource.scope) return null;
  const grant = grantFor(actor, `${resource.permission}.create`);
  const readGrant = grantFor(actor, `${resource.permission}.update`);
  if (grant?.scope === "ALL" || readGrant?.scope === "ALL") return null;

  const id = Number(warehouseId);
  if (!Number.isInteger(id)) return `Choose a ${resource.scope.label.toLowerCase()}`;
  return actorWarehouseIds(actor).includes(id)
    ? null
    : `You can only do this for a ${resource.scope.label.toLowerCase()} you are assigned to`;
}

/**
 * A unique violation is the only database error a user of these screens
 * can actually do something about, so it is the only one given its own
 * message — and the message says what the index means rather than
 * quoting its name.
 */
function translate(error: unknown, requestId: string, slug: string) {
  if (isUniqueViolation(error)) {
    const resource = resolveResource(slug);
    return fail("CONFLICT", resource?.conflict ?? "That value is already taken", requestId);
  }
  /**
   * A CHECK refused the row.
   *
   * Every one of these SHOULD have been caught by the Zod schema in
   * front of it — the constraints and the schemas say the same things
   * twice on purpose, one for the person and one for anything that
   * reaches the table another way. When one gets through, the honest
   * answer is 422 with the constraint named, not a 500 that tells the
   * user to try again at something that will never work.
   */
  if (isCheckViolation(error)) {
    const named = constraintNameOf(error);
    return fail(
      "VALIDATION_FAILED",
      named
        ? `That value is not allowed here (${named.replace(/_/g, " ")}).`
        : "One of those values is not allowed here.",
      requestId,
    );
  }
  return toResponse(error, requestId);
}
