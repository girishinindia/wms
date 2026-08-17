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
import { resolveResource } from "@/lib/admin/master-registry";
import { grantFor, pageGuard } from "@/lib/auth/guard";

/**
 * The server half of a master screen, once.
 *
 * Each of the four pages is then a single line naming its slug. Their
 * differences — which columns, which parent, what counts as "in use" —
 * are data in `master-registry.ts`, not four copies of this query.
 *
 * The in-use count is a correlated subquery rather than a second round
 * trip per row. With the database in ap-south-1 that difference is the
 * gap between one query and thirteen.
 */

function identifier(value: string): SQL {
  if (!/^[a-z_][a-z0-9_, ]*$/.test(value)) {
    throw new Error(`Refusing to use '${value}' as an identifier`);
  }
  return sql.raw(value);
}

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
   * Which columns may be sorted on: every displayed field by its key,
   * the parent label, and status. The key → column mapping is the
   * registry's, so an unknown key from the URL falls back to the
   * default rather than reaching the query.
   */
  const sortable = [
    ...(resource.parent ? ["parent"] : []),
    ...resource.fields.map((f) => f.key),
    "status",
  ];
  const query = parseListQuery(searchParams ?? {}, {
    sortable,
    defaultSort: resource.fields[0]!.key,
  });

  const orderColumn = (() => {
    if (query.sort === "status") return sql`m.is_active`;
    if (query.sort === "parent" && resource.parent) {
      return sql`p.${identifier(resource.parent.labelColumn)}`;
    }
    const field = resource.fields.find((f) => f.key === query.sort) ?? resource.fields[0]!;
    return sql`m.${identifier(field.column)}`;
  })();
  const direction = query.dir === "desc" ? sql`desc` : sql`asc`;

  /** Text search across every text-ish field, plus the parent's label.
   *  Numbers are cast so "40" finds a 40-foot container. */
  const searchable = [
    ...resource.fields.map((f) => sql`m.${identifier(f.column)}::text`),
    ...(resource.parent ? [sql`p.${identifier(resource.parent.labelColumn)}::text`] : []),
  ];
  const where = sql.join(
    [
      sql`m.deleted_at is null`,
      ...(query.status === "active" ? [sql`m.is_active`] : []),
      ...(query.status === "inactive" ? [sql`not m.is_active`] : []),
      ...(query.q
        ? [
            sql`(${sql.join(
              searchable.map((col) => sql`${col} ilike ${likePattern(query.q)}`),
              sql` or `,
            )})`,
          ]
        : []),
    ],
    sql` and `,
  );

  const selected = resource.fields.map(
    (f) => sql`m.${identifier(f.column)} as ${identifier(f.column)}`,
  );

  const inUse = resource.dependents.length
    ? sql.join(
        resource.dependents.map(
          (d) => sql`(select count(*) from wms.${identifier(d.table)} dep
                       where dep.${identifier(d.column)} = m.id
                         and dep.deleted_at is null)`,
        ),
        sql` + `,
      )
    : sql`0`;

  const fromClause = sql`
      from wms.${identifier(resource.table)} m
      ${
        resource.parent
          ? sql`left join wms.${identifier(resource.parent.table)} p
                  on p.id = m.${identifier(resource.parent.column)}`
          : sql``
      }
     where ${where}`;

  /**
   * The total is a separate query rather than `count(*) over ()`: the
   * window form re-evaluates the in-use subqueries for every candidate
   * row on the way to the count, and on a filtered list that is most of
   * the table. Two cheap queries beat one expensive one here.
   */
  const [{ total }] = await getDb().execute<{ total: number }>(
    sql`select count(*)::int as total ${fromClause}`,
  );
  const list = finishList(query, total, sortable);
  const offset = (list.page - 1) * list.size;

  const rows = await getDb().execute<Record<string, unknown>>(sql`
    select m.id, m.is_active, ${sql.join(selected, sql`, `)},
           (${inUse})::int as in_use
           ${
             resource.parent
               ? sql`, p.${identifier(resource.parent.labelColumn)} as parent_label`
               : sql``
           }
      ${fromClause}
     order by ${orderColumn} ${direction} nulls last, m.id
     limit ${list.size} offset ${offset}
  `);

  const parentOptions: ParentOption[] = resource.parent
    ? (
        await getDb().execute<{ id: number; label: string }>(sql`
          select id, ${identifier(resource.parent.labelColumn)}::text as label
            from wms.${identifier(resource.parent.table)}
           where is_active and deleted_at is null
           order by ${identifier(resource.parent.labelColumn)}
        `)
      ).map((r) => ({ id: r.id, label: r.label }))
    : [];

  const data: MasterRow[] = rows.map((r) => ({
    id: Number(r.id),
    isActive: Boolean(r.is_active),
    inUse: Number(r.in_use ?? 0),
    parentLabel: (r.parent_label as string | null) ?? null,
    values: Object.fromEntries(
      resource.fields.map((f) => {
        const raw = r[f.column];
        // numeric arrives as a string from the driver; the table renders
        // it, so trailing ".00" would show up in the cell.
        const value =
          raw === null || raw === undefined
            ? null
            : f.type === "number"
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
      ? { key: resource.parent.key, label: resource.parent.label, options: parentOptions }
      : null,
    dependentNoun: resource.dependents[0]?.noun ?? "records",
    canCreate: grantFor(guard.actor, `${resource.permission}.create`) !== null,
    canUpdate: grantFor(guard.actor, `${resource.permission}.update`) !== null,
  };

  return (
    <>
      <PageHeader title={resource.label} subtitle={resource.intro} />
      <MasterTable spec={spec} rows={data} list={list} base={`/admin/master/${resource.slug}`} />
    </>
  );
}
