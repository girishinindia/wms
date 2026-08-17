import { sql, type SQL } from "drizzle-orm";

import MasterTable, {
  type MasterRow,
  type MasterSpec,
  type ParentOption,
} from "@/components/admin/MasterTable";
import { Denied, PageHeader } from "@/components/admin/ui";
import { getDb } from "@/db";
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

export default async function MasterPage({ slug }: { slug: string }) {
  const resource = resolveResource(slug);
  if (!resource) throw new Error(`Unknown master resource '${slug}'`);

  const guard = await pageGuard(`${resource.permission}.read`);
  if (!guard.ok) return <Denied what={resource.label.toLowerCase()} />;

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

  const rows = await getDb().execute<Record<string, unknown>>(sql`
    select m.id, m.is_active, ${sql.join(selected, sql`, `)},
           (${inUse})::int as in_use
           ${
             resource.parent
               ? sql`, p.${identifier(resource.parent.labelColumn)} as parent_label`
               : sql``
           }
      from wms.${identifier(resource.table)} m
      ${
        resource.parent
          ? sql`left join wms.${identifier(resource.parent.table)} p
                  on p.id = m.${identifier(resource.parent.column)}`
          : sql``
      }
     where m.deleted_at is null
     order by m.is_active desc, ${identifier(resource.orderBy)}
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
      <MasterTable spec={spec} rows={data} />
    </>
  );
}
