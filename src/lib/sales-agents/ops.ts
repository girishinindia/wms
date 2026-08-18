import "server-only";

import { randomBytes } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db";
import { auditQuietly } from "@/lib/audit";
import type { Actor } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { sendEmail } from "@/lib/notify/email";
import { absoluteUrl } from "@/lib/url";

/**
 * Sales agents: an importer's field people. Profile in `wms.sales_agent`,
 * login (optional) as a `users` row with the SALES_AGENT role bound to
 * the same importer — which is what the role, the exclusivity trigger
 * and the creation rule IMPORTER → SALES_AGENT @ SAME_IMPORTER exist for.
 *
 * Every function here takes the importer id from the caller, who has
 * already resolved it from the actor's role (OWN) or the request (ALL).
 * Nothing in this module trusts an importer id from a body.
 */

export type SalesAgentRow = {
  id: number;
  code: string;
  importerId: number;
  importerName: string;
  userId: number | null;
  firstName: string;
  lastName: string;
  email: string | null;
  mobile: string;
  birthDate: string | null;
  joiningDate: string;
  pan: string | null;
  address: string | null;
  landmark: string | null;
  area: string | null;
  cityId: number | null;
  cityLabel: string | null;
  pincode: string | null;
  salesAreas: { stateId: number; cityId?: number | null; label: string }[];
  status: string;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

const SELECT = sql`
  select a.id, a.code, a.importer_id, i.company_name as importer_name, a.user_id,
         a.first_name, a.last_name, a.email::text as email, a.mobile::text as mobile,
         a.birth_date::text as birth_date, a.joining_date::text as joining_date,
         a.pan::text as pan, a.address, a.landmark, a.area, a.city_id,
         c.name as city_label, a.pincode::text as pincode, a.sales_areas,
         a.status::text as status, a.is_active, a.notes,
         a.created_at::text as created_at, a.updated_at::text as updated_at
    from wms.sales_agent a
    join wms.importer i on i.id = a.importer_id
    left join wms.city c on c.id = a.city_id`;

function map(r: Record<string, unknown>): SalesAgentRow {
  return {
    id: Number(r.id),
    code: String(r.code),
    importerId: Number(r.importer_id),
    importerName: String(r.importer_name),
    userId: r.user_id === null ? null : Number(r.user_id),
    firstName: String(r.first_name),
    lastName: String(r.last_name),
    email: (r.email as string | null) ?? null,
    mobile: String(r.mobile),
    birthDate: (r.birth_date as string | null) ?? null,
    joiningDate: String(r.joining_date),
    pan: (r.pan as string | null) ?? null,
    address: (r.address as string | null) ?? null,
    landmark: (r.landmark as string | null) ?? null,
    area: (r.area as string | null) ?? null,
    cityId: r.city_id === null ? null : Number(r.city_id),
    cityLabel: (r.city_label as string | null) ?? null,
    pincode: (r.pincode as string | null) ?? null,
    salesAreas: Array.isArray(r.sales_areas) ? (r.sales_areas as SalesAgentRow["salesAreas"]) : [],
    status: String(r.status),
    isActive: Boolean(r.is_active),
    notes: (r.notes as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export async function loadSalesAgent(id: number): Promise<SalesAgentRow | null> {
  const rows = await getDb().execute<Record<string, unknown>>(
    sql`${SELECT} where a.id = ${id} and a.deleted_at is null`,
  );
  return rows[0] ? map(rows[0]) : null;
}

export async function listSalesAgents(where: SQL): Promise<SalesAgentRow[]> {
  const rows = await getDb().execute<Record<string, unknown>>(
    sql`${SELECT} where a.deleted_at is null and ${where} order by a.is_active desc, a.first_name, a.last_name`,
  );
  return rows.map(map);
}

const COLUMNS: Record<string, { column: string; cast?: string; json?: boolean }> = {
  firstName: { column: "first_name" },
  lastName: { column: "last_name" },
  email: { column: "email", cast: "::citext" },
  mobile: { column: "mobile", cast: "::wms.mobile_in" },
  birthDate: { column: "birth_date", cast: "::date" },
  joiningDate: { column: "joining_date", cast: "::date" },
  pan: { column: "pan", cast: "::wms.pan_no" },
  address: { column: "address" },
  landmark: { column: "landmark" },
  area: { column: "area" },
  cityId: { column: "city_id" },
  pincode: { column: "pincode", cast: "::wms.pincode_in" },
  salesAreas: { column: "sales_areas", cast: "::jsonb", json: true },
  notes: { column: "notes" },
  isActive: { column: "is_active" },
  status: { column: "status", cast: "::wms.record_status" },
};

function assignments(input: Record<string, unknown>): { sets: SQL[]; touched: string[] } {
  const sets: SQL[] = [];
  const touched: string[] = [];
  for (const [key, def] of Object.entries(COLUMNS)) {
    if (!(key in input)) continue;
    const raw = input[key];
    const value = def.json ? JSON.stringify(raw ?? []) : (raw ?? null);
    touched.push(key);
    sets.push(
      def.cast
        ? sql`${sql.raw(def.column)} = ${value}${sql.raw(def.cast)}`
        : sql`${sql.raw(def.column)} = ${value}`,
    );
  }
  return { sets, touched };
}

/**
 * A login for the agent: a users row (ACTIVE, verified — the importer
 * vouches for them) with a one-time password they must change, and the
 * SALES_AGENT role bound to the importer. The password goes to the
 * agent by email and nowhere else; it is not stored anywhere readable.
 */
async function createLogin(params: {
  importerId: number;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  actor: Actor;
}): Promise<{ userId: number; emailed: boolean } | { conflict: string }> {
  const temp = randomBytes(9).toString("base64url"); // 12 chars, url-safe
  const hash = await hashPassword(temp);
  const rows = await getDb().execute<{ id: number }>(sql`
    with new_user as (
      insert into wms.users
        (email, first_name, last_name, mobile, password_hash, password_changed_at,
         email_verified_at, mobile_verified_at, status, must_change_password, created_by)
      select ${params.email}::citext, ${params.firstName}, ${params.lastName},
             ${params.mobile}::wms.mobile_in, ${hash}, now(), now(), now(), 'ACTIVE', true,
             ${params.actor.session.userId}
       where not exists (
         select 1 from wms.users
          where deleted_at is null
            and (email = ${params.email}::citext or mobile = ${params.mobile}::wms.mobile_in)
       )
      returning id
    ),
    bound as (
      insert into wms.user_role_assignment
        (user_id, role, role_domain, importer_id, assigned_by, note)
      select id, 'SALES_AGENT', 'IMPORTER', ${params.importerId}, ${params.actor.session.userId},
             'Created with the sales agent profile'
        from new_user
      returning user_id
    )
    select id from new_user
  `);
  const userId = rows[0]?.id;
  if (!userId) return { conflict: "An account with that email or mobile already exists" };

  const outcome = await sendEmail({
    toEmail: params.email,
    toName: `${params.firstName} ${params.lastName}`,
    subject: "Your Genius WMS sales agent login",
    message:
      `You have been added as a sales agent.\n\n` +
      `Sign in with this email address and the temporary password below, then set your own.\n\n` +
      `Temporary password: ${temp}\n\n` +
      `If you were not expecting this, ignore this message.`,
    actionUrl: absoluteUrl("/sign-in"),
    actionLabel: "Sign in",
  });
  return { userId, emailed: outcome.status === "SENT" };
}

export async function createSalesAgent(
  importerId: number,
  input: Record<string, unknown> & { createLogin?: boolean },
  actor: Actor,
  meta: { requestId: string; ip: string | null; userAgent: string | null },
): Promise<{ agent: SalesAgentRow; login: "created" | "emailed" | "skipped" | string }> {
  // Insert the mandatory columns, then apply the rest through the same
  // column map an update uses. Two statements, one row, one audit.
  const rows = await getDb().execute<{ id: number }>(sql`
    insert into wms.sales_agent (importer_id, first_name, last_name, mobile, joining_date, created_by)
    values (${importerId}, ${String(input.firstName)}, ${String(input.lastName)},
            ${String(input.mobile)}::wms.mobile_in,
            ${input.joiningDate ? String(input.joiningDate) : null}::date, ${actor.session.userId})
    returning id
  `);
  const id = rows[0]!.id;
  const rest = { ...input };
  delete rest.firstName; delete rest.lastName; delete rest.mobile; delete rest.joiningDate;
  delete rest.createLogin; delete rest.importerId;
  const more = assignments(rest);
  if (more.sets.length > 0) {
    await getDb().execute(sql`
      update wms.sales_agent set ${sql.join(more.sets, sql`, `)} where id = ${id}
    `);
  }

  let login: string = "skipped";
  if (input.createLogin !== false && typeof input.email === "string" && input.email) {
    const made = await createLogin({
      importerId,
      firstName: String(input.firstName),
      lastName: String(input.lastName),
      email: input.email,
      mobile: String(input.mobile),
      actor,
    });
    if ("conflict" in made) {
      login = made.conflict;
    } else {
      await getDb().execute(sql`update wms.sales_agent set user_id = ${made.userId} where id = ${id}`);
      login = made.emailed ? "emailed" : "created";
    }
  }

  const agent = (await loadSalesAgent(id))!;
  await auditQuietly({
    action: "sales_agent.created",
    operation: "INSERT",
    entityType: "sales_agent",
    entityId: String(id),
    entityLabel: `${agent.firstName} ${agent.lastName}`,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    after: { ...input, importerId, login },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
  return { agent, login };
}

export async function updateSalesAgent(
  agent: SalesAgentRow,
  input: Record<string, unknown>,
  actor: Actor,
  meta: { requestId: string; ip: string | null; userAgent: string | null },
): Promise<SalesAgentRow> {
  // The switch and the status column say the same thing: deactivating
  // suspends, reactivating restores — unless a status was named.
  if (typeof input.isActive === "boolean" && input.status === undefined) {
    input = { ...input, status: input.isActive ? "ACTIVE" : "SUSPENDED" };
  }
  const { sets, touched } = assignments(input);
  if (sets.length === 0) return agent;
  sets.push(sql`updated_by = ${actor.session.userId}`);
  await getDb().execute(sql`
    update wms.sales_agent set ${sql.join(sets, sql`, `)}
     where id = ${agent.id} and deleted_at is null
  `);
  // A deactivated agent should not keep signing in.
  if (input.isActive === false && agent.userId) {
    await getDb().execute(sql`
      update wms.user_session set revoked_at = now() where user_id = ${agent.userId} and revoked_at is null
    `);
  }
  const after = (await loadSalesAgent(agent.id))!;
  await auditQuietly({
    action: "sales_agent.updated",
    operation: "UPDATE",
    entityType: "sales_agent",
    entityId: String(agent.id),
    entityLabel: `${agent.firstName} ${agent.lastName}`,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    before: Object.fromEntries(touched.map((k) => [k, (agent as unknown as Record<string, unknown>)[k] ?? null])),
    after: Object.fromEntries(touched.map((k) => [k, input[k] ?? null])),
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
  return after;
}

/**
 * Soft delete — the row keeps its code and history, the login is
 * deactivated. Soft rather than hard because `sales_agent_client`
 * assignments and dispatch history point at the agent's user, and the
 * unique keys here are partial on deleted_at, so a re-added agent with
 * the same mobile does not collide.
 */
export async function deleteSalesAgent(
  agent: SalesAgentRow,
  actor: Actor,
  meta: { requestId: string; ip: string | null; userAgent: string | null },
): Promise<void> {
  await getDb().execute(sql`
    update wms.sales_agent
       set deleted_at = now(), deleted_by = ${actor.session.userId}, is_active = false
     where id = ${agent.id} and deleted_at is null
  `);
  if (agent.userId) {
    await getDb().execute(sql`
      update wms.users set status = 'SUSPENDED', deactivated_at = now(),
             deactivated_by = ${actor.session.userId},
             deactivation_reason = 'Sales agent profile deleted'
       where id = ${agent.userId} and deleted_at is null
    `);
    await getDb().execute(sql`
      update wms.user_session set revoked_at = now() where user_id = ${agent.userId} and revoked_at is null
    `);
  }
  await auditQuietly({
    action: "sales_agent.deleted",
    operation: "DELETE",
    entityType: "sales_agent",
    entityId: String(agent.id),
    entityLabel: `${agent.firstName} ${agent.lastName}`,
    actorUserId: actor.session.userId,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    before: agent as unknown as Record<string, unknown>,
    reason: "Deleted from the sales agents screen",
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
}
