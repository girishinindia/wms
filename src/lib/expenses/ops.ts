import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { auditQuietly } from "@/lib/audit";
import type { Actor } from "@/lib/auth/guard";
import { grantFor } from "@/lib/auth/guard";
import { ImageError, validateWebp } from "@/lib/images/webp";
import { formatPaise } from "@/lib/money";
import { announce } from "@/lib/notify/announce";
import { configured, deleteObject, publicUrl, putObject } from "@/lib/storage/bunny";
import { actorWarehouseIds } from "@/lib/users/authority";

/**
 * Expenses: the parts the generic master machinery cannot do.
 *
 * Recording, editing and cancelling an expense all go through the same
 * registry-driven route every other master screen uses. What lives here
 * is the three things that are specific to money — who may touch a row
 * at a site that is not theirs, the decision that makes an entry count,
 * and the bill that proves it.
 */

export class ExpenseError extends Error {
  constructor(
    readonly kind: "VALIDATION_FAILED" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "INTERNAL",
    message: string,
  ) {
    super(message);
    this.name = "ExpenseError";
  }
}

export type Meta = { requestId: string; ip: string | null; userAgent: string | null };

/** A phone snap of a bill, or the PDF the supplier emailed. */
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
const WEBP_MAX_BYTES = 1024 * 1024;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"

export type ExpenseRow = {
  id: number;
  warehouseId: number;
  approvalStatus: string;
  amountPaise: number;
  category: string;
  warehouse: string;
  createdBy: number | null;
};

async function load(id: number): Promise<ExpenseRow | null> {
  const rows = await getDb().execute<{
    id: number;
    warehouse_id: number;
    approval_status: string;
    amount_paise: number;
    category: string;
    warehouse: string;
    created_by: number | null;
  }>(sql`
    select e.id, e.warehouse_id, e.approval_status, e.amount_paise, e.created_by,
           c.name as category,
           (w.code || ' · ' || w.name) as warehouse
      from wms.expense e
      join wms.expense_category c on c.id = e.expense_category_id
      join wms.warehouse w on w.id = e.warehouse_id
     where e.id = ${id} and e.deleted_at is null
  `);
  const r = rows[0];
  return r
    ? {
        id: Number(r.id),
        warehouseId: Number(r.warehouse_id),
        approvalStatus: r.approval_status,
        amountPaise: Number(r.amount_paise),
        category: r.category,
        warehouse: r.warehouse,
        createdBy: r.created_by === null ? null : Number(r.created_by),
      }
    : null;
}

/**
 * May this caller act on this expense?
 *
 * The same shape as `mayActOnUser` on the users screen, and for the same
 * reason: `requirePermission` lets a WAREHOUSE-scoped grant through when
 * the request names no warehouse, which is right for a create and wrong
 * here, where the warehouse is a property of the ROW. Checked against
 * the caller's own live assignments, never against anything in the
 * request.
 */
export async function mayTouchExpense(
  actor: Actor,
  expenseId: number,
  permission: string,
): Promise<ExpenseRow> {
  const row = await load(expenseId);
  if (!row) throw new ExpenseError("NOT_FOUND", "No such expense");

  const grant = grantFor(actor, permission);
  if (!grant) throw new ExpenseError("FORBIDDEN", "You do not have permission to do that.");
  if (grant.scope === "ALL") return row;

  if (!actorWarehouseIds(actor).includes(row.warehouseId)) {
    throw new ExpenseError(
      "FORBIDDEN",
      "That expense belongs to a warehouse you are not assigned to.",
    );
  }
  return row;
}

// ── The decision ──────────────────────────────────────────────────

/**
 * Approve or reject.
 *
 * A decision is not reversible into PENDING: once somebody has put their
 * name to it, "undecided" is not a state the record can honestly go back
 * to. Changing your mind means deciding again the other way, and both
 * decisions are in the audit log.
 */
export async function decideExpense(
  expenseId: number,
  decision: "APPROVED" | "REJECTED",
  note: string | null,
  actor: Actor,
  meta: Meta,
): Promise<void> {
  const row = await mayTouchExpense(actor, expenseId, "expense.approve");

  if (row.approvalStatus === decision) {
    throw new ExpenseError("CONFLICT", `That expense is already ${decision.toLowerCase()}.`);
  }
  if (decision === "REJECTED" && (note ?? "").trim().length < 5) {
    throw new ExpenseError("VALIDATION_FAILED", "Say why it is being rejected.");
  }

  await getDb().execute(sql`
    update wms.expense
       set approval_status = ${decision},
           approved_by     = ${actor.session.userId},
           approved_at     = now(),
           approval_note   = ${note?.trim() || null},
           updated_by      = ${actor.session.userId}
     where id = ${expenseId} and deleted_at is null
  `);

  const actorName = `${actor.session.firstName} ${actor.session.lastName}`.trim();

  await auditQuietly({
    action: "expense.decided",
    operation: "UPDATE",
    entityType: "expense",
    entityId: String(expenseId),
    entityLabel: `${formatPaise(row.amountPaise)} · ${row.category} · ${row.warehouse}`,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName,
    reason: note ?? undefined,
    before: { approvalStatus: row.approvalStatus },
    after: { approvalStatus: decision },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });

  /**
   * The rule points at ACTOR, which `resolve_notification_audience`
   * reads as "the actor of the ORIGINAL event" — here, whoever recorded
   * the expense. That is who is waiting to hear, and it is deliberately
   * not the person who just clicked the button.
   */
  await announce({
    eventKey: "expense.decided",
    values: {
      decision: decision === "APPROVED" ? "approved" : "rejected",
      amount: formatPaise(row.amountPaise),
      category: row.category,
      warehouse: row.warehouse,
      actorName,
      noteSuffix: note?.trim() ? ` — ${note.trim()}` : "",
    },
    dedupeSuffix: `expense-${expenseId}-${decision}`,
    actorUserId: row.createdBy,
    entityType: "expense",
    entityId: String(expenseId),
    warehouseId: row.warehouseId,
    correlationId: meta.requestId,
  }).catch((error: unknown) => {
    console.error("[expense] decision not announced", {
      expenseId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * Tell the super admins that something is waiting.
 *
 * Called by the generic create route after it has written the row, and
 * only when the row landed PENDING — an expense a super admin recorded
 * is approved on arrival and there is nobody to tell.
 */
export async function announceSubmitted(
  expenseId: number,
  actor: Actor,
  meta: Meta,
): Promise<void> {
  const row = await load(expenseId);
  if (!row) return;
  await announce({
    eventKey: "expense.submitted",
    values: {
      amount: formatPaise(row.amountPaise),
      category: row.category,
      warehouse: row.warehouse,
      actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    },
    dedupeSuffix: `expense-${expenseId}`,
    actorUserId: actor.session.userId,
    entityType: "expense",
    entityId: String(expenseId),
    warehouseId: row.warehouseId,
    correlationId: meta.requestId,
  }).catch((error: unknown) => {
    console.error("[expense] submission not announced", {
      expenseId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

// ── Receipts ──────────────────────────────────────────────────────

export type Receipt = {
  id: number;
  url: string;
  contentType: string;
  bytes: number;
  originalName: string | null;
  createdAt: string;
};

export async function listReceipts(expenseId: number): Promise<Receipt[]> {
  const rows = await getDb().execute<{
    id: number;
    url: string;
    content_type: string;
    bytes: number;
    original_name: string | null;
    created_at: string;
  }>(sql`
    select id, url, content_type, bytes, original_name, created_at
      from wms.expense_receipt
     where expense_id = ${expenseId}
     order by id
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    url: r.url,
    contentType: r.content_type,
    bytes: Number(r.bytes),
    originalName: r.original_name,
    createdAt: String(r.created_at),
  }));
}

/**
 * What arrived, and is it really that?
 *
 * The declared content type is a claim by the caller. A WebP is checked
 * by the same header parser the gallery uses; a PDF by its first four
 * bytes. Trusting the header alone is how an HTML file with a PDF
 * content type ends up on a CDN under your own domain.
 */
function sniff(bytes: Uint8Array, declared: string): "image/webp" | "application/pdf" {
  if (declared === "application/pdf") {
    const ok = PDF_MAGIC.every((b, i) => bytes[i] === b);
    if (!ok) throw new ExpenseError("VALIDATION_FAILED", "That file is not a PDF");
    if (bytes.length > RECEIPT_MAX_BYTES) {
      throw new ExpenseError("VALIDATION_FAILED", "That PDF is over 5 MB");
    }
    return "application/pdf";
  }
  if (declared === "image/webp") {
    try {
      validateWebp(bytes, { maxBytes: WEBP_MAX_BYTES, maxEdge: 2400, minEdge: 64 });
    } catch (error) {
      if (error instanceof ImageError) {
        throw new ExpenseError("VALIDATION_FAILED", error.message);
      }
      throw error;
    }
    return "image/webp";
  }
  throw new ExpenseError("VALIDATION_FAILED", "A receipt has to be an image or a PDF");
}

/**
 * Attach one bill.
 *
 * Object first, row second — the same order as the warehouse gallery,
 * and for the same reason: the reverse leaves a row pointing at nothing,
 * which renders as a broken link with no way to tell it from a CDN
 * hiccup.
 */
export async function addReceipt(
  expenseId: number,
  bytes: Uint8Array,
  declaredType: string,
  originalName: string | null,
  actor: Actor,
  meta: Meta,
): Promise<Receipt> {
  const row = await mayTouchExpense(actor, expenseId, "expense.update");
  const contentType = sniff(bytes, declaredType);

  if (!configured()) {
    throw new ExpenseError("CONFLICT", "Receipt storage is not configured on this environment");
  }

  const extension = contentType === "application/pdf" ? "pdf" : "webp";
  const key = `expenses/${expenseId}/${randomBytes(8).toString("hex")}.${extension}`;
  const put = await putObject(key, bytes, contentType);
  if (!put.ok) {
    console.error("[expense] receipt upload failed", { requestId: meta.requestId, key, ...put });
    throw new ExpenseError("INTERNAL", "The receipt could not be stored. Try again.");
  }
  const url = publicUrl(key);

  // Never used to build the key — that is random — but worth keeping so
  // a list of three receipts is more than three identical links.
  const clean = (originalName ?? "").replace(/[^\w. -]/g, "").slice(0, 120) || null;

  let rows: Record<string, unknown>[];
  try {
    rows = await getDb().execute<Record<string, unknown>>(sql`
      insert into wms.expense_receipt
        (expense_id, storage_key, url, content_type, bytes, original_name, created_by)
      values (${expenseId}, ${key}, ${url}, ${contentType}, ${bytes.length}, ${clean},
              ${actor.session.userId})
      returning id, created_at
    `);
  } catch (error) {
    // Nothing points at the object now, so it must not stay.
    await deleteObject(key);
    throw error;
  }

  await auditQuietly({
    action: "expense.receipt_added",
    operation: "INSERT",
    entityType: "expense_receipt",
    entityId: String(rows[0]!.id),
    entityLabel: `${formatPaise(row.amountPaise)} · ${row.category}`,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    after: { expenseId, storageKey: key, contentType, bytes: bytes.length },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });

  return {
    id: Number(rows[0]!.id),
    url,
    contentType,
    bytes: bytes.length,
    originalName: clean,
    createdAt: String(rows[0]!.created_at),
  };
}

/**
 * Remove one bill.
 *
 * File first: if the CDN delete is refused, the row stays and the
 * receipt is still listed, which is recoverable. The other order leaves
 * a paid-for file that nothing in the system remembers.
 *
 * Refused once the expense has been approved — the receipt is what the
 * approval was given against, and pulling it afterwards would leave an
 * approved figure with nothing behind it.
 */
export async function deleteReceipt(
  expenseId: number,
  receiptId: number,
  actor: Actor,
  meta: Meta,
): Promise<void> {
  const row = await mayTouchExpense(actor, expenseId, "expense.update");

  if (row.approvalStatus === "APPROVED" && grantFor(actor, "expense.approve") === null) {
    throw new ExpenseError(
      "FORBIDDEN",
      "That expense has been approved. Ask a super admin if the receipt has to come off.",
    );
  }

  const found = await getDb().execute<{ storage_key: string; original_name: string | null }>(sql`
    select storage_key, original_name from wms.expense_receipt
     where id = ${receiptId} and expense_id = ${expenseId}
  `);
  if (found.length === 0) throw new ExpenseError("NOT_FOUND", "No such receipt");

  const gone = await deleteObject(found[0]!.storage_key);
  if (!gone.ok) {
    console.error("[expense] receipt file not removed", {
      requestId: meta.requestId,
      key: found[0]!.storage_key,
      ...gone,
    });
    throw new ExpenseError("INTERNAL", "The receipt file could not be removed. Try again.");
  }

  await getDb().execute(sql`
    delete from wms.expense_receipt where id = ${receiptId} and expense_id = ${expenseId}
  `);

  await auditQuietly({
    action: "expense.receipt_removed",
    operation: "DELETE",
    entityType: "expense_receipt",
    entityId: String(receiptId),
    entityLabel: found[0]!.original_name ?? found[0]!.storage_key,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    before: { expenseId, storageKey: found[0]!.storage_key },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
}
