import { type NextRequest } from "next/server";

import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { deleteReceipt, ExpenseError } from "@/lib/expenses/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE one receipt — from the CDN and from the table.
 *
 * A real delete, not a soft one, because the object it points at is
 * really gone. The audit row keeps the storage key and who removed it,
 * which is where the history lives.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; receiptId: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { id: rawId, receiptId: rawReceipt } = await context.params;
      const expenseId = Number(rawId);
      const receiptId = Number(rawReceipt);
      if (
        !Number.isInteger(expenseId) || expenseId <= 0 ||
        !Number.isInteger(receiptId) || receiptId <= 0
      ) {
        return fail("NOT_FOUND", "No such receipt", requestId);
      }

      const { actor } = await requirePermission("expense.update", {
        entityType: "expense",
        entityId: String(expenseId),
      });

      await deleteReceipt(expenseId, receiptId, actor, {
        requestId,
        ip: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
      });

      return ok({ ok: true as const }, requestId);
    } catch (error) {
      if (error instanceof ExpenseError) return fail(error.kind, error.message, requestId);
      return toResponse(error, requestId);
    }
  })();
}
