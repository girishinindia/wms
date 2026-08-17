import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { getDb } from "@/db";
import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { auditQuietly } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { createCitiesRequestSchema } from "@/lib/validation/api-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/admin/cities — add cities to a state.
 *
 * Takes a list rather than one name. `wms.city` ships empty, and nothing
 * carrying an address — an importer, a warehouse, a transporter — can be
 * created until it is populated. So the first use of this endpoint is
 * always "paste in thirty cities", never "add one", and a one-at-a-time
 * modal is the kind of task people abandon halfway, leaving a
 * half-populated master table that looks finished.
 *
 * `on conflict do nothing` against the `(state_id, name)` unique index,
 * so a pasted list that overlaps what is already there skips the
 * duplicates instead of failing and discarding the whole batch. The
 * response names what was skipped: quietly accepting a list of thirty
 * and creating twenty-eight rows is how a missing city becomes a mystery
 * three weeks later.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor } = await requirePermission("master.city.create", {
        entityType: "master.city",
      });

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      }

      const parsed = createCitiesRequestSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const { stateId, names } = parsed.data;

      // Duplicates inside the pasted list, collapsed case-insensitively —
      // otherwise "Thane" and "thane" both reach the unique index and one
      // of them is reported as a conflict against the other.
      const unique: string[] = [];
      const seen = new Set<string>();
      for (const raw of names) {
        const key = raw.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(raw);
      }

      const state = await getDb().execute<{ id: number; name: string }>(sql`
        select id, name from wms.state where id = ${stateId} and deleted_at is null
      `);
      if (state.length === 0) {
        return fail("NOT_FOUND", "That state does not exist", requestId, {
          fields: { stateId: "Choose a state" },
        });
      }

      /**
       * A VALUES list, not `unnest($1::text[])`.
       *
       * postgres.js expands a JavaScript array into a comma-separated
       * parameter LIST — `($3,$4,$5,$6)` — rather than binding one array
       * parameter, so the cast lands on a record and Postgres refuses
       * with "cannot cast type record to text[]". Every name is still a
       * bound parameter here; only the number of them is interpolated.
       */
      const values = sql.join(
        unique.map((n) => sql`(${n})`),
        sql`, `,
      );

      const inserted = await getDb().execute<{ id: number; name: string }>(sql`
        insert into wms.city (state_id, name, created_by)
        select ${stateId}, trim(v.name), ${actor.session.userId}
          from (values ${values}) as v(name)
        on conflict do nothing
        returning id, name
      `);

      const created = inserted.map((r) => r.name.toLowerCase());
      const skipped = unique.filter((n) => !created.includes(n.trim().toLowerCase()));

      if (inserted.length > 0) {
        await auditQuietly({
          action: "master.city.created",
          operation: "INSERT",
          entityType: "master.city",
          entityId: String(stateId),
          entityLabel: state[0]?.name ?? null,
          actorUserId: actor.session.userId,
          actorEmail: actor.session.email,
          actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
          after: { stateId, names: inserted.map((r) => r.name) },
          ip: clientIp(request.headers),
          userAgent: request.headers.get("user-agent"),
          requestId,
          metadata: { created: inserted.length, skipped: skipped.length },
        });
      }

      return ok({ created: inserted.length, skipped }, requestId, 201);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
