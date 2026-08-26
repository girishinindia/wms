import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { getDb } from "@/db";
import { fail, handler, ok, toResponse } from "@/lib/api/respond";
import { auditQuietly } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { readThread, sendReply } from "@/lib/enquiry/reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  // Matches `enquiry_reply_body_len` on the table, so a value the form
  // accepts cannot then be refused by the column with a 500.
  body: z.string().trim().min(2, "Write something first").max(5000, "That is too long to send"),
});

/** Digits only, and short enough that no bigint can overflow the cast. */
function enquiryId(raw: string): number | null {
  if (!/^\d{1,19}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * The enquiry, if it exists and has not been removed from the list.
 *
 * Loaded rather than trusted from the request: the subject and message
 * quoted back to the sender come from the row, so a caller cannot use
 * this route to send arbitrary text to an arbitrary address over the
 * company's name.
 */
async function loadEnquiry(id: number) {
  const [row] = await getDb().execute<{
    id: number; name: string; email: string; subject: string; message: string;
  }>(sql`
    select id, name, email::text as email, subject, message
      from wms.enquiry
     where id = ${id} and deleted_at is null`);
  return row ?? null;
}

/** GET — the thread on one enquiry. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handler(async ({ requestId }) => {
    try {
      const { grant } = await requirePermission("enquiry.read", { entityType: "enquiry" });
      if (grant.scope !== "ALL") {
        return fail("FORBIDDEN", "Enquiries are visible at platform level only.", requestId);
      }

      const id = enquiryId((await context.params).id);
      if (id === null) return fail("VALIDATION_FAILED", "Bad enquiry id", requestId);

      return ok({ replies: await readThread(id) }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}

/**
 * POST — answer the enquirer by email, and keep the answer.
 *
 * `enquiry.update` rather than a permission of its own. That was the
 * plan and the schema overruled it: `permission_action_check` closes
 * the verb set at seven, and `RoleMatrix` draws a column per verb across
 * every resource — an eighth verb for one resource would add an empty
 * column to twenty-nine rows. Replying is acting on an enquiry, and the
 * resource is granted to SUPER_ADMIN alone regardless.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handler(async ({ requestId }) => {
    try {
      const { actor, grant } = await requirePermission("enquiry.update", {
        entityType: "enquiry",
      });
      if (grant.scope !== "ALL") {
        return fail("FORBIDDEN", "Enquiries are visible at platform level only.", requestId);
      }

      const id = enquiryId((await context.params).id);
      if (id === null) return fail("VALIDATION_FAILED", "Bad enquiry id", requestId);

      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      }
      const parsed = bodySchema.safeParse(raw);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: { body: parsed.error.issues[0]?.message ?? "Write something first" },
        });
      }

      const enquiry = await loadEnquiry(id);
      if (!enquiry) return fail("NOT_FOUND", "That enquiry is no longer here.", requestId);

      const result = await sendReply({
        enquiry: {
          id: Number(enquiry.id),
          name: enquiry.name,
          email: enquiry.email,
          subject: enquiry.subject,
          message: enquiry.message,
        },
        body: parsed.data.body,
        actorUserId: actor.session.userId,
      });

      /**
       * Audited with the ADDRESS and the outcome, not the reply text.
       *
       * Who was written to and whether it left is the accountability
       * question. The words are on the enquiry screen, which is where
       * they belong and where they can be removed; copying them into an
       * append-only table would put the same correspondence in two
       * places with different rules.
       */
      await auditQuietly({
        action: "enquiry.replied", operation: "INSERT", entityType: "enquiry",
        entityId: String(id),
        result: result.status === "SENT" ? "SUCCESS" : "FAILED",
        reason: result.error,
        actorUserId: actor.session.userId,
        actorEmail: actor.session.email,
        actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
        ip: clientIp(request.headers), userAgent: request.headers.get("user-agent"),
        requestId,
        after: { to: enquiry.email, status: result.status, replyId: result.id },
      });

      /**
       * 200 even when the provider refused.
       *
       * The reply WAS recorded — that is what the response reports. The
       * status field is how the screen knows whether to show a tick or
       * a warning, and a 500 here would suggest nothing was saved and
       * invite the user to retype it.
       */
      return ok({ id: result.id, status: result.status, error: result.error }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
