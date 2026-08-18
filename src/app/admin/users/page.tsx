
import UsersTable from "@/components/admin/UsersTable";
import { Card, Denied, PageHeader } from "@/components/admin/ui";
import { getDb } from "@/db";
import { grantFor, pageGuard } from "@/lib/auth/guard";
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
    is_super: boolean;
    company: string | null;
  }>(sql`
    select u.id, u.email::text as email, u.first_name, u.last_name,
           u.mobile::text as mobile, u.status::text as status,
           u.email_verified_at is not null as email_verified,
           u.mobile_verified_at is not null as mobile_verified,
           u.last_login_at,
           array_remove(array_agg(distinct ura.role::text), null) as roles,
           wms.is_super_admin(u.id) as is_super,
           -- The company an importer-domain login belongs to.
           min(i.company_name) as company
      from wms.users u
      left join wms.user_role_assignment ura
        on ura.user_id = u.id and ura.revoked_at is null
      left join wms.importer i on i.id = ura.importer_id and i.deleted_at is null
     where u.deleted_at is null
     group by u.id
     order by u.created_at desc
     limit 300
  `);

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Every login — admins, importers and sales agents. Deactivating or deleting a login does the same to the company or agent profile behind it."
      />

      <Card>
        <UsersTable
          rows={rows.map((r) => ({
            id: r.id,
            name: `${r.first_name} ${r.last_name}`.trim(),
            email: r.email,
            mobile: r.mobile,
            status: r.status,
            emailVerified: r.email_verified,
            mobileVerified: r.mobile_verified,
            roles: r.roles ?? [],
            lastLoginAt: r.last_login_at ? String(r.last_login_at) : null,
            isSuperAdmin: r.is_super,
            company: r.company,
          }))}
          canUpdate={grantFor(guard.actor, "user.update") !== null}
          canDelete={grantFor(guard.actor, "user.delete") !== null}
          selfId={guard.actor.session.userId}
        />
      </Card>
    </>
  );
}
