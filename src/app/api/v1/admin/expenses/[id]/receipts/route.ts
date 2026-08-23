import { type NextRequest } from "next/server";

import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import {
  addReceipt,
  ExpenseError,
  listReceipts,
  mayTouchExpense,
  RECEIPT_MAX_BYTES,
} from "@/lib/expenses/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Receipts on one expense.
 *
 * The body is the file itself, not multipart — the same shape the
 * warehouse gallery uses. A phone photo is converted to WebP in the
 * browser before it is sent, so the four megabytes never cross the
 * network; a PDF goes as it is, because there is nothing useful to do
 * to it client-side.
 */

function idFrom(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { id: raw } = await context.params;
      const expenseId = idFrom(raw);
      if (expenseId === null) return fail("NOT_FOUND", "No such expense", requestId);

      const { actor } = await requirePermission("expense.read", {
        entityType: "expense",
        entityId: String(expenseId),
      });
      // A WAREHOUSE-scoped grant passes `requirePermission` with no
      // warehouse named; the site is a property of the row, so it is
      // checked against the row.
      await mayTouchExpense(actor, expenseId, "expense.read");

      return ok({ receipts: await listReceipts(expenseId) }, requestId);
    } catch (error) {
      if (error instanceof ExpenseError) return fail(error.kind, error.message, requestId);
      return toResponse(error, requestId);
    }
  })();
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handler(async ({ requestId }) => {
    try {
      const { id: raw } = await context.params;
      const expenseId = idFrom(raw);
      if (expenseId === null) return fail("NOT_FOUND", "No such expense", requestId);

      const { actor } = await requirePermission("expense.update", {
        entityType: "expense",
        entityId: String(expenseId),
      });

      /**
       * Whose expense is this, before anything about the file.
       *
       * An authorisation gate belongs in front of the body checks: a
       * caller reaching for another branch's expense should be told 403,
       * not "nothing was sent", and there is no reason to read a body
       * that was never allowed to arrive.
       */
      await mayTouchExpense(actor, expenseId, "expense.update");

      // Refuse on the declared length before reading the body, so a
      // 40 MB upload is not pulled into memory to be rejected.
      const declared = Number(request.headers.get("content-length") ?? 0);
      if (declared > RECEIPT_MAX_BYTES) {
        return fail(
          "VALIDATION_FAILED",
          `That file is over ${Math.round(RECEIPT_MAX_BYTES / (1024 * 1024))} MB`,
          requestId,
        );
      }

      const contentType = (request.headers.get("content-type") ?? "").split(";")[0]!.trim();
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length === 0) return fail("VALIDATION_FAILED", "Nothing was sent", requestId);

      const receipt = await addReceipt(
        expenseId,
        bytes,
        contentType,
        request.headers.get("x-file-name"),
        actor,
        {
          requestId,
          ip: clientIp(request.headers),
          userAgent: request.headers.get("user-agent"),
        },
      );

      return ok(receipt, requestId, 201);
    } catch (error) {
      if (error instanceof ExpenseError) return fail(error.kind, error.message, requestId);
      return toResponse(error, requestId);
    }
  })();
}
