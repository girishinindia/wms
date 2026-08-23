import { type NextRequest } from "next/server";

import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { decideExpense, ExpenseError } from "@/lib/expenses/ops";
import { decideExpenseRequestSchema } from "@/lib/validation/api-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/admin/expenses/[id]/approve — approve or reject.
 *
 * One endpoint for both, because they are one decision with two answers
 * and splitting them would duplicate every check in front of the verb.
 *
 * `expense.approve` is held by the super admin and nobody else, which is
 * also what makes an expense a super admin records approved on arrival:
 * the rule the create route applies is "auto-approve if the author could
 * approve it anyway", so the two can never disagree about who is exempt.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { id: rawId } = await context.params;
      const expenseId = Number(rawId);
      if (!Number.isInteger(expenseId) || expenseId <= 0) {
        return fail("NOT_FOUND", "No such expense", requestId);
      }

      const { actor } = await requirePermission("expense.approve", {
        entityType: "expense",
        entityId: String(expenseId),
      });

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      }

      const parsed = decideExpenseRequestSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }

      await decideExpense(
        expenseId,
        parsed.data.decision,
        parsed.data.note ?? null,
        actor,
        {
          requestId,
          ip: clientIp(request.headers),
          userAgent: request.headers.get("user-agent"),
        },
      );

      return ok({ ok: true as const }, requestId);
    } catch (error) {
      if (error instanceof ExpenseError) {
        return fail(error.kind, error.message, requestId);
      }
      return toResponse(error, requestId);
    }
  })();
}
