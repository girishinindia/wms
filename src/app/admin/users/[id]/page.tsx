import Link from "next/link";
import { notFound } from "next/navigation";

import UserRoles, {
  type Assignment,
  type GrantableRole,
  type ScopeOption,
} from "@/components/admin/UserRoles";
import ResendInvite from "@/components/admin/ResendInvite";
import UserNameEditor from "@/components/admin/UserNameEditor";
import UserOverrides, { type Grantable, type Override } from "@/components/admin/UserOverrides";
import UserStatus from "@/components/admin/UserStatus";
import Avatar from "@/components/admin/Avatar";
import { Card, Denied, Facts, PageHeader, StatusBadge } from "@/components/admin/ui";
import { getDb } from "@/db";
import { grantFor, pageGuard } from "@/lib/auth/guard";
import { listOverrides } from "@/lib/roles/matrix";
import { actorWarehouseIds, mayActOnUser, mayManageUser } from "@/lib/users/authority";
import { fmtDateTime, fmtDay } from "@/lib/format/datetime";
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
  /**
   * Re-issuing a password is the same act as creating the account, so
   * it asks for `user.create` and not `user.update`. Being allowed to
   * correct somebody's phone number is not the same permission as being
   * allowed to hand them a working credential.
   *
   * `mayActOnUser` is checked below, once the target's roles are known,
   * and again by the route — this only decides whether to draw it.
   */
  const canInvite = grantFor(guard.actor, "user.create") !== null;

  const [users, roleRows, grantableRows, warehouseRows, importerRows] = await Promise.all([
    getDb().execute<{
      id: number;
      email: string;
      first_name: string;
      photo_url: string | null;
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
      select u.id, u.email::text as email, u.first_name, u.last_name, u.photo_url,
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

  /**
   * The list is narrowed to the viewer's own people; typing a URL must
   * not be a way round it. Read scope is checked against the target the
   * same way every write is.
   */
  if (id !== guard.actor.session.userId) {
    const readable = await mayActOnUser(guard.actor, id, "user.read", "open it");
    if (readable !== true) return <Denied what="this account" />;
  }

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

  /**
   * The same question the API asks, asked here so the panel is not
   * offered at all rather than offered and refused.
   *
   * It is deliberately asked after the queries above: `mayManageUser`
   * reads the target's live assignments, which is exactly what decides
   * whether this account is one the viewer may touch — their own row,
   * an importer's, or somebody who works at another branch.
   */
  const manage = canAssign ? await mayManageUser(guard.actor, id) : ({ ok: false as const, reason: "" });
  const manageable = manage === true;
  const lockedReason = manage === true ? null : manage.reason;

  /**
   * Whether to draw the "send sign-in details" button.
   *
   * The same three questions the endpoint asks, in the same order: do
   * you hold `user.create`, is this account within your reach, and is
   * it somebody other than you. Your own password is changed from your
   * profile, not by mailing yourself a new one.
   */
  const isSelf = id === guard.actor.session.userId;
  const mayInvite =
    canInvite &&
    !isSelf &&
    (await mayActOnUser(guard.actor, id, "user.create", "send their sign-in details")) === true;

  // A warehouse admin picks from their own sites; a super admin from all.
  const assignScope = grantFor(guard.actor, "role.assign");
  const mine = actorWarehouseIds(guard.actor);
  const warehouses: ScopeOption[] = warehouseRows
    .filter((w) => assignScope?.scope === "ALL" || mine.includes(w.id))
    .map((w) => ({
      id: w.id,
      label: `${w.name} (${w.code})`,
    }));
  const importers: ScopeOption[] = importerRows.map((i) => ({
    id: i.id,
    label: `${i.company_name} (${i.code})`,
  }));

  /**
   * The exceptions card needs three lists, and they are three different
   * questions: what exceptions exist, what the TARGET holds (the only
   * things a deny can take away), and what the VIEWER holds (the only
   * things an allow can hand out).
   *
   * Sequential, never Promise.all — see src/db/index.ts on pipelining.
   */
  const overrides: Override[] = canAssign ? await listOverrides(id) : [];

  const heldRows = canAssign
    ? await getDb().execute<{ permission: string; scope: string }>(sql`
        select permission, scope::text as scope
          from wms.user_effective_permission
         where user_id = ${id}
         order by permission
      `)
    : [];

  /** Rule 1 made visible: you cannot hand out what you do not hold. */
  const iHold: Grantable[] = manageable
    ? guard.actor.permissions
        .map((p) => ({ key: p.permission, description: null, maxScope: p.scope }))
        .sort((a, b) => a.key.localeCompare(b.key))
    : [];

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
        leading={
          <Avatar
            name={`${user.first_name} ${user.last_name}`}
            photoUrl={user.photo_url}
            size={56}
          />
        }
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
              // No options at all previously, which meant the machine's
              // locale AND zone — the widest possible mismatch between a
              // UTC server and a browser anywhere.
              value: user.last_login_at ? fmtDateTime(user.last_login_at) : "never",
            },
            {
              label: "Created",
              value: (
                <>
                  {fmtDay(user.created_at)}
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
              value: (
                <>
                  {user.must_change_password ? (
                    <span className="text-amber-300">must be changed at next sign-in</span>
                  ) : (
                    "set"
                  )}
                  {/*
                    "I never got the email" is the commonest request
                    there is, and until now the only answer was to
                    delete the account and make it again. This issues a
                    NEW temporary password and emails it — the old one
                    exists only as a hash and cannot be read back, which
                    is the point rather than a limitation.

                    Offered only on somebody else's account, and only to
                    a viewer who could have created them: it hands over a
                    working credential, so it asks the same question the
                    endpoint behind it asks.
                  */}
                  {mayInvite && user.status === "ACTIVE" ? (
                    <span className="mt-2 block">
                      <ResendInvite
                        userId={user.id}
                        className="rounded-lg border border-verdigris-300/25 px-2.5 py-1 text-xs text-verdigris-100 transition-colors hover:border-verdigris-300/50 disabled:opacity-55"
                      />
                    </span>
                  ) : null}
                </>
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
        grantable={manageable ? grantable : []}
        warehouses={warehouses}
        importers={importers}
        manageable={manageable}
        lockedReason={lockedReason}
      />

      {canAssign ? (
        <div className="mt-6">
          <UserOverrides
            userId={user.id}
            overrides={overrides}
            held={heldRows.map((h) => ({ key: h.permission, scope: h.scope }))}
            grantable={iHold}
            manageable={manageable}
          />
        </div>
      ) : null}
    </>
  );
}
