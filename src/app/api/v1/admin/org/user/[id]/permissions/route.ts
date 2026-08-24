import { type NextRequest } from "next/server";

import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { readUserPermissions } from "@/lib/org/tree";
import { mayActOnUser } from "@/lib/users/authority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/admin/org/user/[id]/permissions
 *
 * The leaf of the hierarchy tree, fetched when somebody opens it rather
 * than shipped with the page. A super admin holds 156 permissions and
 * the tree has 22 people in it: sending every list to render the two or
 * three anybody expands is several thousand nodes for nothing.
 *
 * Guarded exactly like the tree it hangs off — `user.read`, then
 * `mayActOnUser`, so a warehouse admin cannot read the permission set of
 * somebody at another branch by asking for their id directly. The tree
 * would not have offered the node; this is the same answer given twice,
 * which is the only kind worth relying on.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { id: raw } = await context.params;
      const userId = Number(raw);
      if (!Number.isInteger(userId) || userId <= 0) {
        return fail("NOT_FOUND", "No such user", requestId);
      }

      const { actor } = await requirePermission("user.read", {
        entityType: "user",
        entityId: String(userId),
      });

      if (userId !== actor.session.userId) {
        const reach = await mayActOnUser(actor, userId, "user.read", "see what they can do");
        if (reach !== true) return fail(reach.kind, reach.reason, requestId);
      }

      return ok({ groups: await readUserPermissions(userId) }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
