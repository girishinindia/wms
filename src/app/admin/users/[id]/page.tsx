import Link from "next/link";
import { notFound } from "next/navigation";

import UserRoles, {
  type Assignment,
  type GrantableRole,
  type ScopeOption,
} from "@/components/admin/UserRoles";
import UserNameEditor from "@/components/admin/UserNameEditor";
import UserStatus from "@/components/admin/UserStatus";
import { Card, Denied, Facts, PageHeader, StatusBadge } from "@/components/admin/ui";
import { getDb } from "@/db";
import { grantFor, pageGuard } from "@/lib/auth/guard";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * One account: who they are, what they hold, and whether they are live.
 *
 * The grantable-role list is computed here from `role_creation_rule`
 * against the VIEWER's roles, not the target's. "Who may grant what" is
 * a property of the person clicking, and computing it on the server is
 * what stops the dropdown offering something the API will refuse.
 */
export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const guard = await pageGuard("user.read");
  if (!guard.ok) return <Denied what="users" />;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const viewerRoles = guard.actor.roles.map((r) => r.role);
  const canAssign = grantFor(guard.actor, "role.assign") !== null;
  const canUpdate = grantFor(guard.actor, "user.update") !== null;

  const [users, roleRows, grantableRows, warehouseRows, importerRows] = await Promise.all([
    getDb().execute<{
      id: number;
      email: string;
      first_name: string;
      last_name: string;
      mobile: string;
      status: string;
      email_verified: boolean;
      mobile_verified: boolean;
      must_change_password: boolean;
      created_at: string;
      last_login_at: string | null;
      deactivation_reason: string | null;
      created_by_email: string | null;
      is_super: boolean;
    }>(sql`
      select u.id, u.email::text as email, u.first_name, u.last_name,
             u.mobile::text as mobile, u.status::text as status,
             u.email_verified_at is not null as email_verified,
             u.mobile_verified_at is not null as mobile_verified,
             u.must_change_password, u.created_at, u.last_login_at,
             u.deactivation_reason,
             p.email::text as created_by_email,
             wms.is_super_admin(u.id) as is_super
        from wms.users u
        left join wms.users p on p.id = u.created_by
       where u.id = ${id} and u.deleted_at is null
    `),
    getDb().execute<{
      id: number;
      role: string;
      role_domain: string;
      is_immutable: boolean;
      warehouse_name: string | null;
      importer_name: string | null;
      assigned_at: string;
    }>(sql`
      select ura.id, ura.role::text as role, ura.role_domain::text as role_domain,
             r.is_immutable, w.name as warehouse_name, i.company_name as importer_name,
             ura.assigned_at
        from wms.user_role_assignment ura
        join wms.role r on r.key = ura.role
        left join wms.warehouse w on w.id = ura.warehouse_id
        left join wms.importer  i on i.id = ura.importer_id
       where ura.user_id = ${id} and ura.revoked_at is null
       order by r.level desc
    `),
    canAssign && viewerRoles.length > 0
      ? getDb().execute<{ target_role: string; domain: string; scope: string }>(sql`
          select distinct on (rcr.target_role)
                 rcr.target_role::text as target_role,
                 r.domain::text as domain,
                 rcr.scope::text as scope
            from wms.role_creation_rule rcr
            join wms.role r on r.key = rcr.target_role
           where rcr.actor_role in (${sql.join(
             viewerRoles.map((r) => sql`${r}::wms.role_key`),
             sql`, `,
           )})
             and rcr.scope <> 'SELF_REGISTER'
           order by rcr.target_role, case rcr.scope when 'ANY' then 0 else 1 end
        `)
      : Promise.resolve([]),
    getDb().execute<{ id: number; name: string; code: string }>(sql`
      select id, name, code from wms.warehouse
       where is_active and deleted_at is null order by name limit 200
    `),
    getDb().execute<{ id: number; company_name: string; code: string }>(sql`
      select id, company_name, code from wms.importer
       where status = 'ACTIVE' and deleted_at is null order by company_name limit 200
    `),
  ]);

  const user = users[0];
  if (!user) notFound();

  const assignments: Assignment[] = roleRows.map((r) => ({
    id: r.id,
    role: r.role,
    domain: r.role_domain,
    isImmutable: r.is_immutable,
    warehouseName: r.warehouse_name,
    importerName: r.importer_name,
    assignedAt: r.assigned_at,
  }));

  const grantable: GrantableRole[] = grantableRows.map((r) => ({
    role: r.target_role,
    domain: r.domain as GrantableRole["domain"],
    scope: r.scope,
  }));

  const warehouses: ScopeOption[] = warehouseRows.map((w) => ({
    id: w.id,
    label: `${w.name} (${w.code})`,
  }));
  const importers: ScopeOption[] = importerRows.map((i) => ({
    id: i.id,
    label: `${i.company_name} (${i.code})`,
  }));

  return (
    <>
      <Link
        href="/admin/users"
        className="mb-4 inline-block text-xs font-medium text-verdigris-300 transition-colors hover:text-patina"
      >
        ← All users
      </Link>

      <PageHeader
        title={`${user.first_name} ${user.last_name}`}
        subtitle={user.email}
        action={
          <div className="flex items-center gap-2">
            {canUpdate ? (
              <UserNameEditor userId={user.id} firstName={user.first_name} lastName={user.last_name} />
            ) : null}
            <StatusBadge value={user.status} />
          </div>
        }
      />

      <Card className="mb-6 p-6">
        <Facts
          items={[
            {
              label: "Email",
              value: (
                <>
                  {user.email}{" "}
                  {user.email_verified ? null : (
                    <span className="text-xs text-amber-300">unverified</span>
                  )}
                </>
              ),
            },
            {
              label: "Mobile",
              value: (
                <>
                  {user.mobile}{" "}
                  {user.mobile_verified ? null : (
                    <span className="text-xs text-amber-300">unverified</span>
                  )}
                </>
              ),
            },
            {
              label: "Last signed in",
              value: user.last_login_at
                ? new Date(user.last_login_at).toLocaleString("en-IN")
                : "never",
            },
            {
              label: "Created",
              value: (
                <>
                  {new Date(user.created_at).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                  {user.created_by_email ? (
                    <span className="block text-xs text-verdigris-200/45">
                      by {user.created_by_email}
                    </span>
                  ) : (
                    <span className="block text-xs text-verdigris-200/45">
                      self-registered or seeded
                    </span>
                  )}
                </>
              ),
            },
            {
              label: "Password",
              value: user.must_change_password ? (
                <span className="text-amber-300">must be changed at next sign-in</span>
              ) : (
                "set"
              ),
            },
            ...(user.deactivation_reason
              ? [{ label: "Suspended because", value: user.deactivation_reason }]
              : []),
          ]}
        />

        {canUpdate ? (
          <div className="mt-6 border-t border-verdigris-300/10 pt-5">
            <UserStatus
              userId={user.id}
              status={user.status}
              isSuperAdmin={user.is_super}
              isSelf={user.id === guard.actor.session.userId}
            />
          </div>
        ) : null}
      </Card>

      <UserRoles
        userId={user.id}
        assignments={assignments}
        grantable={grantable}
        warehouses={warehouses}
        importers={importers}
      />
    </>
  );
}
