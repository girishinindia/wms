import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { getDb } from "@/db";
import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { createUser, UserCreateError } from "@/lib/users/create";
import { actorWarehouseIds } from "@/lib/users/authority";
import { createUserRequestSchema } from "@/lib/validation/api-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/admin/users — the people list, for a native client.
 *
 * The visibility rule is the web page's, verbatim: an ALL-scoped
 * `user.read` sees everyone; anything narrower sees themselves plus the
 * users who sit WHOLLY within the caller's own sites — a user with even
 * one assignment elsewhere (or a site-less one, which is how super
 * admins look) stays invisible, so a warehouse admin can never read the
 * platform's operators off this endpoint.
 */
export async function GET() {
  return handler(async ({ requestId }) => {
    try {
      const { actor, grant } = await requirePermission("user.read", {
        entityType: "user",
      });

      const everyone = grant.scope === "ALL" ? sql`true` : sql`false`;
      const sites = actorWarehouseIds(actor);
      const siteList =
        sites.length > 0
          ? sql.join(sites.map((id) => sql`${id}`), sql`, `)
          : sql`null`;

      const rows = await getDb().execute<{
        id: number;
        email: string;
        first_name: string;
        last_name: string;
        photo_url: string | null;
        mobile: string;
        status: string;
        email_verified: boolean;
        mobile_verified: boolean;
        must_change_password: boolean;
        roles: string[] | null;
        last_login_at: string | null;
        is_super: boolean;
        company: string | null;
      }>(sql`
        select u.id, u.email::text as email, u.first_name, u.last_name, u.photo_url,
               u.mobile::text as mobile, u.status::text as status,
               u.email_verified_at is not null as email_verified,
               u.mobile_verified_at is not null as mobile_verified,
               u.must_change_password,
               u.last_login_at::text as last_login_at,
               array_remove(array_agg(distinct ura.role::text), null) as roles,
               wms.is_super_admin(u.id) as is_super,
               min(i.company_name) as company
          from wms.users u
          left join wms.user_role_assignment ura
            on ura.user_id = u.id and ura.revoked_at is null
          left join wms.importer i on i.id = ura.importer_id and i.deleted_at is null
         where u.deleted_at is null
           and (
             ${everyone}
             or u.id = ${actor.session.userId}
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

      return ok(
        {
          users: rows.map((r) => ({
            id: Number(r.id),
            email: r.email,
            firstName: r.first_name,
            lastName: r.last_name,
            photoUrl: r.photo_url,
            mobile: r.mobile,
            status: r.status,
            emailVerified: Boolean(r.email_verified),
            mobileVerified: Boolean(r.mobile_verified),
            mustChangePassword: Boolean(r.must_change_password),
            roles: r.roles ?? [],
            lastLoginAt: r.last_login_at,
            isSuper: Boolean(r.is_super),
            company: r.company,
          })),
        },
        requestId,
      );
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}

/**
 * POST /api/v1/admin/users — add a member of staff.
 *
 * Deliberately thin. Everything that decides whether this is allowed
 * lives in `lib/users/authority.ts`, which reads `role_creation_rule`;
 * everything that does the work lives in `lib/users/create.ts`. This
 * file is the seam between HTTP and those two: parse, call, translate.
 *
 * Note the permission asked for is `user.create` and NOT `role.assign`.
 * A warehouse admin holds `user.create` at WAREHOUSE scope, which
 * `requirePermission` lets through without a warehouse on the request —
 * a create has no warehouse until the body is read. The narrowing that
 * matters happens inside `mayAssign`, against the caller's own live
 * assignments rather than against anything the request claims.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor } = await requirePermission("user.create", { entityType: "user" });

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      }

      const parsed = createUserRequestSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const input = parsed.data;

      const created = await createUser(
        {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          mobile: input.mobile,
          role: input.role,
          warehouseId: input.warehouseId ?? null,
          note: input.note,
        },
        actor,
        {
          requestId,
          ip: clientIp(request.headers),
          userAgent: request.headers.get("user-agent"),
        },
      );

      return ok(created, requestId, 201);
    } catch (error) {
      if (error instanceof UserCreateError) {
        return fail(error.kind, error.message, requestId, { fields: error.fields });
      }
      /**
       * The last line of defence, and the reason it reads the message.
       *
       * `ura_enforce_exclusivity`, `ura_protect_immutable` and
       * `ura_protect_super_admin` are triggers: they refuse things this
       * code has already refused, for anybody who reaches the database
       * another way. If one of them fires here it means a rule was
       * missed above, and the person clicking the button deserves the
       * sentence rather than "something went wrong".
       */
      const message = error instanceof Error ? error.message : "";
      if (/exclusive/i.test(message)) {
        return fail(
          "CONFLICT",
          "That role cannot be combined with any other role that account holds.",
          requestId,
        );
      }
      if (/immutable/i.test(message)) {
        return fail(
          "FORBIDDEN",
          "That role cannot be assigned or changed once made.",
          requestId,
          { fields: { role: "Cannot be assigned" } },
        );
      }
      if (/duplicate key|unique constraint/i.test(message)) {
        return fail("CONFLICT", "An account with that email or mobile already exists", requestId, {
          fields: { email: "Already in use" },
        });
      }
      if (/mobile_in|invalid input value|violates check constraint/i.test(message)) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: { mobile: "Enter a 10-digit Indian mobile number" },
        });
      }
      return toResponse(error, requestId);
    }
  })();
}
