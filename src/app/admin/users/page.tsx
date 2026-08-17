import Link from "next/link";

import { Card, Cell, Denied, Empty, PageHeader, Row, StatusBadge, Table } from "@/components/admin/ui";
import { getDb } from "@/db";
import { pageGuard } from "@/lib/auth/guard";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Everyone with an account.
 *
 * Roles are aggregated in the query rather than fetched per row. With a
 * database in ap-south-1 and functions in the same region it would still
 * be one round trip per user — the classic N+1 that looks fine with the
 * three rows a new system has and falls over at two hundred.
 */
export default async function UsersPage() {
  const guard = await pageGuard("user.read");
  if (!guard.ok) return <Denied what="users" />;

  const rows = await getDb().execute<{
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    mobile: string;
    status: string;
    email_verified: boolean;
    mobile_verified: boolean;
    roles: string[] | null;
    last_login_at: string | null;
  }>(sql`
    select u.id, u.email::text as email, u.first_name, u.last_name,
           u.mobile::text as mobile, u.status::text as status,
           u.email_verified_at is not null as email_verified,
           u.mobile_verified_at is not null as mobile_verified,
           u.last_login_at,
           array_remove(array_agg(distinct ura.role::text), null) as roles
      from wms.users u
      left join wms.user_role_assignment ura
        on ura.user_id = u.id and ura.revoked_at is null
     where u.deleted_at is null
     group by u.id
     order by u.created_at desc
     limit 300
  `);

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Roles come from live assignments — an account with none can sign in and see nothing."
      />

      <Card>
        {rows.length === 0 ? (
          <Empty title="No users yet." />
        ) : (
          <Table head={["Name", "Contact", "Roles", "Status", "Last seen"]}>
            {rows.map((row) => (
              <Row key={row.id}>
                <Cell className="font-medium">
                  <Link href={`/admin/users/${row.id}`} className="hover:text-patina">
                    {row.first_name} {row.last_name}
                  </Link>
                </Cell>
                <Cell className="text-verdigris-200/60">
                  <span className="block text-xs">
                    {row.email}{" "}
                    {row.email_verified ? null : (
                      <span className="text-amber-300">unverified</span>
                    )}
                  </span>
                  <span className="block text-xs text-verdigris-200/40">
                    {row.mobile}{" "}
                    {row.mobile_verified ? null : (
                      <span className="text-amber-300">unverified</span>
                    )}
                  </span>
                </Cell>
                <Cell>
                  {row.roles && row.roles.length > 0 ? (
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-verdigris-300">
                      {row.roles.join(" · ")}
                    </span>
                  ) : (
                    <span className="text-xs text-amber-300">none</span>
                  )}
                </Cell>
                <Cell>
                  <StatusBadge value={row.status} />
                </Cell>
                <Cell className="whitespace-nowrap text-xs text-verdigris-200/50">
                  {row.last_login_at
                    ? new Date(row.last_login_at).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                      })
                    : "never"}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
