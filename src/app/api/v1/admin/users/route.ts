import { type NextRequest } from "next/server";

import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { createUser, UserCreateError } from "@/lib/users/create";
import { createUserRequestSchema } from "@/lib/validation/api-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
