import { sql, type SQL } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { getDb } from "@/db";
import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { auditQuietly } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { deleteOne, dependentCounts, dropPublicCache, identifier } from "@/lib/admin/master-ops";
import { invalidateGeo } from "@/lib/admin/geo";
import { resolveResource } from "@/lib/admin/master-registry";
import { isUniqueViolation } from "@/lib/db-errors";

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

      const columns: SQL[] = [];
      const values: SQL[] = [];

      if (resource.parent) {
        columns.push(identifier(resource.parent.column));
        values.push(sql`${input[resource.parent.key]}`);
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

      await invalidateGeo();
      dropPublicCache(resource);
      return ok({ ok: true as const }, requestId);
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
  return toResponse(error, requestId);
}
