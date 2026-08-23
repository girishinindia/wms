import { sql, type SQL } from "drizzle-orm";

import MasterTable, {
  type MasterRow,
  type MasterSpec,
  type ParentOption,
} from "@/components/admin/MasterTable";
import { Denied, PageHeader } from "@/components/admin/ui";
import { getDb } from "@/db";
import {
  finishList,
  likePattern,
  parseListQuery,
  type RawSearchParams,
} from "@/lib/admin/listing";
import { pluralise, resolveResource } from "@/lib/admin/master-registry";
import { grantFor, pageGuard } from "@/lib/auth/guard";
import { actorWarehouseIds } from "@/lib/users/authority";

/**
 * The server half of a master screen, once.
 *
 * Each of the five pages is then a single line naming its slug. Their
 * differences — which columns, which parent, which filters, what counts
 * as "in use" — are data in `master-registry.ts`, not five copies of
 * this query.
 *
 * Search, filters, sort and page all live in the URL and are applied by
 * the database; the page fetches exactly one page of rows.
 */

function identifier(value: string): SQL {
  if (!/^[a-z_][a-z0-9_, ]*$/.test(value)) {
    throw new Error(`Refusing to use '${value}' as an identifier`);
  }
  return sql.raw(value);
}

const selectClass =
  "rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-1.5 pr-7 text-sm text-verdigris-50 focus:outline-none focus:ring-2 focus:ring-patina/40";

export default async function MasterPage({
  slug,
  searchParams,
}: {
  slug: string;
  searchParams?: RawSearchParams;
}) {
  const resource = resolveResource(slug);
  if (!resource) throw new Error(`Unknown master resource '${slug}'`);

  const guard = await pageGuard(`${resource.permission}.read`);
  if (!guard.ok) return <Denied what={resource.label.toLowerCase()} />;

  /**
   * Which columns may be sorted on: the parent label, every displayed
   * field by its key, and status. The key → column mapping is the
   * registry's, so an unknown key from the URL falls back to the
   * default rather than reaching the query.
   */
  const sortable = [
    ...(resource.parent ? ["parent"] : []),
    ...(resource.scope ? ["scope"] : []),
    ...(resource.approval ? ["approval"] : []),
    // A `hideInTable` field has no header to click, and sorting a list
    // by the text of a paragraph is not something anybody wants.
    ...resource.fields.filter((f) => !f.hideInTable).map((f) => f.key),
    "status",
  ];
  const selectFilters = resource.fields.filter((f) => f.type === "select" && f.filterable);

  /**
   * Which rows this viewer is allowed to see at all.
   *
   * A resource with no `scope` is unchanged: everyone who holds the read
   * permission sees every row. With one, a grant at ALL still sees
   * everything, and anything narrower is cut down to the sites the
   * caller is actually assigned to — the same set `mayActOnUser` uses on
   * the users screen, and the same set the write route re-checks.
   */
  const readGrant = grantFor(guard.actor, `${resource.permission}.read`);
  const wideRead = !resource.scope || readGrant?.scope === "ALL";
  const mySites = actorWarehouseIds(guard.actor);

  const query = parseListQuery(searchParams ?? {}, {
    sortable,
    defaultSort:
      resource.fields.find((f) => f.key === "name")?.key ??
      resource.fields.find((f) => !f.hideInTable)?.key ??
      resource.fields[0]!.key,
    extraKeys: [
      ...(resource.parent ? ["parent"] : []),
      ...(resource.scope ? ["scope"] : []),
      ...(resource.approval ? ["approval"] : []),
      "inuse",
      ...selectFilters.map((f) => f.key),
    ],
  });

  const orderColumn = (() => {
    if (query.sort === "status") return sql`m.is_active`;
    if (query.sort === "parent" && resource.parent) {
      return sql`p.${identifier(resource.parent.labelColumn)}`;
    }
    if (query.sort === "scope" && resource.scope) {
      return sql`s.${identifier(resource.scope.labelColumn)}`;
    }
    if (query.sort === "approval" && resource.approval) {
      return sql`m.${identifier(resource.approval.column)}`;
    }
    const field = resource.fields.find((f) => f.key === query.sort) ?? resource.fields[0]!;
    return sql`m.${identifier(field.column)}`;
  })();
  const direction = query.dir === "desc" ? sql`desc` : sql`asc`;

  /** One scalar subquery per dependent; summed for the total, and kept
   *  apart for the "3 cities, 1 warehouse" detail. */
  const dependentCounts = resource.dependents.map(
    (d) => sql`(select count(*) from wms.${identifier(d.table)} dep
                 where dep.${identifier(d.column)} = m.id
                   and dep.deleted_at is null)::int`,
  );
  const inUseTotal = dependentCounts.length ? sql.join(dependentCounts, sql` + `) : sql`0`;

  /** Text search across every field, plus the parent's label. Numbers
   *  are cast so "40" finds a 40-foot container. */
  const searchable = [
    // A money column is searched in RUPEES, because that is what the
    // person typing into the box is reading off the screen. Searching
    // `amount_paise::text` would make "4200" find ₹42.00 and miss the
    // ₹4,200.00 row the user is looking at.
    ...resource.fields.map((f) =>
      f.type === "money"
        ? sql`(m.${identifier(f.column)} / 100.0)::text`
        : sql`m.${identifier(f.column)}::text`,
    ),
    ...(resource.parent ? [sql`p.${identifier(resource.parent.labelColumn)}::text`] : []),
    ...(resource.scope ? [sql`s.${identifier(resource.scope.labelColumn)}::text`] : []),
  ];

  const parentFilter = Number.parseInt(query.extra.parent ?? "", 10);
  const conditions: SQL[] = [sql`m.deleted_at is null`];
  if (query.status === "active") conditions.push(sql`m.is_active`);
  if (query.status === "inactive") conditions.push(sql`not m.is_active`);
  if (resource.parent && Number.isFinite(parentFilter)) {
    conditions.push(sql`m.${identifier(resource.parent.column)} = ${parentFilter}`);
  }
  /**
   * The line that keeps one branch out of another's books.
   *
   * Note the `in (null)` fallback rather than skipping the clause: a
   * scoped reader with no assignments must see NOTHING, and a missing
   * clause would have shown them everything.
   */
  if (resource.scope && !wideRead) {
    const sites =
      mySites.length > 0
        ? sql.join(
            mySites.map((id) => sql`${id}`),
            sql`, `,
          )
        : sql`null`;
    conditions.push(sql`m.${identifier(resource.scope.column)} in (${sites})`);
  }
  const scopeFilter = Number.parseInt(query.extra.scope ?? "", 10);
  if (resource.scope && Number.isFinite(scopeFilter)) {
    conditions.push(sql`m.${identifier(resource.scope.column)} = ${scopeFilter}`);
  }
  if (resource.approval && query.extra.approval) {
    const wanted = query.extra.approval.toUpperCase();
    if (["PENDING", "APPROVED", "REJECTED"].includes(wanted)) {
      conditions.push(sql`m.${identifier(resource.approval.column)} = ${wanted}`);
    }
  }
  if (query.extra.inuse === "used") conditions.push(sql`(${inUseTotal}) > 0`);
  if (query.extra.inuse === "unused") conditions.push(sql`(${inUseTotal}) = 0`);
  for (const f of selectFilters) {
    const v = query.extra[f.key];
    // Only a value the CHECK constraint allows ever reaches the query.
    if (v && f.options?.includes(v)) conditions.push(sql`m.${identifier(f.column)} = ${v}`);
  }
  if (query.q) {
    conditions.push(
      sql`(${sql.join(
        searchable.map((col) => sql`${col} ilike ${likePattern(query.q)}`),
        sql` or `,
      )})`,
    );
  }
  const where = sql.join(conditions, sql` and `);

  const fromClause = sql`
      from wms.${identifier(resource.table)} m
      ${
        resource.parent
          ? sql`left join wms.${identifier(resource.parent.table)} p
                  on p.id = m.${identifier(resource.parent.column)}`
          : sql``
      }
      ${
        resource.scope
          ? sql`left join wms.${identifier(resource.scope.table)} s
                  on s.id = m.${identifier(resource.scope.column)}`
          : sql``
      }
     where ${where}`;

  const selected = resource.fields.map((f) =>
    /**
     * A date column comes back as `YYYY-MM-DD` text and never as a
     * Date. `date` has no time and no zone; letting the driver make a
     * Date out of it and `toISOString()` turn it back is how the 1st
     * becomes the 31st for anybody west of Greenwich.
     */
    f.type === "date"
      ? sql`to_char(m.${identifier(f.column)}, 'YYYY-MM-DD') as ${identifier(f.column)}`
      : sql`m.${identifier(f.column)} as ${identifier(f.column)}`,
  );
  const perDependent = dependentCounts.map((c, i) => sql`${c} as dep_${sql.raw(String(i))}`);

  // Sequential, never Promise.all — see src/db/index.ts on pipelining.
  const [{ total }] = await getDb().execute<{ total: number }>(
    sql`select count(*)::int as total ${fromClause}`,
  );
  const list = finishList(query, total, sortable);
  const offset = (list.page - 1) * list.size;

  const rows = await getDb().execute<Record<string, unknown>>(sql`
    select m.id, m.is_active, m.created_at, m.updated_at,
           ${sql.join(selected, sql`, `)},
           (${inUseTotal}) as in_use
           ${perDependent.length ? sql`, ${sql.join(perDependent, sql`, `)}` : sql``}
           ${
             resource.parent
               ? sql`, m.${identifier(resource.parent.column)} as parent_id,
                      p.${identifier(resource.parent.labelColumn)} as parent_label`
               : sql``
           }
           ${
             resource.scope
               ? sql`, m.${identifier(resource.scope.column)} as scope_id,
                      ${
                        resource.scope.codeColumn
                          ? sql`(s.${identifier(resource.scope.codeColumn)} || ' · ' || s.${identifier(resource.scope.labelColumn)})`
                          : sql`s.${identifier(resource.scope.labelColumn)}`
                      } as scope_label`
               : sql``
           }
           ${
             resource.approval
               ? sql`, m.${identifier(resource.approval.column)} as approval_status,
                      m.approval_note as approval_note,
                      (select trim(a.first_name || ' ' || a.last_name)
                         from wms.users a where a.id = m.approved_by) as approved_by_name,
                      to_char(m.approved_at, 'DD Mon YYYY') as approved_at`
               : sql``
           }
           ${
             resource.attachments
               ? sql`, (select count(*)::int from wms.expense_receipt r
                         where r.expense_id = m.id) as attachment_count`
               : sql``
           }
      ${fromClause}
     order by ${orderColumn} ${direction} nulls last, m.id
     limit ${list.size} offset ${offset}
  `);

  const parentOptions: ParentOption[] = resource.parent
    ? (
        await getDb().execute<{ id: number; label: string; group_id: number | null; group_label: string | null }>(sql`
          select o.id, o.${identifier(resource.parent.labelColumn)}::text as label
                 ${
                   resource.parent.groupBy
                     ? sql`, g.id as group_id, g.${identifier(resource.parent.groupBy.labelColumn)}::text as group_label`
                     : sql`, null::bigint as group_id, null::text as group_label`
                 }
            from wms.${identifier(resource.parent.table)} o
            ${
              resource.parent.groupBy
                ? sql`left join wms.${identifier(resource.parent.groupBy.table)} g
                        on g.id = o.${identifier(resource.parent.groupBy.column)}`
                : sql``
            }
           where o.is_active and o.deleted_at is null
           order by ${resource.parent.groupBy ? sql`g.${identifier(resource.parent.groupBy.labelColumn)}, ` : sql``}
                    o.${identifier(resource.parent.labelColumn)}
        `)
      ).map((r) => ({
        id: r.id,
        label: r.label,
        groupId: r.group_id === null ? undefined : Number(r.group_id),
        groupLabel: r.group_label ?? undefined,
      }))
    : [];

  /**
   * The scope picker, narrowed the same way the list is.
   *
   * Offering a site the caller cannot write to would be a dropdown that
   * produces a 403 — the route checks this again against their own
   * assignments, so this is about not lying to them, not about safety.
   */
  const scopeOptions: ParentOption[] = resource.scope
    ? (
        await getDb().execute<{ id: number; label: string }>(sql`
          select o.id,
                 ${
                   resource.scope.codeColumn
                     ? sql`(o.${identifier(resource.scope.codeColumn)} || ' · ' || o.${identifier(resource.scope.labelColumn)})`
                     : sql`o.${identifier(resource.scope.labelColumn)}`
                 }::text as label
            from wms.${identifier(resource.scope.table)} o
           where o.is_active and o.deleted_at is null
             and (${wideRead} or o.id in (${
               mySites.length > 0
                 ? sql.join(
                     mySites.map((id) => sql`${id}`),
                     sql`, `,
                   )
                 : sql`null`
             }))
           order by 2
           limit 300
        `)
      ).map((r) => ({ id: Number(r.id), label: r.label }))
    : [];

  const data: MasterRow[] = rows.map((r) => ({
    id: Number(r.id),
    isActive: Boolean(r.is_active),
    inUse: Number(r.in_use ?? 0),
    inUseDetail: resource.dependents
      .map((d, i) => `${Number(r[`dep_${i}`] ?? 0)} ${d.noun}`)
      .filter((s) => !s.startsWith("0 "))
      .join(", "),
    parentId: r.parent_id === undefined ? null : Number(r.parent_id),
    parentLabel: (r.parent_label as string | null) ?? null,
    scopeId: r.scope_id === undefined ? null : Number(r.scope_id),
    scopeLabel: (r.scope_label as string | null) ?? null,
    approvalStatus: (r.approval_status as string | null) ?? null,
    approvalNote: (r.approval_note as string | null) ?? null,
    approvedBy: (r.approved_by_name as string | null) ?? null,
    approvedAt: (r.approved_at as string | null) ?? null,
    attachmentCount: Number(r.attachment_count ?? 0),
    createdAt: r.created_at ? String(r.created_at) : null,
    updatedAt: r.updated_at ? String(r.updated_at) : null,
    values: Object.fromEntries(
      resource.fields.map((f) => {
        const raw = r[f.column];
        // numeric arrives as a string from the driver; the table renders
        // it, so trailing ".00" would show up in the cell.
        const value =
          raw === null || raw === undefined
            ? null
            : f.type === "number" || f.type === "money"
              ? Number(raw)
              : String(raw).trim();
        return [f.key, value];
      }),
    ),
  }));

  const spec: MasterSpec = {
    slug: resource.slug,
    label: resource.label,
    singular: resource.singular,
    fields: resource.fields,
    parent: resource.parent
      ? {
          key: resource.parent.key,
          label: resource.parent.label,
          options: parentOptions,
          groupLabel: resource.parent.groupBy?.label,
        }
      : null,
    listNoun: resource.listNoun,
    scope: resource.scope
      ? { key: resource.scope.key, label: resource.scope.label, options: scopeOptions }
      : null,
    approval: resource.approval
      ? {
          // Whether THIS viewer may decide. The button is hidden
          // otherwise; the route refuses either way.
          canDecide: grantFor(guard.actor, resource.approval.permission) !== null,
        }
      : null,
    attachments: resource.attachments ?? null,
    softDeleteOnly: resource.softDeleteOnly === true,
    dependentNoun: resource.dependents[0]?.noun ?? "records",
    canCreate: grantFor(guard.actor, `${resource.permission}.create`) !== null,
    canUpdate: grantFor(guard.actor, `${resource.permission}.update`) !== null,
    canDelete: grantFor(guard.actor, `${resource.permission}.delete`) !== null,
    bulkCreate: resource.bulkCreate ?? null,
  };

  // The extra filters, rendered inside the toolbar's GET form so they
  // submit together with search and status. Plain <select>s that submit
  // on change; the "All …" option clears the filter.
  const filters = (
    <>
      {resource.parent ? (
        <select
          name="parent"
          defaultValue={query.extra.parent ?? ""}
          aria-label={resource.parent.label}
          className={selectClass}
        >
          <option value="" className="bg-ink-850">
            All {pluralise(resource.parent.label.toLowerCase())}
          </option>
          {resource.parent.groupBy
            ? [...new Map(parentOptions.map((o) => [o.groupId, o.groupLabel])).entries()].map(
                ([gid, glabel]) => (
                  <optgroup key={String(gid)} label={glabel ?? "—"} className="bg-ink-850">
                    {parentOptions
                      .filter((o) => o.groupId === gid)
                      .map((o) => (
                        <option key={o.id} value={o.id} className="bg-ink-850">
                          {o.label}
                        </option>
                      ))}
                  </optgroup>
                ),
              )
            : parentOptions.map((o) => (
                <option key={o.id} value={o.id} className="bg-ink-850">
                  {o.label}
                </option>
              ))}
        </select>
      ) : null}
      {resource.scope && scopeOptions.length > 1 ? (
        <select
          name="scope"
          defaultValue={query.extra.scope ?? ""}
          aria-label={resource.scope.label}
          className={selectClass}
        >
          <option value="" className="bg-ink-850">
            All {pluralise(resource.scope.label.toLowerCase())}
          </option>
          {scopeOptions.map((o) => (
            <option key={o.id} value={o.id} className="bg-ink-850">
              {o.label}
            </option>
          ))}
        </select>
      ) : null}
      {resource.approval ? (
        <select
          name="approval"
          defaultValue={query.extra.approval ?? ""}
          aria-label="Approval"
          className={selectClass}
        >
          <option value="" className="bg-ink-850">Any approval</option>
          <option value="PENDING" className="bg-ink-850">Awaiting approval</option>
          <option value="APPROVED" className="bg-ink-850">Approved</option>
          <option value="REJECTED" className="bg-ink-850">Rejected</option>
        </select>
      ) : null}
      {selectFilters.map((f) => (
        <select
          key={f.key}
          name={f.key}
          defaultValue={query.extra[f.key] ?? ""}
          aria-label={f.label}
          className={selectClass}
        >
          <option value="" className="bg-ink-850">
            All {f.label.toLowerCase()}
          </option>
          {(f.options ?? []).map((o) => (
            <option key={o} value={o} className="bg-ink-850">
              {o.toLowerCase().replace(/_/g, " ")}
            </option>
          ))}
        </select>
      ))}
      {resource.dependents.length ? (
        <select
          name="inuse"
          defaultValue={query.extra.inuse ?? ""}
          aria-label="In use"
          className={selectClass}
        >
          <option value="" className="bg-ink-850">Used or not</option>
          <option value="used" className="bg-ink-850">In use</option>
          <option value="unused" className="bg-ink-850">Not in use</option>
        </select>
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader title={resource.label} subtitle={resource.intro} />
      <MasterTable
        spec={spec}
        rows={data}
        list={list}
        base={`/admin/master/${resource.slug}`}
        filters={filters}
      />
    </>
  );
}
