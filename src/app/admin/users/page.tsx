
import UserCreateDrawer from "@/components/admin/UserCreateDrawer";
import UsersTable from "@/components/admin/UsersTable";
import { Card, Denied, PageHeader } from "@/components/admin/ui";
import { getDb } from "@/db";
import { grantFor, pageGuard } from "@/lib/auth/guard";
import { actorWarehouseIds, creatableRoles } from "@/lib/users/authority";
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

  /**
   * Whose logins this viewer may see.
   *
   * `user.read` at ALL is everyone. At WAREHOUSE it is the people whose
   * every live assignment sits inside the viewer's own sites — the same
   * test `mayActOnUser` applies before letting anything be changed, so
   * the list and the buttons on it agree. Without this a branch manager
   * was shown every importer's email address and mobile number, and an
   * Active switch on accounts the API would refuse to touch.
   */
  const readGrant = grantFor(guard.actor, "user.read");
  const sites = actorWarehouseIds(guard.actor);
  const everyone = readGrant?.scope === "ALL";
  const siteList =
    sites.length > 0
      ? sql.join(
          sites.map((id) => sql`${id}`),
          sql`, `,
        )
      : sql`null`;

  const rows = await getDb().execute<{
    id: number;
    email: string;
    first_name: string;
    photo_url: string | null;
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
    select u.id, u.email::text as email, u.first_name, u.last_name, u.photo_url,
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
       and (
         ${everyone}
         or u.id = ${guard.actor.session.userId}
         or (
           exists (
             select 1 from wms.user_role_assignment a
              where a.user_id = u.id and a.revoked_at is null
                and a.warehouse_id in (${siteList})
           )
           and not exists (
             select 1 from wms.user_role_assignment a
              where a.user_id = u.id and a.revoked_at is null
                and (a.warehouse_id is null or a.warehouse_id not in (${siteList}))
           )
         )
       )
     group by u.id
     order by u.created_at desc
     limit 300
  `);

  /**
   * What "Add user" is allowed to offer.
   *
   * Both halves are computed here, on the server, from the viewer's own
   * grants — never sent up from the browser. The role list comes from
   * `role_creation_rule`; the warehouse list is narrowed to the sites
   * the viewer actually holds unless they hold `user.create` at ALL.
   * The API re-checks both, so this is about not offering a choice that
   * would be refused, not about security.
   */
  const createGrant = grantFor(guard.actor, "user.create");
  const roles = createGrant ? await creatableRoles(guard.actor) : [];

  const mine = actorWarehouseIds(guard.actor);
  const wide = createGrant?.scope === "ALL";
  const warehouseRows =
    roles.some((r) => r.domain === "WAREHOUSE") && (wide || mine.length > 0)
      ? await getDb().execute<{ id: number; name: string; code: string }>(sql`
          select id, name, code
            from wms.warehouse
           where is_active and deleted_at is null
             and (${wide} or id in (${
               mine.length > 0
                 ? sql.join(
                     mine.map((id) => sql`${id}`),
                     sql`, `,
                   )
                 : sql`null`
             }))
           order by name
           limit 200
        `)
      : [];

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
            photoUrl: r.photo_url,
          }))}
          canUpdate={grantFor(guard.actor, "user.update") !== null}
          canDelete={grantFor(guard.actor, "user.delete") !== null}
          selfId={guard.actor.session.userId}
          action={
            roles.length > 0 ? (
              <UserCreateDrawer
                roles={roles.map((r) => ({ role: r.role, label: r.label, domain: r.domain }))}
                warehouses={warehouseRows.map((w) => ({
                  id: w.id,
                  label: `${w.name} (${w.code})`,
                }))}
              />
            ) : null
          }
        />
      </Card>
    </>
  );
}
