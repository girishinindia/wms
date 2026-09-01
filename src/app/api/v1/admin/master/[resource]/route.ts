import { sql, type SQL } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { getDb } from "@/db";
import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { auditQuietly } from "@/lib/audit";
import { grantFor, requirePermission, type Actor } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { deleteOne, dependentCounts, dropPublicCache, identifier } from "@/lib/admin/master-ops";
import { invalidateGeo } from "@/lib/admin/geo";
import {
  activeColumnFor,
  resolveResource,
  type MasterField,
  type MasterResource,
} from "@/lib/admin/master-registry";
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

/** `m.is_active`, or the status-enum equivalent, per the registry. */
function activeExpr(resource: MasterResource): SQL {
  return resource.statusColumn
    ? sql`(m.${identifier(resource.statusColumn.column)} = ${resource.statusColumn.activeValue})`
    : sql`m.is_active`;
}

/**
 * `orderBy` from the registry, with every column qualified onto `m`.
 *
 * The registry writes "sort_order, name"; unqualified, "name" turns
 * ambiguous the moment the parent join adds a second name column, and
 * the cities list 500s. Each term is validated against the identifier
 * shape before it is interpolated — a literal from the registry, never
 * from a request.
 */
function qualifiedOrder(resource: MasterResource): SQL {
  const terms = resource.orderBy.split(",").map((raw) => {
    const [column, direction] = raw.trim().split(/\s+/);
    const dir = (direction ?? "").toLowerCase() === "desc" ? sql` desc` : sql``;
    return sql`m.${identifier(column ?? "id")}${dir}`;
  });
  return sql.join(terms, sql`, `);
}

/**
 * GET /api/v1/admin/master/[resource] — the rows, for a native client.
 *
 * The web renders these tables inside `MasterPage`; a phone cannot, so
 * this answers a leaner cut of the same query, driven by the same
 * registry: every field (dates as `YYYY-MM-DD` text — see the page on
 * why the driver must never make a Date of a date), the parent, scope,
 * link and pivot LABELS beside their ids, the approval columns where
 * the resource has them, and the active parent options a form needs to
 * offer. Scoped resources are narrowed to the caller's own sites with
 * the page's own EXISTS shape — never by anything in the request.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ resource: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { resource: slug } = await context.params;
      const resource = resolveResource(slug);
      if (!resource) return fail("NOT_FOUND", "No such master table", requestId);

      const { actor, grant } = await requirePermission(`${resource.permission}.read`, {
        entityType: resource.table,
      });

      const conditions: SQL[] = [sql`m.deleted_at is null`];

      if (resource.scope && grant.scope === "WAREHOUSE") {
        const mine = actorWarehouseIds(actor);
        if (mine.length === 0) {
          return ok({ rows: [], parentOptions: [] }, requestId);
        }
        const sites = sql.join(mine.map((w) => sql`${w}`), sql`, `);
        if (resource.scope.via) {
          conditions.push(sql`exists (
            select 1 from wms.${identifier(resource.scope.via.table)} j
             where j.${identifier(resource.scope.via.linkColumn)}
                     = m.${identifier(resource.scope.via.localColumn)}
               and j.${identifier(resource.scope.via.scopeColumn)} in (${sites})
               and j.deleted_at is null
          )`);
        } else if (resource.scope.column) {
          conditions.push(sql`m.${identifier(resource.scope.column)} in (${sites})`);
        }
      } else if (resource.scope && grant.scope === "OWN") {
        conditions.push(sql`m.created_by = ${actor.session.userId}`);
      }

      const raw = (request.nextUrl.searchParams.get("status") ?? "").toLowerCase();
      if (raw === "active") conditions.push(activeExpr(resource));
      if (raw === "inactive") conditions.push(sql`not ${activeExpr(resource)}`);

      /**
       * Free-text search, over the columns this resource already
       * declares as text — the registry IS the list, so a table gains
       * search the moment it gains a field and no column name is
       * written down twice. The parent's label joins in as well: a city
       * is looked for by its state at least as often as by its name.
       *
       * It happens here rather than on the client because the listing
       * is capped at 300 rows below. A filter applied after that cap
       * would search the first 300 and quietly report "nothing" for
       * everything past it — cities alone is already 226 and climbing.
       */
      const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
      if (q !== "") {
        // A bound parameter stops injection; it does not stop LIKE from
        // reading the term's OWN % and _ as wildcards. Someone looking
        // for "50%" would match every row, and "_" every row too. These
        // are a person's literal words, so their wildcards are escaped
        // (backslash is Postgres's default LIKE escape character).
        const like = `%${q.replace(/([\\%_])/g, "\\$1")}%`;
        const targets: SQL[] = resource.fields
          .filter((f) => f.type === "text")
          .map((f) => sql`m.${identifier(f.column)}::text ilike ${like}`);
        if (resource.parent) {
          targets.push(
            sql`p.${identifier(resource.parent.labelColumn)}::text ilike ${like}`,
          );
        }
        if (targets.length > 0) {
          conditions.push(sql`(${sql.join(targets, sql` or `)})`);
        }
      }

      const selected = resource.fields.map((f) =>
        f.type === "date"
          ? sql`to_char(m.${identifier(f.column)}, 'YYYY-MM-DD') as ${identifier(f.column)}`
          : sql`m.${identifier(f.column)} as ${identifier(f.column)}`,
      );

      const links = resource.links ?? [];
      const rows = await getDb().execute<Record<string, unknown>>(sql`
        select m.id, ${activeExpr(resource)} as is_active,
               ${sql.join(selected, sql`, `)}
               ${
                 resource.parent
                   ? sql`, m.${identifier(resource.parent.column)} as parent_id,
                          p.${identifier(resource.parent.labelColumn)}::text as parent_label`
                   : sql``
               }
               ${
                 resource.scope?.column
                   ? sql`, m.${identifier(resource.scope.column)} as scope_id,
                          ${
                            resource.scope.codeColumn
                              ? sql`(s.${identifier(resource.scope.codeColumn)} || ' · ' || s.${identifier(resource.scope.labelColumn)})`
                              : sql`s.${identifier(resource.scope.labelColumn)}::text`
                          } as scope_label`
                   : sql``
               }
               ${
                 links.length
                   ? sql`, ${sql.join(
                       links.map((l) => {
                         const a = sql.raw(
                           `l_${l.key.replace(/[^a-z0-9]/gi, "").toLowerCase()}`,
                         );
                         return sql`m.${identifier(l.column)} as ${identifier(`${l.column}_id`)},
                                    ${a}.${identifier(l.labelColumn)}::text
                                      as ${identifier(`${l.column}_label`)}`;
                       }),
                       sql`, `,
                     )}`
                   : sql``
               }
               ${
                 resource.pivot
                   ? sql`, (select string_agg(
                             ${
                               resource.pivot.optionCodeColumn
                                 ? sql`o.${identifier(resource.pivot.optionCodeColumn)}`
                                 : sql`o.${identifier(resource.pivot.optionLabelColumn)}`
                             }, ', ' order by 1)
                        from wms.${identifier(resource.pivot.table)} j
                        join wms.${identifier(resource.pivot.optionTable)} o
                          on o.id = j.${identifier(resource.pivot.optionColumn)}
                       where j.${identifier(resource.pivot.localColumn)} = m.id
                         and j.deleted_at is null) as pivot_label`
                   : sql``
               }
               ${
                 resource.approval
                   ? sql`, m.${identifier(resource.approval.column)} as approval_status,
                          m.approval_note as approval_note`
                   : sql``
               }
          from wms.${identifier(resource.table)} m
          ${
            resource.parent
              ? sql`left join wms.${identifier(resource.parent.table)} p
                      on p.id = m.${identifier(resource.parent.column)}`
              : sql``
          }
          ${
            resource.scope?.column
              ? sql`left join wms.${identifier(resource.scope.table)} s
                      on s.id = m.${identifier(resource.scope.column)}`
              : sql``
          }
          ${
            links.length
              ? sql.join(
                  links.map((l) => {
                    const a = sql.raw(
                      `l_${l.key.replace(/[^a-z0-9]/gi, "").toLowerCase()}`,
                    );
                    return sql`left join wms.${identifier(l.table)} ${a}
                                 on ${a}.id = m.${identifier(l.column)}`;
                  }),
                  sql` `,
                )
              : sql``
          }
         where ${sql.join(conditions, sql` and `)}
         order by ${activeExpr(resource)} desc, ${qualifiedOrder(resource)}, m.id
         limit 300
      `);

      const parentOptions = resource.parent
        ? (
            await getDb().execute<{
              id: number;
              label: string;
              group_id: number | null;
              group_label: string | null;
            }>(sql`
              select o.id, o.${identifier(resource.parent.labelColumn)}::text as label
                     ${
                       resource.parent.groupBy
                         ? sql`, g.id as group_id,
                                g.${identifier(resource.parent.groupBy.labelColumn)}::text as group_label`
                         : sql`, null::bigint as group_id, null::text as group_label`
                     }
                from wms.${identifier(resource.parent.table)} o
                ${
                  resource.parent.groupBy
                    ? sql`left join wms.${identifier(resource.parent.groupBy.table)} g
                            on g.id = o.${identifier(resource.parent.groupBy.column)}`
                    : sql``
                }
               where ${(() => {
                 const a = activeColumnFor(resource.parent!.table);
                 return a
                   ? sql`o.${identifier(a.column)} = ${a.activeValue}`
                   : sql`o.is_active`;
               })()} and o.deleted_at is null
               order by o.${identifier(resource.parent.labelColumn)}
            `)
          ).map((r) => ({
            id: Number(r.id),
            label: r.label,
            groupId: r.group_id === null ? null : Number(r.group_id),
            groupLabel: r.group_label,
          }))
        : [];

      return ok(
        {
          rows: rows.map((r) => {
            const out: Record<string, unknown> = {
              id: Number(r.id),
              isActive: Boolean(r.is_active),
            };
            for (const f of resource.fields) out[f.key] = r[f.column] ?? null;
            if (resource.parent) {
              out.parentId = r.parent_id === null ? null : Number(r.parent_id);
              out.parentLabel = r.parent_label ?? null;
            }
            if (resource.scope?.column) {
              out.scopeId = r.scope_id === null ? null : Number(r.scope_id);
              out.scopeLabel = r.scope_label ?? null;
            }
            for (const l of links) {
              out[l.key] =
                r[`${l.column}_id`] === null ? null : Number(r[`${l.column}_id`]);
              out[`${l.key}Label`] = r[`${l.column}_label`] ?? null;
            }
            if (resource.pivot) out.pivotLabel = r.pivot_label ?? null;
            if (resource.approval) {
              out.approvalStatus = r.approval_status ?? null;
              out.approvalNote = r.approval_note ?? null;
            }
            return out;
          }),
          parentOptions,
        },
        requestId,
      );
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}

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
      if (resource.parent && input[resource.parent.key] !== undefined) {
        const parentId = input[resource.parent.key];
        const parentActive = activeColumnFor(resource.parent.table);
        const parentRow = await getDb().execute<{ id: number; is_active: boolean }>(sql`
          select id,
                 ${
                   parentActive
                     ? sql`(${identifier(parentActive.column)} = ${parentActive.activeValue})`
                     : sql`is_active`
                 } as is_active
            from wms.${identifier(resource.parent.table)}
           where id = ${parentId} and deleted_at is null
        `);
        if (parentRow.length === 0 || !parentRow[0]!.is_active) {
          return fail("VALIDATION_FAILED", `Choose an active ${resource.parent.label.toLowerCase()}`, requestId, {
            fields: { [resource.parent.key]: "Not available" },
          });
        }
      }

      /**
       * The site has to be one of the caller's before a row exists for it.
       *
       * Three shapes, because three tables link to a warehouse three
       * different ways:
       *
       *   direct   the row carries `warehouse_id` — an expense
       *   pivot    the row is linked to a SET of sites — a transporter
       *   via      the row inherits its sites from its parent — a
       *            vehicle, through the transporter that owns it
       */
      if (resource.scope?.column) {
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

      const pivotWanted = resource.pivot
        ? ((input[resource.pivot.key] as number[] | undefined) ?? [])
        : [];

      if (resource.pivot && !wideScope(resource, actor)) {
        const mine = actorWarehouseIds(actor);
        // Without at least one of their own sites, a scoped caller would
        // save a row that vanishes from their own list on the next load.
        if (pivotWanted.length === 0) {
          return fail("VALIDATION_FAILED", `Choose at least one ${resource.scope?.label.toLowerCase() ?? "site"}`, requestId, {
            fields: { [resource.pivot.key]: "Pick at least one" },
          });
        }
        if (pivotWanted.some((id) => !mine.includes(id))) {
          return fail("FORBIDDEN", "You can only link this to a warehouse you are assigned to", requestId, {
            fields: { [resource.pivot.key]: "Not one of yours" },
          });
        }
      }

      // A vehicle's sites are its transporter's. Checked against the
      // parent rather than the body, because the body never names one.
      if (resource.scope?.via && !resource.pivot && resource.parent) {
        const parentId = Number(input[resource.parent.key]);
        const mine = actorWarehouseIds(actor);
        if (!wideScope(resource, actor)) {
          const rows = await getDb().execute<{ site: number }>(sql`
            select j.${identifier(resource.scope.via.scopeColumn)} as site
              from wms.${identifier(resource.scope.via.table)} j
             where j.${identifier(resource.scope.via.linkColumn)} = ${parentId}
               and j.deleted_at is null
          `);
          if (!rows.some((r) => mine.includes(Number(r.site)))) {
            return fail(
              "FORBIDDEN",
              `That ${resource.parent.label.toLowerCase()} does not serve a warehouse you are assigned to`,
              requestId,
              { fields: { [resource.parent.key]: "Not one of yours" } },
            );
          }
        }
      }

      const columns: SQL[] = [];
      const values: SQL[] = [];

      if (resource.parent && input[resource.parent.key] !== undefined) {
        columns.push(identifier(resource.parent.column));
        values.push(sql`${input[resource.parent.key]}`);
      }
      if (resource.scope?.column) {
        columns.push(identifier(resource.scope.column));
        values.push(sql`${input[resource.scope.key]}`);
      }
      for (const l of resource.links ?? []) {
        if (input[l.key] === undefined) continue;
        columns.push(identifier(l.column));
        values.push(sql`${input[l.key]}`);
      }
      if (resource.statusColumn && input.isActive !== undefined) {
        // The Active switch, onto the column that already holds the
        // answer. `is_active` is not a column on these tables.
        columns.push(identifier(resource.statusColumn.column));
        values.push(
          sql`${input.isActive === false ? resource.statusColumn.inactiveValue : resource.statusColumn.activeValue}`,
        );
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
        /**
         * A conditional field whose condition is off is written NULL,
         * not skipped.
         *
         * `blankOptional` turns "" into `undefined`, so a cleared box
         * arrives as "leave it alone" — which is how a carrier ends up
         * not blacklisted with a reason still on the record. The screen
         * hides the box; this is what empties the column, and it holds
         * for a direct API call too.
         */
        if (switchedOff(resource, field, input)) {
          columns.push(identifier(field.column));
          values.push(sql`null`);
          continue;
        }
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

      if (resource.pivot && rows[0]?.id) {
        await writePivot(resource, actor, Number(rows[0].id), pivotWanted);
      }

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
        // Where the row is NOW, whichever way it is linked.
        const here = await outsideRowScope(resource, actor, id);
        if (here) return fail("FORBIDDEN", here, requestId);

        // And where it is being moved to, when the scope is a column on
        // the row. Checking only the incoming site would let one branch
        // pull another's record across into its own books.
        if (resource.scope.column && input[resource.scope.key] !== undefined) {
          const there = outsideScope(resource, actor, input[resource.scope.key]);
          if (there) {
            return fail("FORBIDDEN", there, requestId, {
              fields: { [resource.scope.key]: "Not one of yours" },
            });
          }
        }
      }

      const pivotWanted =
        resource.pivot && input[resource.pivot.key] !== undefined
          ? ((input[resource.pivot.key] as number[] | undefined) ?? [])
          : null;

      /**
       * On an edit, only what is being ADDED is checked.
       *
       * The drawer submits the whole set, and a scoped caller's set
       * necessarily includes links to branches they cannot see — those
       * ids came back on the row and are simply carried through. The
       * first cut refused them, which meant a site-2 manager could never
       * unhook a shared carrier from site 2: their own submission was
       * rejected for containing sites 1 and 5.
       *
       * `writePivot` is what keeps the other branches safe: it deletes
       * only links to sites the caller holds, so a carry-through id is
       * untouched either way.
       */
      if (resource.pivot && pivotWanted !== null && !wideScope(resource, actor)) {
        const mine = actorWarehouseIds(actor);
        const existing = await sitesOfRow(resource, id);
        const added = pivotWanted.filter((wid) => !existing.includes(wid));
        if (added.some((wid) => !mine.includes(wid))) {
          return fail("FORBIDDEN", "You can only link this to a warehouse you are assigned to", requestId, {
            fields: { [resource.pivot.key]: "Not one of yours" },
          });
        }
        // No "at least one" here, unlike create: unhooking a carrier
        // from your own branch is a real thing to want, and the row
        // leaving your list afterwards is the point of doing it.
      }

      /**
       * Switching a row off is the one change with consequences beyond
       * the row, so it is the one that gets counted first. Everything
       * pointing at it keeps working; what breaks is every picker that
       * filters on `is_active`, and nobody connects the two later.
       */
      const wasActive = resource.statusColumn
        ? before[0]![resource.statusColumn.column] === resource.statusColumn.activeValue
        : before[0]!.is_active === true;
      if (input.isActive === false && wasActive) {
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
        // Same rule as create: the condition being off empties the
        // column, whether or not the request mentioned the field.
        if (switchedOff(resource, field, input)) {
          sets.push(sql`${identifier(field.column)} = null`);
          continue;
        }
        if (!(field.key in input)) continue;
        const value = input[field.key];
        sets.push(sql`${identifier(field.column)} = ${value ?? null}`);
      }
      // Moving a row to another parent (a city to another state). Same
      // active-parent rule as create.
      if (resource.parent && input[resource.parent.key] !== undefined) {
        const parentActive = activeColumnFor(resource.parent.table);
        const parentRow = await getDb().execute<{ id: number; is_active: boolean }>(sql`
          select id,
                 ${
                   parentActive
                     ? sql`(${identifier(parentActive.column)} = ${parentActive.activeValue})`
                     : sql`is_active`
                 } as is_active
            from wms.${identifier(resource.parent.table)}
           where id = ${input[resource.parent.key]} and deleted_at is null
        `);
        if (parentRow.length === 0 || !parentRow[0]!.is_active) {
          return fail("VALIDATION_FAILED", `Choose an active ${resource.parent.label.toLowerCase()}`, requestId, {
            fields: { [resource.parent.key]: "Not available" },
          });
        }
        sets.push(sql`${identifier(resource.parent.column)} = ${input[resource.parent.key]}`);
      }
      if (resource.scope?.column && input[resource.scope.key] !== undefined) {
        sets.push(sql`${identifier(resource.scope.column)} = ${input[resource.scope.key]}`);
      }
      for (const l of resource.links ?? []) {
        if (input[l.key] === undefined) continue;
        sets.push(sql`${identifier(l.column)} = ${input[l.key]}`);
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
        sets.push(
          resource.statusColumn
            ? sql`${identifier(resource.statusColumn.column)} = ${
                input.isActive === false
                  ? resource.statusColumn.inactiveValue
                  : resource.statusColumn.activeValue
              }`
            : sql`${identifier("is_active")} = ${input.isActive}`,
        );
      }
      /**
       * Changing only the links IS a change.
       *
       * `sets` counts column updates, and a caller who ticked a site and
       * touched nothing else produces none — so unhooking a carrier from
       * a branch came back "Nothing to change" while the links sat
       * exactly where they were.
       */
      if (sets.length === 0 && pivotWanted === null) {
        return fail("VALIDATION_FAILED", "Nothing to change", requestId);
      }
      sets.push(sql`${identifier("updated_by")} = ${actor.session.userId}`);

      if (sets.length > 0) {
        const rows = await getDb().execute<{ id: number }>(sql`
          update wms.${identifier(resource.table)}
             set ${sql.join(sets, sql`, `)}
           where id = ${id} and deleted_at is null
          returning id
        `);
        if (rows.length === 0) return fail("NOT_FOUND", `No such ${resource.singular}`, requestId);
      }

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
      if (input.isActive !== undefined) touched.isActive = wasActive;
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

      if (resource.pivot && pivotWanted !== null) {
        await writePivot(resource, actor, id, pivotWanted);
      }

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
        const refusal = await outsideRowScope(resource, actor, id);
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
/**
 * Is this field's `showWhen` condition currently unmet?
 *
 * The registry gates "Why blacklisted" on the blacklisted tick. The
 * SCREEN hides the box, but a screen is not a control: an API call can
 * send a reason with `blacklisted: false`, and the table's CHECK only
 * ever guarded the other direction ("blacklisted implies a reason"), so
 * nothing refused it. One carrier in production carries exactly that.
 *
 * Read from the REQUEST, not from the stored row, and deliberately: on
 * an update that turns the tick off, the row still says `true` while
 * the request says `false`, and the request is the new truth. A field
 * the request does not mention leaves the condition unmet only if the
 * controlling field is itself absent and falsy — which for a boolean
 * the drawer always sends is not a case that arises.
 */
function switchedOff(
  resource: MasterResource,
  field: MasterField,
  input: Record<string, unknown>,
): boolean {
  if (!field.showWhen) return false;
  // Only when the request actually decides the controlling field.
  // Otherwise a PATCH of one unrelated column would blank the reason.
  if (!(field.showWhen.field in input)) return false;
  return Boolean(input[field.showWhen.field]) !== field.showWhen.equals;
}

function outsideScope(
  resource: MasterResource,
  actor: Actor,
  warehouseId: unknown,
): string | null {
  if (!resource.scope) return null;
  if (wideScope(resource, actor)) return null;

  const id = Number(warehouseId);
  if (!Number.isInteger(id)) return `Choose a ${resource.scope.label.toLowerCase()}`;
  return actorWarehouseIds(actor).includes(id)
    ? null
    : `You can only do this for a ${resource.scope.label.toLowerCase()} you are assigned to`;
}

/** Does this caller hold the resource platform-wide? */
function wideScope(resource: MasterResource, actor: Actor): boolean {
  return (
    grantFor(actor, `${resource.permission}.create`)?.scope === "ALL" ||
    grantFor(actor, `${resource.permission}.update`)?.scope === "ALL"
  );
}

/**
 * Which sites a row currently belongs to.
 *
 * Direct is the column on the row. `via` is the join table: a carrier's
 * own links, or — one hop further — the links of the transporter a
 * vehicle belongs to. Returns an empty array for a row attached to
 * nothing, which is a real state and is deliberately NOT treated as
 * "belongs to everyone".
 */
async function sitesOfRow(resource: MasterResource, rowId: number): Promise<number[]> {
  const scope = resource.scope;
  if (!scope) return [];
  if (scope.via) {
    const rows = await getDb().execute<{ site: number }>(sql`
      select j.${identifier(scope.via.scopeColumn)} as site
        from wms.${identifier(resource.table)} m
        join wms.${identifier(scope.via.table)} j
          on j.${identifier(scope.via.linkColumn)} = m.${identifier(scope.via.localColumn)}
       where m.id = ${rowId} and m.deleted_at is null and j.deleted_at is null
    `);
    return rows.map((r) => Number(r.site));
  }
  if (!scope.column) return [];
  const rows = await getDb().execute<{ site: number | null }>(sql`
    select ${identifier(scope.column)} as site from wms.${identifier(resource.table)}
     where id = ${rowId} and deleted_at is null
  `);
  const site = rows[0]?.site;
  return site === null || site === undefined ? [] : [Number(site)];
}

/**
 * May this caller act on an existing row?
 *
 * The question the grant cannot answer: a WAREHOUSE-scoped grant with no
 * warehouse named on the request is let through by `requirePermission`,
 * and here the warehouse is a property of the ROW.
 */
async function outsideRowScope(
  resource: MasterResource,
  actor: Actor,
  rowId: number,
): Promise<string | null> {
  if (!resource.scope) return null;
  if (wideScope(resource, actor)) return null;
  const mine = actorWarehouseIds(actor);
  const sites = await sitesOfRow(resource, rowId);
  return sites.some((id) => mine.includes(id))
    ? null
    : `That ${resource.singular} is not linked to a ${resource.scope.label.toLowerCase()} you are assigned to`;
}

/**
 * Replace the many-to-many for one row.
 *
 * Written as delete-then-insert inside one statement pair rather than a
 * diff: the set is small, the table is a plain link with no history of
 * its own, and a diff would need three round trips to say the same
 * thing. A scoped caller may only ever remove links to THEIR sites —
 * otherwise saving a carrier from one branch would silently unhook it
 * from another's.
 */
async function writePivot(
  resource: MasterResource,
  actor: Actor,
  rowId: number,
  wanted: number[],
): Promise<void> {
  const pivot = resource.pivot;
  if (!pivot) return;
  const wide = wideScope(resource, actor);
  const mine = actorWarehouseIds(actor);
  const allowed = wide ? wanted : wanted.filter((id) => mine.includes(id));

  const removable = wide
    ? sql`true`
    : mine.length > 0
      ? sql`j.${identifier(pivot.optionColumn)} in (${sql.join(
          mine.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql`false`;

  await getDb().execute(sql`
    delete from wms.${identifier(pivot.table)} j
     where j.${identifier(pivot.localColumn)} = ${rowId}
       and ${removable}
       ${
         allowed.length > 0
           ? sql`and j.${identifier(pivot.optionColumn)} not in (${sql.join(
               allowed.map((id) => sql`${id}`),
               sql`, `,
             )})`
           : sql``
       }
  `);

  if (allowed.length === 0) return;
  await getDb().execute(sql`
    insert into wms.${identifier(pivot.table)}
      (${identifier(pivot.localColumn)}, ${identifier(pivot.optionColumn)})
    select ${rowId}, v.id
      from (values ${sql.join(
        allowed.map((id) => sql`(${id}::bigint)`),
        sql`, `,
      )}) as v(id)
     where not exists (
       select 1 from wms.${identifier(pivot.table)} x
        where x.${identifier(pivot.localColumn)} = ${rowId}
          and x.${identifier(pivot.optionColumn)} = v.id
     )
  `);
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
    /**
     * One constraint gets a sentence rather than its own name, because
     * its name explains nothing to the person who tripped it: the tick
     * and the reason are one fact, and the table now refuses either
     * without the other.
     */
    if (named === "transporter_blacklist_reason_check") {
      return fail(
        "VALIDATION_FAILED",
        "A blacklisted carrier needs a reason, and a reason belongs only to a blacklisted carrier.",
        requestId,
        // Both halves in one line: the constraint is symmetric, so a
        // caller reaching it directly could have tripped either.
        { fields: { blacklistReason: "Goes with the tick above — required when it is on, empty when it is off" } },
      );
    }
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
