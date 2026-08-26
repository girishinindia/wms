import { sql, type SQL } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { getDb } from "@/db";
import { handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guard";
import { actorWarehouseIds } from "@/lib/users/authority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/admin/expenses — the spending list, for the approvals
 * screen on the phone.
 *
 * The web list is the master machinery rendered server-side; this
 * answers the same rows with the same scoping rule, applied the same
 * way the write routes apply it: the warehouse is a property of the
 * ROW, so a WAREHOUSE-scoped grant filters `warehouse_id` against the
 * caller's own live assignments — never against anything in the
 * request. OWN narrows to rows the caller recorded themselves.
 *
 * `?status=PENDING|APPROVED|REJECTED` facets the list; the default is
 * everything, newest spend first, capped at 200 like the other lists.
 */
export async function GET(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor, grant } = await requirePermission("expense.read", {
        entityType: "expense",
      });

      let scope: SQL = sql``;
      if (grant.scope === "WAREHOUSE") {
        const mine = actorWarehouseIds(actor);
        if (mine.length === 0) return ok({ expenses: [] }, requestId);
        scope = sql`and e.warehouse_id in (${sql.join(
          mine.map((w) => sql`${w}`),
          sql`, `,
        )})`;
      } else if (grant.scope === "OWN") {
        scope = sql`and e.created_by = ${actor.session.userId}`;
      }

      const raw = (request.nextUrl.searchParams.get("status") ?? "").toUpperCase();
      const facet = ["PENDING", "APPROVED", "REJECTED"].includes(raw)
        ? sql`and e.approval_status = ${raw}`
        : sql``;

      const rows = await getDb().execute<{
        id: number;
        spent_on: string;
        paid_to: string;
        payment_mode: string;
        amount_paise: number;
        reference_no: string | null;
        notes: string | null;
        approval_status: string;
        approval_note: string | null;
        is_active: boolean;
        category: string;
        warehouse: string;
        created_by_name: string | null;
        receipts: number;
        created_at: string;
      }>(sql`
        select e.id, e.spent_on::text as spent_on, e.paid_to, e.payment_mode,
               e.amount_paise, e.reference_no, e.notes,
               e.approval_status, e.approval_note, e.is_active,
               c.name as category,
               (w.code || ' · ' || w.name) as warehouse,
               nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '')
                 as created_by_name,
               (select count(*)::int from wms.expense_receipt r
                 where r.expense_id = e.id) as receipts,
               e.created_at::text as created_at
          from wms.expense e
          join wms.expense_category c on c.id = e.expense_category_id
          join wms.warehouse w on w.id = e.warehouse_id
          left join wms.users u on u.id = e.created_by
         where e.deleted_at is null
           ${scope}
           ${facet}
         order by (e.approval_status = 'PENDING') desc, e.spent_on desc, e.id desc
         limit 200
      `);

      return ok(
        {
          expenses: rows.map((r) => ({
            id: Number(r.id),
            spentOn: r.spent_on,
            paidTo: r.paid_to,
            paymentMode: r.payment_mode,
            amountPaise: Number(r.amount_paise),
            referenceNo: r.reference_no,
            notes: r.notes,
            approvalStatus: r.approval_status,
            approvalNote: r.approval_note,
            isActive: r.is_active,
            category: r.category,
            warehouse: r.warehouse,
            createdByName: r.created_by_name,
            receipts: Number(r.receipts),
            createdAt: r.created_at,
          })),
        },
        requestId,
      );
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
