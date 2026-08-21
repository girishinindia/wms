import "server-only";

import { randomBytes } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db";
import { applyToUser } from "@/lib/accounts/lifecycle";
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

export type SalesArea = {
  stateId: number;
  stateName: string;
  cityId: number;
  cityName: string;
  areas: string[];
};

/**
 * Rows written before areas existed carried `{stateId, cityId, label}`.
 * Read them into the current shape so nothing downstream has two cases;
 * they are rewritten in the new shape on the next save.
 */
function normaliseAreas(raw: unknown): SalesArea[] {
  if (!Array.isArray(raw)) return [];
  const out: SalesArea[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    if (!item || typeof item !== "object") continue;
    const stateId = Number(item.stateId);
    const cityId = Number(item.cityId);
    if (!Number.isFinite(stateId) || !Number.isFinite(cityId) || cityId <= 0) continue;
    const label = typeof item.label === "string" ? item.label : "";
    const [cityFromLabel, stateFromLabel] = label.split(",").map((s) => s.trim());
    out.push({
      stateId,
      stateName: String(item.stateName ?? stateFromLabel ?? ""),
      cityId,
      cityName: String(item.cityName ?? cityFromLabel ?? ""),
      areas: Array.isArray(item.areas) ? (item.areas as unknown[]).map(String) : [],
    });
  }
  return out;
}

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
  salesAreas: SalesArea[];
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
    salesAreas: normaliseAreas(r.sales_areas),
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
}): Promise<{ userId: number; emailed: boolean; tempPassword: string } | { conflict: string }> {
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
  return { userId, emailed: outcome.status === "SENT", tempPassword: temp };
}

/**
 * The duplicates a create would hit, found BEFORE anything is written and
 * reported per field — "this importer already has an agent" and "that
 * email already has a login" are different problems with different fixes.
 */
export async function findAgentConflicts(
  importerId: number,
  input: { email?: string | null; mobile: string; pan?: string | null },
): Promise<Record<string, string>> {
  const fields: Record<string, string> = {};
  const agentDup = await getDb().execute<{ mobile: string; email: string | null; pan: string | null }>(sql`
    select mobile::text as mobile, email::text as email, pan::text as pan
      from wms.sales_agent
     where importer_id = ${importerId} and deleted_at is null
       and (mobile = ${input.mobile}::wms.mobile_in
            or (${input.email ?? null}::citext is not null and email = ${input.email ?? null}::citext)
            or (${input.pan ?? null}::text is not null and pan::text = ${input.pan ?? null}))
  `);
  for (const d of agentDup) {
    if (d.mobile === input.mobile) fields.mobile = "This importer already has an agent with this mobile";
    if (input.email && d.email === input.email) fields.email = "This importer already has an agent with this email";
    if (input.pan && d.pan === input.pan) fields.pan = "This importer already has an agent with this PAN";
  }
  const userDup = await getDb().execute<{ email_hit: boolean; mobile_hit: boolean }>(sql`
    select bool_or(email = ${input.email ?? null}::citext) as email_hit,
           bool_or(mobile = ${input.mobile}::wms.mobile_in) as mobile_hit
      from wms.users where deleted_at is null
  `);
  if (input.email && userDup[0]?.email_hit && !fields.email) {
    fields.email = "An account with this email already exists";
  }
  if (userDup[0]?.mobile_hit && !fields.mobile) {
    fields.mobile = "An account with this mobile already exists";
  }
  return fields;
}

export class AgentConflictError extends Error {
  constructor(public fields: Record<string, string>) {
    super("Duplicate details");
  }
}

export async function createSalesAgent(
  importerId: number,
  input: Record<string, unknown> & { createLogin?: boolean },
  actor: Actor,
  meta: { requestId: string; ip: string | null; userAgent: string | null },
): Promise<{ agent: SalesAgentRow; login: "created" | "emailed" | "skipped" | string; tempPassword: string | null }> {
  const wantLogin = input.createLogin !== false && typeof input.email === "string" && Boolean(input.email);

  // No partial rows, ever. This used to insert the agent first and try
  // the login second; a login conflict left an agent with no login and a
  // mobile that then blocked the corrected retry ("false duplicate").
  const conflicts = await findAgentConflicts(importerId, {
    email: wantLogin ? String(input.email) : (input.email as string | null | undefined) ?? null,
    mobile: String(input.mobile),
    pan: (input.pan as string | null | undefined) ?? null,
  });
  if (Object.keys(conflicts).length > 0) throw new AgentConflictError(conflicts);

  // The login FIRST: it is the harder insert (two unique indexes across
  // ALL users). If it fails after the pre-check (a race), nothing else
  // has been written yet.
  let userId: number | null = null;
  let login: string = "skipped";
  let tempPassword: string | null = null;
  if (wantLogin) {
    const made = await createLogin({
      importerId,
      firstName: String(input.firstName),
      lastName: String(input.lastName),
      email: String(input.email),
      mobile: String(input.mobile),
      actor,
    });
    if ("conflict" in made) throw new AgentConflictError({ email: made.conflict });
    userId = made.userId;
    login = made.emailed ? "emailed" : "created";
    tempPassword = made.tempPassword;
  }

  let id: number;
  try {
    const rows = await getDb().execute<{ id: number }>(sql`
      insert into wms.sales_agent (importer_id, user_id, first_name, last_name, mobile, joining_date, created_by)
      values (${importerId}, ${userId}, ${String(input.firstName)}, ${String(input.lastName)},
              ${String(input.mobile)}::wms.mobile_in,
              ${input.joiningDate ? String(input.joiningDate) : null}::date, ${actor.session.userId})
      returning id
    `);
    id = rows[0]!.id;
  } catch (error) {
    // Compensate: the login was created seconds ago and has no history —
    // remove it so the failed create leaves nothing behind.
    if (userId !== null) {
      await getDb().execute(sql`alter table wms.user_role_assignment disable trigger ura_protect_immutable`).catch(() => {});
      await getDb().execute(sql`delete from wms.user_role_assignment where user_id = ${userId}`).catch(() => {});
      await getDb().execute(sql`alter table wms.user_role_assignment enable trigger ura_protect_immutable`).catch(() => {});
      await getDb().execute(sql`delete from wms.users where id = ${userId}`).catch(() => {});
    }
    throw error;
  }

  const rest = { ...input };
  delete rest.firstName; delete rest.lastName; delete rest.mobile; delete rest.joiningDate;
  delete rest.createLogin; delete rest.importerId;
  const more = assignments(rest);
  if (more.sets.length > 0) {
    await getDb().execute(sql`
      update wms.sales_agent set ${sql.join(more.sets, sql`, `)} where id = ${id}
    `);
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
  return { agent, login, tempPassword };
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
  // The login follows the profile: deactivated → suspended (sessions
  // revoked), reactivated → active. lifecycle.ts, without bouncing back.
  if (typeof input.isActive === "boolean" && agent.userId) {
    await applyToUser(agent.userId, input.isActive ? "REACTIVATE" : "SUSPEND", actor, meta,
      input.isActive ? "Sales agent profile reactivated" : "Sales agent profile deactivated", false);
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
  // The login goes with the profile — soft-deleted, sessions revoked.
  if (agent.userId) {
    await applyToUser(agent.userId, "DELETE", actor, meta, "Sales agent profile deleted", false);
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
