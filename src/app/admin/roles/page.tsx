import Link from "next/link";

import { Card, Cell, Denied, Empty, PageHeader, Row, Table } from "@/components/admin/ui";
import { pageGuard } from "@/lib/auth/guard";
import { rolesFor } from "@/lib/roles/authority";

export const dynamic = "force-dynamic";

/**
 * What each role means.
 *
 * Locked roles are listed rather than hidden. "Why can I not see
 * Warehouse Admin here" is a worse question than "why is it greyed
 * out", and the answer to the second one is on the row.
 */
export default async function RolesPage() {
  const guard = await pageGuard("role.read");
  if (!guard.ok) return <Denied what="roles" />;

  const roles = await rolesFor(guard.actor);

  return (
    <>
      <PageHeader
        title="Roles"
        subtitle="What each role is allowed to do. Changing one changes it for everybody who holds it — for a single person, use the exceptions on their own page instead."
      />

      <Card>
        {roles.length === 0 ? (
          <Empty title="No roles." hint="Something is wrong with the seed." />
        ) : (
          // Twenty-one rows: the header scrolls out of sight long
          // before the list does, and "which column was that number?"
          // is the question this screen exists to answer.
          <Table sticky head={["Role", "Where", "Level", "Permissions", "People", ""]}>
            {roles.map((r) => (
              <Row key={r.key} className={r.lockedReason ? "opacity-60" : ""}>
                <Cell>
                  <span className="font-medium text-verdigris-50">{r.name}</span>
                  <span className="block font-mono text-[0.72rem] uppercase tracking-[0.1em] text-verdigris-300">
                    {r.key}
                  </span>
                </Cell>
                <Cell className="text-verdigris-200/60">{r.domain.toLowerCase()}</Cell>
                <Cell className="tabular-nums text-verdigris-200/60">{r.level}</Cell>
                <Cell className="tabular-nums text-verdigris-200/60">{r.grants}</Cell>
                <Cell className="tabular-nums text-verdigris-200/60">{r.holders}</Cell>
                <Cell className="text-right">
                  {r.lockedReason ? (
                    <span
                      className="text-[0.78rem] text-verdigris-200/45"
                      title={r.lockedReason}
                    >
                      locked
                    </span>
                  ) : (
                    <Link
                      href={`/admin/roles/${r.key}`}
                      className="rounded-lg border border-verdigris-300/15 px-3 py-1.5 text-xs text-verdigris-200/80 transition-colors hover:border-verdigris-300/40 hover:text-verdigris-50"
                    >
                      Permissions
                    </Link>
                  )}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
