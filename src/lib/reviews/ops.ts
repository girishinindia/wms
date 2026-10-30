import "server-only";

import { sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";

import { getDb } from "@/db";
import { auditQuietly } from "@/lib/audit";
import { grantFor, importerIdOf, type Actor } from "@/lib/auth/guard";
import { InwardError, type Meta } from "@/lib/inward/ops";

import { PUBLIC_REVIEW_TAG } from "./public";
import {
  STATUS_OF_DECISION,
  type DecisionInput,
  type ReviewInput,
  type ReviewStatus,
} from "./validation";

/**
 * Reviews — who may write one, and who decides whether it is shown.
 *
 *   write    an IMPORTER or a SALES_AGENT, signed in, for the company
 *            their role names. One review per person; editing it sends
 *            it back to the queue, because what was approved is no
 *            longer what would be shown.
 *   decide   a super admin (`review.approve` at ALL). Nothing reaches
 *            the public page until they approve it.
 *
 * Permission alone does not answer "who may write": a platform role
 * holding `review.create` from a console would still have no company to
 * write for. So the write path also asks for an importer-domain role,
 * and the database's NOT NULL on importer_id says it a third time.
 */

function who(actor: Actor): string {
  return `${actor.session.firstName} ${actor.session.lastName}`.trim();
}

function auditBase(actor: Actor, meta: Meta) {
  return {
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: who(actor),
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  };
}

/** Quiet on failure — a stale page is not worth failing a save over. */
function dropPublicCache(): void {
  try {
    revalidateTag(PUBLIC_REVIEW_TAG);
  } catch (error) {
    console.error("[reviews] public cache not dropped", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The company an actor writes for, or a refusal. */
export function writerImporter(actor: Actor): number {
  const isWriterRole = actor.roles.some((r) => r.role === "IMPORTER" || r.role === "SALES_AGENT");
  const importerId = importerIdOf(actor);
  if (!isWriterRole || importerId === null || !grantFor(actor, "review.create")) {
    throw new InwardError("FORBIDDEN", "Only an importer or one of its sales agents can write a review.");
  }
  return importerId;
}

/** Platform moderation — `permission` at ALL scope, or a refusal. */
function requireModerator(actor: Actor, permission: "review.read" | "review.approve" | "review.delete"): void {
  if (grantFor(actor, permission)?.scope !== "ALL") {
    throw new InwardError("FORBIDDEN", "Reviews are moderated at platform level only.");
  }
}

// ── The writer's own review ───────────────────────────────────────

export type MyReview = {
  id: number;
  rating: number;
  body: string;
  showName: boolean;
  status: ReviewStatus;
  /** Why it was rejected or hidden — shown to the writer. */
  moderationNote: string | null;
  createdAt: string;
  updatedAt: string;
};

function myReviewOf(r: Record<string, unknown>): MyReview {
  return {
    id: Number(r.id),
    rating: Number(r.rating),
    body: String(r.body),
    showName: Boolean(r.show_name),
    status: String(r.status) as ReviewStatus,
    moderationNote: r.moderation_note === null ? null : String(r.moderation_note),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

const MINE_SELECT = sql`
  select id, rating, body, show_name, status, moderation_note,
         created_at::text as created_at, updated_at::text as updated_at
    from wms.review`;

export async function getMyReview(actor: Actor): Promise<MyReview | null> {
  writerImporter(actor);
  const rows = await getDb().execute<Record<string, unknown>>(sql`
    ${MINE_SELECT}
     where author_user_id = ${actor.session.userId} and deleted_at is null
  `);
  return rows[0] ? myReviewOf(rows[0]) : null;
}

/**
 * Write or rewrite the caller's review. Always lands as PENDING.
 *
 * An approved review that is edited leaves the public page until it is
 * approved again — otherwise "approved" would mean "approved once, then
 * anything".
 */
export async function saveMyReview(actor: Actor, input: ReviewInput, meta: Meta): Promise<MyReview> {
  const importerId = writerImporter(actor);
  const userId = actor.session.userId;
  const db = getDb();

  const before = await db.execute<Record<string, unknown>>(sql`
    ${MINE_SELECT}
     where author_user_id = ${userId} and deleted_at is null
  `);
  const previous = before[0] ? myReviewOf(before[0]) : null;

  let id: number;
  if (previous) {
    await db.execute(sql`
      update wms.review
         set rating = ${input.rating},
             body = ${input.body},
             show_name = ${input.showName},
             importer_id = ${importerId},
             status = 'PENDING',
             moderation_note = null,
             moderated_by = null,
             moderated_at = null
       where id = ${previous.id}
    `);
    id = previous.id;
  } else {
    try {
      const rows = await db.execute<{ id: number }>(sql`
        insert into wms.review (importer_id, author_user_id, rating, body, show_name)
        values (${importerId}, ${userId}, ${input.rating}, ${input.body}, ${input.showName})
        returning id
      `);
      id = Number(rows[0]!.id);
    } catch (error) {
      // Two tabs submitting at once: the unique index answers, not a 500.
      if (String((error as { code?: string })?.code ?? "") === "23505") {
        throw new InwardError("CONFLICT", "You have already written a review — reload to edit it.");
      }
      throw error;
    }
  }

  await auditQuietly({
    action: previous ? "review.updated" : "review.created",
    operation: previous ? "UPDATE" : "INSERT",
    entityType: "review",
    entityId: String(id),
    entityLabel: `${input.rating}★ review`,
    before: previous ? { rating: previous.rating, body: previous.body, showName: previous.showName, status: previous.status } : undefined,
    after: { importerId, rating: input.rating, body: input.body, showName: input.showName, status: "PENDING" },
    ...auditBase(actor, meta),
  });
  if (previous?.status === "APPROVED") dropPublicCache();

  const saved = await db.execute<Record<string, unknown>>(sql`${MINE_SELECT} where id = ${id}`);
  return myReviewOf(saved[0]!);
}

/** Withdraw the caller's review. Soft delete; they may write a new one. */
export async function withdrawMyReview(actor: Actor, meta: Meta): Promise<{ withdrawn: boolean }> {
  writerImporter(actor);
  const rows = await getDb().execute<{ id: number; status: string }>(sql`
    update wms.review
       set deleted_at = now(), deleted_by = ${actor.session.userId}
     where author_user_id = ${actor.session.userId} and deleted_at is null
     returning id, status
  `);
  const row = rows[0];
  if (!row) return { withdrawn: false };
  await auditQuietly({
    action: "review.withdrawn",
    operation: "DELETE",
    entityType: "review",
    entityId: String(row.id),
    reason: "Withdrawn by the writer",
    ...auditBase(actor, meta),
  });
  if (row.status === "APPROVED") dropPublicCache();
  return { withdrawn: true };
}

// ── Moderation ────────────────────────────────────────────────────

export type AdminReview = {
  id: number;
  rating: number;
  body: string;
  showName: boolean;
  status: ReviewStatus;
  moderationNote: string | null;
  moderatedAt: string | null;
  moderatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  author: { name: string; email: string; role: "Importer" | "Sales agent" };
  importer: { id: number; code: string; name: string; city: string | null };
};

export type ReviewCounts = Record<ReviewStatus, number>;

export async function listReviewsForAdmin(
  actor: Actor,
  status: ReviewStatus | null,
): Promise<{ items: AdminReview[]; counts: ReviewCounts }> {
  requireModerator(actor, "review.read");
  const db = getDb();
  const rows = await db.execute<Record<string, unknown>>(sql`
    select r.id, r.rating, r.body, r.show_name, r.status, r.moderation_note,
           r.moderated_at::text as moderated_at,
           r.created_at::text as created_at, r.updated_at::text as updated_at,
           trim(u.first_name || ' ' || u.last_name) as author_name,
           u.email::text as author_email,
           exists (select 1 from wms.user_role_assignment ur
                    where ur.user_id = u.id and ur.role = 'IMPORTER'
                      and ur.importer_id = r.importer_id
                      and ur.revoked_at is null) as author_is_owner,
           i.id as importer_id, i.code as importer_code,
           coalesce(nullif(i.trade_name, ''), i.company_name) as importer_name,
           c.name as city_name,
           trim(m.first_name || ' ' || m.last_name) as moderator_name
      from wms.review r
      join wms.users u on u.id = r.author_user_id
      join wms.importer i on i.id = r.importer_id
      left join wms.city c on c.id = i.city_id
      left join wms.users m on m.id = r.moderated_by
     where r.deleted_at is null
       and (${status}::text is null or r.status = ${status})
     order by case r.status when 'PENDING' then 0 else 1 end, r.updated_at desc
     limit 500
  `);
  const countRows = await db.execute<{ status: string; n: number }>(sql`
    select status, count(*)::int as n from wms.review where deleted_at is null group by status
  `);
  const counts: ReviewCounts = { PENDING: 0, APPROVED: 0, REJECTED: 0, HIDDEN: 0 };
  for (const c of countRows) counts[c.status as ReviewStatus] = Number(c.n);

  return {
    counts,
    items: rows.map((r) => ({
      id: Number(r.id),
      rating: Number(r.rating),
      body: String(r.body),
      showName: Boolean(r.show_name),
      status: String(r.status) as ReviewStatus,
      moderationNote: r.moderation_note === null ? null : String(r.moderation_note),
      moderatedAt: r.moderated_at === null ? null : String(r.moderated_at),
      moderatedBy: r.moderator_name === null ? null : String(r.moderator_name),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      author: {
        name: String(r.author_name),
        email: String(r.author_email),
        role: r.author_is_owner ? "Importer" : "Sales agent",
      },
      importer: {
        id: Number(r.importer_id),
        code: String(r.importer_code),
        name: String(r.importer_name),
        city: r.city_name === null ? null : String(r.city_name),
      },
    })),
  };
}

export async function decideReview(
  actor: Actor,
  id: number,
  input: DecisionInput,
  meta: Meta,
): Promise<{ id: number; status: ReviewStatus }> {
  requireModerator(actor, "review.approve");
  const status = STATUS_OF_DECISION[input.decision];
  const db = getDb();
  const before = await db.execute<{ status: string }>(sql`
    select status from wms.review where id = ${id} and deleted_at is null
  `);
  if (!before[0]) throw new InwardError("NOT_FOUND", "That review no longer exists.");

  await db.execute(sql`
    update wms.review
       set status = ${status},
           moderation_note = ${input.note},
           moderated_by = ${actor.session.userId},
           moderated_at = now()
     where id = ${id}
  `);
  await auditQuietly({
    action: `review.${input.decision.toLowerCase()}`,
    operation: input.decision === "APPROVE" ? "APPROVE" : input.decision === "REJECT" ? "REJECT" : "UPDATE",
    entityType: "review",
    entityId: String(id),
    before: { status: before[0].status },
    after: { status, note: input.note },
    ...auditBase(actor, meta),
  });
  if (before[0].status === "APPROVED" || status === "APPROVED") dropPublicCache();
  return { id, status };
}

export async function deleteReview(actor: Actor, id: number, meta: Meta): Promise<{ deleted: boolean }> {
  requireModerator(actor, "review.delete");
  const rows = await getDb().execute<{ status: string }>(sql`
    update wms.review
       set deleted_at = now(), deleted_by = ${actor.session.userId}
     where id = ${id} and deleted_at is null
     returning status
  `);
  if (!rows[0]) throw new InwardError("NOT_FOUND", "That review no longer exists.");
  await auditQuietly({
    action: "review.deleted",
    operation: "DELETE",
    entityType: "review",
    entityId: String(id),
    reason: "Deleted by a moderator",
    before: { status: rows[0].status },
    ...auditBase(actor, meta),
  });
  if (rows[0].status === "APPROVED") dropPublicCache();
  return { deleted: true };
}
