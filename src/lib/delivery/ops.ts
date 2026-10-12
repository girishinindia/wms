import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db";
import { auditQuietly } from "@/lib/audit";
import { grantFor, importerIdOf, type Actor, type Grant } from "@/lib/auth/guard";
import { afterStep, pickingStarted, progressOf, releaseNote } from "@/lib/dispatch/ops";
import { InwardError, type Meta } from "@/lib/inward/ops";
import { normalizeMobile } from "@/lib/normalize";
import { announce } from "@/lib/notify/announce";
import { isAgentOnly } from "@/lib/sales-agents/scope";

import { HANDLING, PACKING } from "./labels";

export { HANDLING, HANDLING_LABEL, PACKING, PACKING_LABEL } from "./labels";

/**
 * Delivery notes (DN / DO): a sales agent — or the importer — sends the
 * importer's goods to a buyer.
 *
 *   draft      the form being filled. Every item added HOLDS its cartons
 *              for 15 minutes (counted against free stock for everyone
 *              else). Not submitted in time: cancelled, cartons free again.
 *   submit     one delivery note per warehouse, numbered from the
 *              importer's series ("/26-27/13888"), all sharing one order
 *              number ("E/26-27/13258").
 *   approval   the importer approves or rejects. A super admin or a
 *              warehouse admin may too, but only after asking the importer
 *              and saying how and whom. A trusted sales agent's notes are
 *              approved on submit. The importer's own notes are approved.
 *   rejected   final; the cartons are free again. A new note is needed.
 *   edit       only the sales agent who made it, or the importer. The
 *              agent's edit needs approval again (a trusted agent's is
 *              approved again); the importer's own edit is approval.
 *
 * Stock is counted in the database (dn_free / dn_stock), and every change
 * that takes stock runs in a function that locks the item first — see
 * sql/38_delivery_notes.sql.
 */

export const HOLD_SECONDS = 15 * 60;

// ── Small helpers ─────────────────────────────────────────────────

/** India's financial year ("26-27", April to March) and today's date. */
export function fyOf(now: Date = new Date()): { fy: string; today: string } {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  const two = (n: number) => String(n % 100).padStart(2, "0");
  return { fy: `${two(start)}-${two(start + 1)}`, today: ist.toISOString().slice(0, 10) };
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const clean = (v: unknown, max = 500): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+\n/g, "\n").trim();
  return t ? t.slice(0, max) : null;
};

export const PAYMENT_MODES = ["Account", "Cash", "UPI", "Credit", "Cheque", "Bank transfer"] as const;
export const CONFIRM_METHODS = ["PHONE", "IN_PERSON", "WHATSAPP", "EMAIL", "OTHER"] as const;
export const CONFIRM_LABEL: Record<string, string> = {
  PHONE: "Phone call",
  IN_PERSON: "In person",
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  OTHER: "Other",
};
export const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};
export const KIND_LABEL: Record<string, string> = {
  IMPORTER: "Approved by the importer",
  IMPORTER_EDIT: "Changed and approved by the importer",
  IMPORTER_CREATED: "Created by the importer",
  AUTO: "Auto-approved — trusted sales agent",
  CONFIRMED: "Approved after confirming with the importer",
};

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

/** The importer this actor makes delivery notes for, or a refusal. */
function creatorImporter(actor: Actor): number {
  if (!grantFor(actor, "dispatch.order.create")) {
    throw new InwardError("FORBIDDEN", "You do not have permission to do that.");
  }
  const importerId = importerIdOf(actor);
  if (importerId === null) {
    throw new InwardError("FORBIDDEN", "Delivery notes are made by the importer or their sales agents.");
  }
  return importerId;
}

/** True when the actor owns the company (IMPORTER role for it). */
function isImporterOf(actor: Actor, importerId: number): boolean {
  return actor.roles.some((r) => r.role === "IMPORTER" && r.importerId === importerId);
}

// ── Who sees which notes ──────────────────────────────────────────

export type DnScope =
  | { kind: "all"; importerId: number | null }
  | { kind: "warehouse"; warehouseIds: number[] }
  | { kind: "importer"; importerId: number }
  | { kind: "agent"; importerId: number; userId: number };

export function dnScope(actor: Actor, grant: Grant, requestedImporter: number | null = null): DnScope {
  if (grant.scope === "ALL") return { kind: "all", importerId: requestedImporter };
  if (grant.scope === "WAREHOUSE") return { kind: "warehouse", warehouseIds: grant.warehouseIds };
  const importerId = importerIdOf(actor);
  if (importerId === null) throw new InwardError("FORBIDDEN", "You are not linked to an importer");
  if (isAgentOnly(actor)) return { kind: "agent", importerId, userId: actor.session.userId };
  return { kind: "importer", importerId };
}

/** The WHERE for `delivery_note n` — the list and the by-id read agree. */
export function dnWhere(scope: DnScope): SQL {
  switch (scope.kind) {
    case "all":
      return scope.importerId === null ? sql`true` : sql`n.importer_id = ${scope.importerId}`;
    case "warehouse":
      return scope.warehouseIds.length
        ? sql`n.warehouse_id in (${sql.join(scope.warehouseIds.map((w) => sql`${w}`), sql`, `)})`
        : sql`false`;
    case "importer":
      return sql`n.importer_id = ${scope.importerId}`;
    case "agent":
      return sql`n.importer_id = ${scope.importerId} and n.created_by = ${scope.userId}`;
  }
}

// ── Stock ─────────────────────────────────────────────────────────

export type StockRow = {
  warehouseId: number;
  warehouseCode: string;
  warehouseName: string;
  key: string;
  itemId: number | null;
  itemCode: string | null;
  description: string;
  piecesPerCarton: number;
  unitCode: string | null;
  kgPerCarton: number | null;
  thumbUrl: string | null;
  received: number;
  /** Held in other people's drafts, and promised on pending / approved notes. */
  held: number;
  inNotes: number;
  /** In this draft. */
  mine: number;
  /** What can still be added to this draft (free for everyone else + what is already mine). */
  available: number;
};

export async function stockFor(actor: Actor, draftId: number | null): Promise<StockRow[]> {
  const importerId = creatorImporter(actor);
  const rows = await getDb().execute<Record<string, unknown>>(sql`
    select s.*, w.code as warehouse_code, w.name as warehouse_name
      from wms.dn_stock(${importerId}, ${draftId}) s
      join wms.warehouse w on w.id = s.warehouse_id
     order by w.name, s.description
  `);
  return rows.map((r) => {
    const free = Number(r.free);
    const mine = Number(r.mine);
    return {
      warehouseId: Number(r.warehouse_id),
      warehouseCode: String(r.warehouse_code),
      warehouseName: String(r.warehouse_name),
      key: String(r.stock_key),
      itemId: num(r.item_id),
      itemCode: (r.item_code as string | null) ?? null,
      description: String(r.description),
      piecesPerCarton: Number(r.pieces_per_carton),
      unitCode: (r.unit_code as string | null) ?? null,
      kgPerCarton: num(r.kg_per_carton),
      thumbUrl: (r.image_thumb_url as string | null) ?? null,
      received: Number(r.received),
      held: Number(r.held),
      inNotes: Number(r.in_notes),
      mine,
      // `free` already left out this draft's own hold; it is what is
      // not taken by anyone, so mine can grow up to free (it is part of
      // nobody else's count).
      available: Math.max(0, free),
    };
  });
}

// ── Buyers (the importer's clients) ───────────────────────────────

export type Client = {
  id: number;
  name: string;
  mobile: string | null;
  address: string | null;
  gstin: string | null;
  city: string | null;
  cityId: number | null;
  state: string | null;
  pincode: string | null;
};

const CLIENT_SELECT = sql`
  select c.id, c.name, c.contact_mobile::text as mobile, c.address, c.gstin::text as gstin, c.city_id, ci.name as city,
         st.name as state, c.pincode::text as pincode
    from wms.importer_client c
    left join wms.city ci on ci.id = c.city_id
    left join wms.state st on st.id = ci.state_id`;

function clientOf(r: Record<string, unknown>): Client {
  return {
    id: Number(r.id),
    name: String(r.name),
    mobile: (r.mobile as string | null)?.trim() ?? null,
    address: (r.address as string | null) ?? null,
    gstin: (r.gstin as string | null)?.trim() ?? null,
    city: (r.city as string | null) ?? null,
    cityId: num(r.city_id),
    state: (r.state as string | null) ?? null,
    pincode: (r.pincode as string | null)?.trim() ?? null,
  };
}

/** The importer's clients. An agent with clients assigned sees those; with none assigned, all. */
export async function listClients(actor: Actor, q: string): Promise<Client[]> {
  const importerId = creatorImporter(actor);
  const db = getDb();
  let narrow = sql`true`;
  if (isAgentOnly(actor)) {
    const mine = await db.execute<{ n: string }>(sql`
      select count(*)::text as n from wms.sales_agent_client
       where agent_user_id = ${actor.session.userId} and revoked_at is null
    `);
    if (Number(mine[0]?.n ?? 0) > 0) {
      narrow = sql`(c.created_by = ${actor.session.userId} or exists (
        select 1 from wms.sales_agent_client a
         where a.client_id = c.id and a.agent_user_id = ${actor.session.userId} and a.revoked_at is null))`;
    }
  }
  const like = `%${q.trim().toLowerCase()}%`;
  const rows = await db.execute<Record<string, unknown>>(sql`
    ${CLIENT_SELECT}
     where c.importer_id = ${importerId} and c.deleted_at is null and c.status = 'ACTIVE' and ${narrow}
       and (${q.trim() === ""} or lower(c.name) like ${like} or c.contact_mobile::text like ${like})
     order by c.name
     limit 50
  `);
  return rows.map(clientOf);
}

export type ClientInput = {
  name: string;
  mobile: string;
  address?: string | null;
  gstin?: string | null;
  pincode?: string | null;
  cityId?: number | null;
};

export async function createClient(actor: Actor, input: ClientInput, meta: Meta): Promise<Client> {
  const importerId = creatorImporter(actor);
  const name = clean(input.name, 120);
  if (!name) throw new InwardError("VALIDATION_FAILED", "Enter the buyer's name", { name: "Enter the buyer's name" });
  const mobile = normalizeMobile(input.mobile ?? "");
  if (!/^[6-9][0-9]{9}$/.test(mobile)) {
    throw new InwardError("VALIDATION_FAILED", "Enter a 10-digit mobile number", { mobile: "Enter a 10-digit mobile number" });
  }
  const gstin = clean(input.gstin, 15)?.toUpperCase() ?? null;
  if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
    throw new InwardError("VALIDATION_FAILED", "That GSTIN does not look right", { gstin: "That GSTIN does not look right" });
  }
  const pincode = clean(input.pincode, 6);
  if (pincode && !/^[1-9][0-9]{5}$/.test(pincode)) {
    throw new InwardError("VALIDATION_FAILED", "Pincode is 6 digits", { pincode: "Pincode is 6 digits" });
  }
  let cityId: number | null = null;
  if (input.cityId) {
    const city = await getDb().execute<{ id: number }>(sql`
      select id from wms.city where id = ${input.cityId} and deleted_at is null and is_active
    `);
    if (!city[0]) throw new InwardError("VALIDATION_FAILED", "Choose the city from the list", { cityId: "Choose the city from the list" });
    cityId = Number(city[0].id);
  }
  const dup = await getDb().execute<{ id: number }>(sql`
    select id from wms.importer_client
     where importer_id = ${importerId} and deleted_at is null and contact_mobile = ${mobile} and lower(name) = lower(${name})
  `);
  if (dup[0]) throw new InwardError("CONFLICT", `${name} is already a client`);
  const rows = await getDb().execute<{ id: number }>(sql`
    insert into wms.importer_client (importer_id, name, contact_mobile, address, gstin, city_id, pincode, created_by, updated_by)
    values (${importerId}, ${name}, ${mobile}, ${clean(input.address, 600)}, ${gstin}, ${cityId}, ${pincode},
            ${actor.session.userId}, ${actor.session.userId})
    returning id
  `);
  const id = Number(rows[0]!.id);
  await auditQuietly({
    action: "delivery.client.created",
    operation: "INSERT",
    entityType: "importer_client",
    entityId: String(id),
    entityLabel: name,
    after: { importerId, name, mobile },
    ...auditBase(actor, meta),
  });
  const saved = await getDb().execute<Record<string, unknown>>(sql`${CLIENT_SELECT} where c.id = ${id}`);
  return clientOf(saved[0]!);
}

// ── Transporters (the master list), to pick on a note ─────────────

export type TransporterPick = { id: number; code: string; name: string; mobile: string | null; gstin: string | null };

export async function listTransporters(actor: Actor, q: string): Promise<TransporterPick[]> {
  creatorImporter(actor);
  const like = `%${q.trim().toLowerCase()}%`;
  const rows = await getDb().execute<Record<string, unknown>>(sql`
    select t.id, t.code, t.name, t.contact_mobile::text as mobile, t.gstin::text as gstin
      from wms.transporter t
     where t.deleted_at is null and t.status = 'ACTIVE' and not coalesce(t.blacklisted, false)
       and (${q.trim() === ""} or lower(t.name) like ${like} or lower(coalesce(t.code, '')) like ${like}
            or coalesce(t.contact_mobile::text, '') like ${like})
     order by t.name
     limit 30
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    code: String(r.code ?? ""),
    name: String(r.name),
    mobile: (r.mobile as string | null)?.trim() ?? null,
    gstin: (r.gstin as string | null)?.trim() ?? null,
  }));
}

// ── The draft ─────────────────────────────────────────────────────


export type Header = {
  /** The day the customer gave the order (yyyy-mm-dd). */
  orderDate: string | null;
  clientId: number | null;
  buyerName: string | null;
  buyerMobile: string | null;
  buyerAddress: string | null;
  buyerCity: string | null;
  buyerState: string | null;
  buyerCityId: number | null;
  buyerPincode: string | null;
  buyerGstin: string | null;
  destination: string | null;
  transporterId: number | null;
  transportName: string | null;
  transporterMobile: string | null;
  transporterGstin: string | null;
  paymentMode: string | null;
  billing: "WITH_BILL" | "WITHOUT_BILL" | null;
  billAmount: number | null;
  priority: "NORMAL" | "URGENT";
  packing: (typeof PACKING)[number];
  packingOther: string | null;
  bundles: number | null;
  handling: (typeof HANDLING)[number];
  /** Special packing instructions. */
  instructions: string | null;
  deliveryInstructions: string | null;
  remarks: string | null;
};

/** Every header field once: its column and how it is stored. The draft,
 *  the note, the copy on "start again" and the save all read this list. */
type Field = { key: keyof Header; col: string; kind: "text" | "num" | "date" | "enum"; max?: number; upper?: boolean; def?: string };
const FIELDS: Field[] = [
  { key: "orderDate", col: "order_date", kind: "date" },
  { key: "clientId", col: "client_id", kind: "num" },
  { key: "buyerName", col: "buyer_name", kind: "text", max: 120 },
  { key: "buyerMobile", col: "buyer_mobile", kind: "text", max: 20 },
  { key: "buyerAddress", col: "buyer_address", kind: "text", max: 600 },
  { key: "buyerCity", col: "buyer_city", kind: "text", max: 80 },
  { key: "buyerState", col: "buyer_state", kind: "text", max: 80 },
  { key: "buyerCityId", col: "buyer_city_id", kind: "num" },
  { key: "buyerPincode", col: "buyer_pincode", kind: "text", max: 6 },
  { key: "buyerGstin", col: "buyer_gstin", kind: "text", max: 15, upper: true },
  { key: "destination", col: "destination", kind: "text", max: 120 },
  { key: "transporterId", col: "transporter_id", kind: "num" },
  { key: "transportName", col: "transport_name", kind: "text", max: 120 },
  { key: "transporterMobile", col: "transporter_mobile", kind: "text", max: 20 },
  { key: "transporterGstin", col: "transporter_gstin", kind: "text", max: 20, upper: true },
  { key: "paymentMode", col: "payment_mode", kind: "text", max: 40 },
  { key: "billing", col: "billing", kind: "enum" },
  { key: "billAmount", col: "bill_amount", kind: "num" },
  { key: "priority", col: "priority", kind: "enum", def: "NORMAL" },
  { key: "packing", col: "packing", kind: "enum", def: "CARTON" },
  { key: "packingOther", col: "packing_other", kind: "text", max: 80 },
  { key: "bundles", col: "bundles", kind: "num" },
  { key: "handling", col: "handling", kind: "enum", def: "NORMAL" },
  { key: "instructions", col: "instructions", kind: "text", max: 1000 },
  { key: "deliveryInstructions", col: "delivery_instructions", kind: "text", max: 1000 },
  { key: "remarks", col: "remarks", kind: "text", max: 1000 },
];

const HEADER_COLUMNS = sql.raw(
  FIELDS.map((f) => (f.kind === "date" ? `o.${f.col}::text as ${f.col}_text` : `o.${f.col}`)).join(", "),
);

function headerOf(r: Record<string, unknown>): Header {
  const h: Record<string, unknown> = {};
  for (const f of FIELDS) {
    const v = f.kind === "date" ? r[`${f.col}_text`] : r[f.col];
    if (f.kind === "num") h[f.key] = num(v);
    else if (f.def) h[f.key] = (v as string | null) ?? f.def;
    else h[f.key] = typeof v === "string" ? v.trim() || null : null;
  }
  return h as Header;
}

export type DraftLine = {
  warehouseId: number;
  warehouseName: string;
  key: string;
  itemCode: string | null;
  description: string;
  piecesPerCarton: number;
  unitCode: string | null;
  cartons: number;
  /** Pieces the customer ordered. */
  orderPieces: number;
};

export type Draft = {
  id: number;
  status: "DRAFT" | "EXPIRED" | "SUBMITTED" | "CANCELLED";
  /** When the hold runs out; null until the first item is added. */
  expiresAt: string | null;
  /** Seconds left by the server's clock — the screen counts down from this. */
  secondsLeft: number | null;
  header: Header;
  lines: DraftLine[];
};

async function loadDraft(id: number): Promise<Draft | null> {
  const db = getDb();
  const rows = await db.execute<Record<string, unknown>>(sql`
    select o.id, o.status, o.expires_at::text as expires_at,
           case when o.expires_at is null then null
                else greatest(0, floor(extract(epoch from (o.expires_at - clock_timestamp()))))::int end as seconds_left,
           ${HEADER_COLUMNS}
      from wms.delivery_order o where o.id = ${id}
  `);
  const r = rows[0];
  if (!r) return null;
  let status = String(r.status) as Draft["status"];
  const left = r.seconds_left === null ? null : Number(r.seconds_left);
  if (status === "DRAFT" && r.expires_at !== null && left === 0) {
    // Out of time: say so for good, so it never comes back to life.
    await db.execute(sql`update wms.delivery_order set status = 'EXPIRED', updated_at = now() where id = ${id} and status = 'DRAFT'`);
    status = "EXPIRED";
  }
  const lines = await db.execute<Record<string, unknown>>(sql`
    select l.warehouse_id, w.name as warehouse_name, l.stock_key, l.item_code, l.description, l.pieces_per_carton,
           l.unit_code, l.cartons, l.order_pieces
      from wms.delivery_line l join wms.warehouse w on w.id = l.warehouse_id
     where l.order_id = ${id} and l.delivery_note_id is null
     order by w.name, l.id
  `);
  return {
    id: Number(r.id),
    status,
    expiresAt: status === "DRAFT" ? ((r.expires_at as string | null) ?? null) : null,
    secondsLeft: status === "DRAFT" ? left : null,
    header: headerOf(r),
    lines: lines.map((l) => ({
      warehouseId: Number(l.warehouse_id),
      warehouseName: String(l.warehouse_name),
      key: String(l.stock_key),
      itemCode: (l.item_code as string | null) ?? null,
      description: String(l.description),
      piecesPerCarton: Number(l.pieces_per_carton),
      unitCode: (l.unit_code as string | null) ?? null,
      cartons: Number(l.cartons),
      orderPieces: num(l.order_pieces) ?? Number(l.cartons) * Number(l.pieces_per_carton),
    })),
  };
}

/** The actor's draft that is still being filled (or that just ran out). */
export async function currentDraft(actor: Actor): Promise<Draft | null> {
  creatorImporter(actor);
  const rows = await getDb().execute<{ id: number }>(sql`
    select id from wms.delivery_order
     where created_by = ${actor.session.userId} and status = 'DRAFT'
     order by id desc limit 1
  `);
  return rows[0] ? loadDraft(Number(rows[0].id)) : null;
}

async function ownDraft(actor: Actor, id: number): Promise<Draft> {
  const importerId = creatorImporter(actor);
  const rows = await getDb().execute<{ created_by: number; importer_id: number }>(sql`
    select created_by, importer_id from wms.delivery_order where id = ${id}
  `);
  const r = rows[0];
  if (!r || Number(r.created_by) !== actor.session.userId || Number(r.importer_id) !== importerId) {
    throw new InwardError("NOT_FOUND", "No such delivery note draft");
  }
  return (await loadDraft(id))!;
}

/** A fresh draft. Any other open draft of this person is cancelled (its cartons free).
 *  `copyFrom` carries the buyer and transport over from a draft that ran out. */
export async function startDraft(actor: Actor, copyFrom: number | null): Promise<Draft> {
  const importerId = creatorImporter(actor);
  const db = getDb();
  await db.execute(sql`
    update wms.delivery_order set status = 'CANCELLED', updated_at = now()
     where created_by = ${actor.session.userId} and status = 'DRAFT'
  `);
  const cols = sql.raw(FIELDS.map((f) => f.col).join(", "));
  const { today } = fyOf();
  const copied = sql.join(
    FIELDS.map((f) =>
      f.key === "orderDate"
        ? sql`coalesce(o.order_date, ${today}::date)`
        : f.def
          ? sql`coalesce(o.${sql.raw(f.col)}, ${f.def})`
          : sql`o.${sql.raw(f.col)}`,
    ),
    sql`, `,
  );
  const rows = await db.execute<{ id: number }>(sql`
    insert into wms.delivery_order (importer_id, created_by, ${cols})
    select ${importerId}, ${actor.session.userId}, ${copied}
      from (select 1) one
      left join wms.delivery_order o
        on o.id = ${copyFrom} and o.created_by = ${actor.session.userId} and o.importer_id = ${importerId}
    returning id
  `);
  return (await loadDraft(Number(rows[0]!.id)))!;
}

export type HeaderInput = Partial<Header>;

/** The column assignments for the header fields that were sent. Picking a
 *  client or a transporter fills their details; anything typed with it wins. */
async function headerSets(importerId: number, input: HeaderInput): Promise<SQL[]> {
  const sets: SQL[] = [];
  const given = (k: keyof Header) => input[k] !== undefined;
  if (input.clientId !== undefined && input.clientId !== null) {
    const c = await getDb().execute<Record<string, unknown>>(sql`
      ${CLIENT_SELECT} where c.id = ${input.clientId} and c.importer_id = ${importerId} and c.deleted_at is null
    `);
    if (!c[0]) throw new InwardError("VALIDATION_FAILED", "Choose one of your clients", { clientId: "Choose one of your clients" });
    const row = clientOf(c[0]);
    const fill: Partial<Header> = {
      buyerName: row.name,
      buyerMobile: row.mobile,
      buyerAddress: row.address,
      buyerCity: row.city,
      buyerState: row.state,
      buyerCityId: row.cityId,
      buyerPincode: row.pincode,
      buyerGstin: row.gstin,
    };
    for (const [k, v] of Object.entries(fill)) if (!given(k as keyof Header)) (input as Record<string, unknown>)[k] = v;
  }
  if (input.transporterId !== undefined && input.transporterId !== null) {
    const t = await getDb().execute<Record<string, unknown>>(sql`
      select t.name, t.contact_mobile::text as mobile, t.gstin::text as gstin
        from wms.transporter t where t.id = ${input.transporterId} and t.deleted_at is null and t.status = 'ACTIVE'
    `);
    if (!t[0]) {
      throw new InwardError("VALIDATION_FAILED", "Choose a transporter from the list", { transportName: "Choose a transporter from the list" });
    }
    const fill: Partial<Header> = {
      transportName: String(t[0].name),
      transporterMobile: (t[0].mobile as string | null)?.trim() ?? null,
      transporterGstin: (t[0].gstin as string | null)?.trim() ?? null,
    };
    for (const [k, v] of Object.entries(fill)) if (!given(k as keyof Header)) (input as Record<string, unknown>)[k] = v;
  }
  for (const f of FIELDS) {
    const v = input[f.key];
    if (v === undefined) continue;
    const col = sql.raw(f.col);
    if (f.kind === "text") {
      const t = clean(v, f.max ?? 500);
      sets.push(sql`${col} = ${f.upper && t ? t.toUpperCase() : t}`);
    } else if (f.kind === "date") {
      sets.push(sql`${col} = ${v === null ? null : String(v)}::date`);
    } else if (f.def) {
      sets.push(sql`${col} = ${v ?? f.def}`);
    } else {
      sets.push(sql`${col} = ${v as string | number | null}`);
    }
  }
  return sets;
}

export async function saveDraftHeader(actor: Actor, id: number, input: HeaderInput): Promise<Draft> {
  const draft = await ownDraft(actor, id);
  if (draft.status !== "DRAFT") throw new InwardError("CONFLICT", "This delivery note was already sent or ran out of time");
  const sets = await headerSets(importerIdOf(actor)!, input);
  if (sets.length) {
    await getDb().execute(sql`
      update wms.delivery_order set ${sql.join(sets, sql`, `)}, updated_at = now() where id = ${id} and status = 'DRAFT'
    `);
  }
  return (await loadDraft(id))!;
}

/** Hold (or change, or with 0 drop) one item's cartons on the draft. */
export async function holdLine(
  actor: Actor,
  id: number,
  input: { warehouseId: number; key: string; cartons: number; orderPieces?: number | null },
): Promise<{ draft: Draft; ok: boolean; message?: string; available?: number }> {
  const draft = await ownDraft(actor, id);
  if (draft.status !== "DRAFT") {
    return { draft, ok: false, message: "Time ran out — the cartons were put back. Start again." };
  }
  const cartons = Math.floor(input.cartons);
  if (!Number.isFinite(cartons) || cartons < 0 || cartons > 100000) {
    throw new InwardError("VALIDATION_FAILED", "Enter the number of cartons");
  }
  const pieces = input.orderPieces == null ? null : Math.floor(input.orderPieces);
  if (pieces !== null && (!Number.isFinite(pieces) || pieces < 1)) {
    throw new InwardError("VALIDATION_FAILED", "Enter the pieces ordered");
  }
  const rows = await getDb().execute<{ r: { ok: boolean; reason?: string; free?: number } }>(sql`
    select wms.dn_hold(${id}, ${input.warehouseId}, ${input.key}, ${cartons}, ${HOLD_SECONDS}, ${cartons === 0 ? null : pieces}::int) as r
  `);
  const r = rows[0]!.r;
  const fresh = (await loadDraft(id))!;
  if (r.ok) return { draft: fresh, ok: true };
  if (r.reason === "EXPIRED") return { draft: fresh, ok: false, message: "Time ran out — the cartons were put back. Start again." };
  const free = Number(r.free ?? 0);
  const ppc = Number(input.key.split(":")[1] ?? 0);
  return {
    draft: fresh,
    ok: false,
    available: free,
    message:
      free === 0
        ? "No cartons of this item are free right now"
        : `Only ${free} carton${free === 1 ? "" : "s"}${ppc ? ` (${free * ppc} pcs)` : ""} free right now`,
  };
}

export async function cancelDraft(actor: Actor, id: number): Promise<void> {
  await ownDraft(actor, id);
  await getDb().execute(sql`
    update wms.delivery_order set status = 'CANCELLED', updated_at = now() where id = ${id} and status = 'DRAFT'
  `);
}

/** Is this agent trusted by their importer (auto-approve)? */
async function trusted(actor: Actor, importerId: number): Promise<boolean> {
  const rows = await getDb().execute<{ auto_approve: boolean }>(sql`
    select auto_approve from wms.sales_agent
     where user_id = ${actor.session.userId} and importer_id = ${importerId} and deleted_at is null and is_active
  `);
  return Boolean(rows[0]?.auto_approve);
}

const MOBILE = /^[6-9][0-9]{9}$/;
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** What is missing or wrong in a header — the same rules for a new note and a change. */
export function headerProblem(h: Header, today: string = fyOf().today): Record<string, string> | null {
  const f: Record<string, string> = {};
  if (!h.orderDate || !/^\d{4}-\d{2}-\d{2}$/.test(h.orderDate)) f.orderDate = "Enter the order date";
  else if (h.orderDate > today) f.orderDate = "The order date cannot be in the future";
  if (!h.buyerName?.trim()) f.buyerName = "Choose or enter the buyer";
  if (!h.buyerMobile?.trim()) f.buyerMobile = "Enter the buyer's mobile";
  else if (!MOBILE.test(normalizeMobile(h.buyerMobile))) f.buyerMobile = "Enter a 10-digit mobile number";
  if (!h.buyerAddress?.trim()) f.buyerAddress = "Enter the delivery address";
  if (!h.buyerCity?.trim()) f.buyerCity = "Enter the city";
  if (!h.buyerState?.trim()) f.buyerState = "Choose the state";
  if (!h.buyerPincode?.trim()) f.buyerPincode = "Enter the PIN code";
  else if (!/^[1-9][0-9]{5}$/.test(h.buyerPincode.trim())) f.buyerPincode = "PIN code is 6 digits";
  if (h.buyerGstin && !GSTIN.test(h.buyerGstin.trim().toUpperCase())) f.buyerGstin = "That GSTIN does not look right";
  if (!h.transportName?.trim()) f.transportName = "Enter the transporter";
  if (!h.transporterMobile?.trim()) f.transporterMobile = "Enter the transporter's mobile";
  else if (!MOBILE.test(normalizeMobile(h.transporterMobile))) f.transporterMobile = "Enter a 10-digit mobile number";
  if (!h.paymentMode?.trim()) f.paymentMode = "Choose the payment mode";
  if (!h.billing) f.billing = "With bill or without bill?";
  else if (h.billing === "WITH_BILL" && !(Number(h.billAmount) > 0)) f.billAmount = "Enter the bill amount";
  if (h.packing === "BUNDLE" && !(Number(h.bundles) > 0)) f.bundles = "Enter the number of bundles";
  if (h.packing === "OTHER" && !h.packingOther?.trim()) f.packingOther = "Say how it is packed";
  return Object.keys(f).length ? f : null;
}

/** Send the draft: one delivery note per warehouse. */
export async function submitDraft(actor: Actor, id: number, meta: Meta): Promise<{ notes: NoteSummary[] }> {
  const draft = await ownDraft(actor, id);
  if (draft.status !== "DRAFT") throw new InwardError("CONFLICT", "Time ran out — the cartons were put back. Start again.");
  if (draft.lines.length === 0) throw new InwardError("VALIDATION_FAILED", "Add at least one item");
  const problem = headerProblem(draft.header);
  if (problem) throw new InwardError("VALIDATION_FAILED", Object.values(problem)[0]!, problem);

  const importerId = importerIdOf(actor)!;
  const owner = isImporterOf(actor, importerId);
  const auto = !owner && (await trusted(actor, importerId));
  const status = owner || auto ? "APPROVED" : "PENDING";
  const kind = owner ? "IMPORTER_CREATED" : auto ? "AUTO" : null;
  const { fy, today } = fyOf();

  let ids: number[];
  try {
    const rows = await getDb().execute<{ id: number }>(sql`
      select wms.dn_submit(${id}, ${actor.session.userId}, ${fy}, ${today}::date, ${status}, ${kind}) as id
    `);
    ids = rows.map((r) => Number(r.id));
  } catch (error) {
    const text = String((error as { message?: string }).message ?? error);
    if (text.includes("EXPIRED")) throw new InwardError("CONFLICT", "Time ran out — the cartons were put back. Start again.");
    if (text.includes("EMPTY")) throw new InwardError("VALIDATION_FAILED", "Add at least one item");
    if (text.includes("delivery_note_importer_id_dn_no_key")) {
      throw new InwardError("CONFLICT", "That delivery note number is already used. The importer should set a higher next number.");
    }
    throw error;
  }

  const notes: NoteSummary[] = [];
  for (const noteId of ids) {
    const n = await summaryOf(noteId);
    notes.push(n);
    await auditQuietly({
      action: "delivery.note.submitted",
      operation: "INSERT",
      entityType: "delivery_note",
      entityId: String(noteId),
      entityLabel: n.dnNo,
      after: { status: n.status, approvalKind: kind, warehouse: n.warehouseName, cartons: n.cartons, buyer: n.buyerName },
      ...auditBase(actor, meta),
    });
    await tell(status === "APPROVED" ? "delivery.approved" : "delivery.submitted", n, actor, meta, {
      how: kind ? KIND_LABEL[kind]! : "",
    });
  }
  return { notes };
}

// ── Notes ─────────────────────────────────────────────────────────

export type NoteSummary = {
  id: number;
  dnNo: string;
  dnDate: string;
  orderNo: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  statusLabel: string;
  approvalKind: string | null;
  importerId: number;
  importerName: string;
  warehouseId: number;
  warehouseName: string;
  buyerName: string;
  destination: string | null;
  priority: string;
  cartons: number;
  pieces: number;
  lines: number;
  createdBy: number;
  createdByName: string;
  createdAt: string;
  /** The warehouse's step (NEW … READY_FOR_DISPATCH); ON_HOLD while on hold. */
  workStatus: string;
};

const SUMMARY = sql`
  select n.id, n.dn_no, n.dn_date::text as dn_date, n.order_no, n.status, n.approval_kind, n.importer_id,
         i.company_name as importer_name, n.warehouse_id, w.name as warehouse_name, n.buyer_name, n.destination,
         n.priority, n.created_by, trim(u.first_name || ' ' || coalesce(u.last_name, '')) as created_by_name,
         n.created_at::text as created_at, n.work_status, n.on_hold,
         coalesce((select sum(l.cartons) from wms.delivery_line l where l.delivery_note_id = n.id), 0)::int as cartons,
         coalesce((select sum(l.cartons * l.pieces_per_carton) from wms.delivery_line l where l.delivery_note_id = n.id), 0)::int as pieces,
         (select count(*) from wms.delivery_line l where l.delivery_note_id = n.id)::int as line_count
    from wms.delivery_note n
    join wms.importer i on i.id = n.importer_id
    join wms.warehouse w on w.id = n.warehouse_id
    join wms.users u on u.id = n.created_by`;

function summary(r: Record<string, unknown>): NoteSummary {
  const status = String(r.status) as NoteSummary["status"];
  return {
    id: Number(r.id),
    dnNo: String(r.dn_no),
    dnDate: String(r.dn_date),
    orderNo: String(r.order_no),
    status,
    statusLabel: STATUS_LABEL[status] ?? status,
    approvalKind: (r.approval_kind as string | null) ?? null,
    importerId: Number(r.importer_id),
    importerName: String(r.importer_name),
    warehouseId: Number(r.warehouse_id),
    warehouseName: String(r.warehouse_name),
    buyerName: String(r.buyer_name),
    destination: (r.destination as string | null) ?? null,
    priority: String(r.priority),
    cartons: Number(r.cartons),
    pieces: Number(r.pieces),
    lines: Number(r.line_count),
    createdBy: Number(r.created_by),
    createdByName: String(r.created_by_name),
    createdAt: String(r.created_at),
    workStatus: r.on_hold ? "ON_HOLD" : String(r.work_status ?? "NEW"),
  };
}

async function summaryOf(id: number): Promise<NoteSummary> {
  const rows = await getDb().execute<Record<string, unknown>>(sql`${SUMMARY} where n.id = ${id}`);
  if (!rows[0]) throw new InwardError("NOT_FOUND", "No such delivery note");
  return summary(rows[0]);
}

export async function listNotes(
  scope: DnScope,
  filter: { status?: string | null; q?: string | null; warehouseId?: number | null } = {},
): Promise<NoteSummary[]> {
  const parts: SQL[] = [dnWhere(scope)];
  if (filter.status && ["PENDING", "APPROVED", "REJECTED", "CANCELLED"].includes(filter.status)) parts.push(sql`n.status = ${filter.status}`);
  if (filter.warehouseId) parts.push(sql`n.warehouse_id = ${filter.warehouseId}`);
  const q = filter.q?.trim().toLowerCase();
  if (q) {
    const like = `%${q}%`;
    parts.push(sql`(lower(n.dn_no) like ${like} or lower(n.order_no) like ${like} or lower(n.buyer_name) like ${like}
                    or lower(coalesce(n.destination, '')) like ${like} or lower(i.company_name) like ${like}
                    or lower(u.first_name || ' ' || coalesce(u.last_name, '')) like ${like}
                    or exists (select 1 from wms.delivery_line l where l.delivery_note_id = n.id
                                and lower(coalesce(l.item_code, '') || ' ' || l.description) like ${like}))`);
  }
  const rows = await getDb().execute<Record<string, unknown>>(sql`
    ${SUMMARY}
     where ${sql.join(parts, sql` and `)}
     order by case n.status when 'PENDING' then 0 else 1 end, n.created_at desc, n.id desc
     limit 500
  `);
  return rows.map(summary);
}

export type NoteLine = {
  key: string;
  itemCode: string | null;
  description: string;
  piecesPerCarton: number;
  unitCode: string | null;
  cartons: number;
  pieces: number;
  /** Pieces the customer ordered (pieces sent are cartons × per carton). */
  orderPieces: number;
};

export type NoteEvent = { action: string; by: string | null; at: string; remarks: string | null };

export type NoteDetail = NoteSummary & {
  header: Header;
  importer: { name: string; address: string | null; gstin: string | null; mobile: string | null };
  warehouseCode: string;
  approvedByName: string | null;
  approvedAt: string | null;
  confirmMethod: string | null;
  confirmPerson: string | null;
  confirmNote: string | null;
  rejectedByName: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  cancelledByName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  /** The warehouse's work on it (picking, packing). */
  work: { workStatus: string; onHold: boolean; workLabel: string; required: number; picked: number; packed: number; packages: number; returning: number } | null;
  /** Items are locked once the first carton is picked. */
  itemsLocked: boolean;
  version: number;
  editedAt: string | null;
  lineItems: NoteLine[];
  events: NoteEvent[];
  can: { approve: boolean; reject: boolean; confirmNeeded: boolean; edit: boolean; cancel: boolean };
};

async function rawNote(id: number) {
  const rows = await getDb().execute<Record<string, unknown>>(sql`
    select n.*, n.order_date::text as order_date_text, n.dn_date::text as dn_date_text, n.approved_at::text as approved_at_text, n.rejected_at::text as rejected_at_text, n.cancelled_at::text as cancelled_at_text,
           n.edited_at::text as edited_at_text, n.created_at::text as created_at_text
      from wms.delivery_note n where n.id = ${id}
  `);
  return rows[0] ?? null;
}

/** What this actor may do to this note. */
function rights(actor: Actor, n: { importer_id: number; warehouse_id: number; status: string; created_by: number }) {
  const importerId = Number(n.importer_id);
  const owner = isImporterOf(actor, importerId);
  const approveGrant = grantFor(actor, "dispatch.order.approve");
  const admin =
    !owner &&
    !!approveGrant &&
    (approveGrant.scope === "ALL" ||
      (approveGrant.scope === "WAREHOUSE" && approveGrant.warehouseIds.includes(Number(n.warehouse_id))));
  const canDecide = n.status === "PENDING" && (owner || admin);
  const updateGrant = grantFor(actor, "dispatch.order.update");
  const creator = isAgentOnly(actor) && Number(n.created_by) === actor.session.userId && importerIdOf(actor) === importerId;
  const live = n.status === "PENDING" || n.status === "APPROVED";
  const edit = !!updateGrant && live && (owner || creator);
  // The importer, or a super admin, can call a note off — picked cartons go back to storage.
  const cancel = live && (owner || approveGrant?.scope === "ALL");
  return { approve: canDecide, reject: canDecide, confirmNeeded: canDecide && !owner, edit, cancel, owner, admin, creator };
}

export async function getNote(scope: DnScope, actor: Actor, id: number): Promise<NoteDetail> {
  const db = getDb();
  const visible = await db.execute<{ id: number }>(sql`
    select n.id from wms.delivery_note n where n.id = ${id} and ${dnWhere(scope)}
  `);
  if (!visible[0]) throw new InwardError("NOT_FOUND", "No such delivery note");
  const s = await summaryOf(id);
  const r = (await rawNote(id))!;
  const extra = await db.execute<Record<string, unknown>>(sql`
    select i.company_name, i.address, i.gstin::text as gstin, i.contact_mobile::text as mobile, ci.name as city, i.pincode::text as pincode,
           w.code as warehouse_code,
           trim(ua.first_name || ' ' || coalesce(ua.last_name, '')) as approved_by_name,
           trim(ur.first_name || ' ' || coalesce(ur.last_name, '')) as rejected_by_name,
           trim(uc.first_name || ' ' || coalesce(uc.last_name, '')) as cancelled_by_name
      from wms.delivery_note n
      join wms.importer i on i.id = n.importer_id
      left join wms.city ci on ci.id = i.city_id
      join wms.warehouse w on w.id = n.warehouse_id
      left join wms.users ua on ua.id = n.approved_by
      left join wms.users ur on ur.id = n.rejected_by
      left join wms.users uc on uc.id = n.cancelled_by
     where n.id = ${id}
  `);
  const x = extra[0]!;
  const lines = await db.execute<Record<string, unknown>>(sql`
    select stock_key, item_code, description, pieces_per_carton, unit_code, cartons, order_pieces
      from wms.delivery_line where delivery_note_id = ${id} order by id
  `);
  const events = await db.execute<Record<string, unknown>>(sql`
    select e.action, trim(u.first_name || ' ' || coalesce(u.last_name, '')) as by, e.at::text as at, e.remarks
      from wms.delivery_note_event e left join wms.users u on u.id = e.by_user
     where e.delivery_note_id = ${id} order by e.at, e.id
  `);
  const can = rights(actor, {
    importer_id: Number(r.importer_id),
    warehouse_id: Number(r.warehouse_id),
    status: String(r.status),
    created_by: Number(r.created_by),
  });
  const address = [x.address, [x.city, (x.pincode as string | null)?.trim()].filter(Boolean).join(" - ")]
    .filter((v) => v && String(v).trim())
    .join(", ");
  return {
    ...s,
    header: headerOf(r),
    importer: {
      name: String(x.company_name),
      address: address || null,
      gstin: (x.gstin as string | null)?.trim() ?? null,
      mobile: (x.mobile as string | null)?.trim() ?? null,
    },
    warehouseCode: String(x.warehouse_code),
    approvedByName: (x.approved_by_name as string | null) || null,
    approvedAt: (r.approved_at_text as string | null) ?? null,
    confirmMethod: (r.confirm_method as string | null) ?? null,
    confirmPerson: (r.confirm_person as string | null) ?? null,
    confirmNote: (r.confirm_note as string | null) ?? null,
    rejectedByName: (x.rejected_by_name as string | null) || null,
    rejectedAt: (r.rejected_at_text as string | null) ?? null,
    rejectReason: (r.reject_reason as string | null) ?? null,
    cancelledByName: (x.cancelled_by_name as string | null) || null,
    cancelledAt: (r.cancelled_at_text as string | null) ?? null,
    cancelReason: (r.cancel_reason as string | null) ?? null,
    work: await progressOf(id),
    itemsLocked: await pickingStarted(id),
    version: Number(r.version),
    editedAt: (r.edited_at_text as string | null) ?? null,
    lineItems: lines.map((l) => ({
      key: String(l.stock_key),
      itemCode: (l.item_code as string | null) ?? null,
      description: String(l.description),
      piecesPerCarton: Number(l.pieces_per_carton),
      unitCode: (l.unit_code as string | null) ?? null,
      cartons: Number(l.cartons),
      pieces: Number(l.cartons) * Number(l.pieces_per_carton),
      orderPieces: num(l.order_pieces) ?? Number(l.cartons) * Number(l.pieces_per_carton),
    })),
    events: events.map((e) => ({
      action: String(e.action),
      by: (e.by as string | null) || null,
      at: String(e.at),
      remarks: (e.remarks as string | null) ?? null,
    })),
    can: { approve: can.approve, reject: can.reject, confirmNeeded: can.confirmNeeded, edit: can.edit, cancel: can.cancel },
  };
}

export type Confirmation = { method: string; person: string; note?: string | null };

function confirmationOf(input: Confirmation | null | undefined): { method: string; person: string; note: string | null } {
  const method = input?.method && (CONFIRM_METHODS as readonly string[]).includes(input.method) ? input.method : null;
  const person = clean(input?.person, 120);
  const f: Record<string, string> = {};
  if (!method) f.method = "How did you confirm with the importer?";
  if (!person) f.person = "Who at the importer said yes?";
  if (Object.keys(f).length) {
    throw new InwardError("VALIDATION_FAILED", "Ask the importer first, then say how and who", f);
  }
  return { method: method!, person: person!, note: clean(input?.note, 500) };
}

export async function approveNote(
  scope: DnScope,
  actor: Actor,
  id: number,
  confirm: Confirmation | null,
  meta: Meta,
): Promise<NoteDetail> {
  const before = await getNote(scope, actor, id);
  if (before.status !== "PENDING") {
    throw new InwardError("CONFLICT", before.status === "APPROVED" ? "This delivery note is already approved" : `A ${before.status.toLowerCase()} delivery note cannot be approved`);
  }
  if (!before.can.approve) throw new InwardError("FORBIDDEN", "Only the importer approves delivery notes.");
  const c = before.can.confirmNeeded ? confirmationOf(confirm) : null;
  const kind = c ? "CONFIRMED" : "IMPORTER";
  const done = await getDb().execute<{ id: number }>(sql`
    update wms.delivery_note
       set status = 'APPROVED', approval_kind = ${kind}, approved_by = ${actor.session.userId}, approved_at = now(),
           confirm_method = ${c?.method ?? null}, confirm_person = ${c?.person ?? null}, confirm_note = ${c?.note ?? null},
           updated_at = now()
     where id = ${id} and status = 'PENDING'
    returning id
  `);
  if (!done[0]) throw new InwardError("CONFLICT", "Someone else decided on this delivery note a moment ago");
  const remarks = c
    ? `Confirmed with ${c.person} (${CONFIRM_LABEL[c.method]})${c.note ? ` — ${c.note}` : ""}`
    : null;
  await getDb().execute(sql`
    insert into wms.delivery_note_event (delivery_note_id, action, by_user, remarks)
    values (${id}, ${c ? "CONFIRMED_APPROVED" : "APPROVED"}, ${actor.session.userId}, ${remarks})
  `);
  await auditQuietly({
    action: "delivery.note.approved",
    operation: "UPDATE",
    entityType: "delivery_note",
    entityId: String(id),
    entityLabel: before.dnNo,
    before: { status: "PENDING" },
    after: { status: "APPROVED", approvalKind: kind, confirmMethod: c?.method ?? null, confirmPerson: c?.person ?? null },
    ...auditBase(actor, meta),
  });
  await tell("delivery.approved", await summaryOf(id), actor, meta, { how: c ? `${KIND_LABEL.CONFIRMED} (${c.person})` : KIND_LABEL.IMPORTER! });
  // Packed and verified while it waited? It is ready for dispatch now.
  await afterStep(id, before.work?.workStatus ?? "NEW", actor, meta);
  return getNote(scope, actor, id);
}

export async function rejectNote(
  scope: DnScope,
  actor: Actor,
  id: number,
  reason: string,
  confirm: Confirmation | null,
  meta: Meta,
): Promise<NoteDetail> {
  const before = await getNote(scope, actor, id);
  if (before.status !== "PENDING") {
    throw new InwardError(
      "CONFLICT",
      before.status === "APPROVED" ? "An approved delivery note cannot be rejected — cancel it instead" : `This delivery note is already ${before.status.toLowerCase()}`,
    );
  }
  if (!before.can.reject) throw new InwardError("FORBIDDEN", "Only the importer rejects delivery notes.");
  const why = clean(reason, 500);
  if (!why) throw new InwardError("VALIDATION_FAILED", "Say why it is rejected", { reason: "Say why it is rejected" });
  const c = before.can.confirmNeeded ? confirmationOf(confirm) : null;
  const done = await getDb().execute<{ id: number }>(sql`
    update wms.delivery_note
       set status = 'REJECTED', rejected_by = ${actor.session.userId}, rejected_at = now(), reject_reason = ${why},
           confirm_method = ${c?.method ?? null}, confirm_person = ${c?.person ?? null}, confirm_note = ${c?.note ?? null},
           updated_at = now()
     where id = ${id} and status = 'PENDING'
    returning id
  `);
  if (!done[0]) throw new InwardError("CONFLICT", "Someone else decided on this delivery note a moment ago");
  await getDb().execute(sql`
    insert into wms.delivery_note_event (delivery_note_id, action, by_user, remarks)
    values (${id}, 'REJECTED', ${actor.session.userId},
            ${c ? `${why} — confirmed with ${c.person} (${CONFIRM_LABEL[c.method]})` : why})
  `);
  await auditQuietly({
    action: "delivery.note.rejected",
    operation: "UPDATE",
    entityType: "delivery_note",
    entityId: String(id),
    entityLabel: before.dnNo,
    before: { status: "PENDING" },
    after: { status: "REJECTED", reason: why, confirmPerson: c?.person ?? null },
    reason: why,
    ...auditBase(actor, meta),
  });
  await tell("delivery.rejected", await summaryOf(id), actor, meta, { reason: why });
  // Anything already picked goes back to storage (a new place is fine).
  await releaseNote(actor, id, `Rejected: ${why}`, meta);
  return getNote(scope, actor, id);
}

/** Call a pending or approved note off (the importer, or a super admin).
 *  Its cartons are free again; picked ones go back to storage. */
export async function cancelNote(scope: DnScope, actor: Actor, id: number, reason: string, meta: Meta): Promise<NoteDetail> {
  const before = await getNote(scope, actor, id);
  if (before.status !== "PENDING" && before.status !== "APPROVED") {
    throw new InwardError("CONFLICT", `This delivery note is already ${before.status.toLowerCase()}`);
  }
  if (!before.can.cancel) throw new InwardError("FORBIDDEN", "Only the importer or a super admin cancels a delivery note.");
  const why = clean(reason, 500);
  if (!why) throw new InwardError("VALIDATION_FAILED", "Say why it is cancelled", { reason: "Say why it is cancelled" });
  const done = await getDb().execute<{ id: number }>(sql`
    update wms.delivery_note
       set status = 'CANCELLED', cancelled_by = ${actor.session.userId}, cancelled_at = now(), cancel_reason = ${why},
           on_hold = false, updated_at = now()
     where id = ${id} and status in ('PENDING','APPROVED')
    returning id
  `);
  if (!done[0]) throw new InwardError("CONFLICT", "Someone else changed this delivery note a moment ago");
  await getDb().execute(sql`
    insert into wms.delivery_note_event (delivery_note_id, action, by_user, remarks) values (${id}, 'CANCELLED', ${actor.session.userId}, ${why})
  `);
  await auditQuietly({
    action: "delivery.note.cancelled",
    operation: "UPDATE",
    entityType: "delivery_note",
    entityId: String(id),
    entityLabel: before.dnNo,
    before: { status: before.status, work: before.work?.workStatus ?? null },
    after: { status: "CANCELLED", reason: why },
    reason: why,
    ...auditBase(actor, meta),
  });
  const back = await releaseNote(actor, id, `Cancelled: ${why}`, meta);
  await tell("delivery.cancelled", await summaryOf(id), actor, meta, {
    reason: back > 0 ? `${why} — ${back} picked carton${back === 1 ? "" : "s"} go back to storage` : why,
  });
  return getNote(scope, actor, id);
}

export type EditInput = HeaderInput & { lines: { key: string; cartons: number; orderPieces?: number | null }[] };

/** Change a pending or approved note. The agent's change needs approval
 *  again (a trusted agent's is approved again); the importer's is approval. */
export async function editNote(scope: DnScope, actor: Actor, id: number, input: EditInput, meta: Meta): Promise<NoteDetail> {
  const before = await getNote(scope, actor, id);
  if (!before.can.edit) {
    throw new InwardError(
      before.status === "REJECTED" || before.status === "CANCELLED" ? "CONFLICT" : "FORBIDDEN",
      before.status === "REJECTED" || before.status === "CANCELLED"
        ? `A ${before.status.toLowerCase()} delivery note cannot be changed. Make a new one.`
        : "Only the sales agent who made it, or the importer, can change it.",
    );
  }
  const lines = input.lines
    .filter((l) => l.cartons > 0)
    .map((l) => ({ key: l.key, cartons: Math.floor(l.cartons), orderPieces: l.orderPieces ? Math.floor(l.orderPieces) : null }));
  if (lines.length === 0) throw new InwardError("VALIDATION_FAILED", "Keep at least one item");
  // Once the warehouse has picked a carton the items are fixed; buyer and transport can still change.
  const locked = before.itemsLocked;
  if (locked) {
    const was = new Map(before.lineItems.map((l) => [l.key, l.cartons]));
    const same = lines.length === was.size && lines.every((l) => was.get(l.key) === l.cartons);
    if (!same) {
      throw new InwardError(
        "CONFLICT",
        "The warehouse has started picking — the items cannot change now. You can still change the buyer and transport details, or cancel the note.",
      );
    }
  }
  // The header as it will be — checked before anything is saved. Picking a
  // client or transporter fills `input` with their details first.
  const sets = await headerSets(before.importerId, input);
  const merged: Header = { ...before.header };
  for (const [k, v] of Object.entries(input)) {
    if (k !== "lines" && v !== undefined) (merged as Record<string, unknown>)[k] = v;
  }
  const problem = headerProblem(merged);
  if (problem) throw new InwardError("VALIDATION_FAILED", Object.values(problem)[0]!, problem);
  const db = getDb();
  const res = locked
    ? [{ r: { ok: true } as { ok: boolean; short?: { key: string; free: number }[] } }]
    : await db.execute<{ r: { ok: boolean; short?: { key: string; free: number }[] } }>(sql`
        select wms.dn_save_lines(${id}, ${JSON.stringify(lines)}::jsonb) as r
      `);
  const r = res[0]!.r;
  if (!r.ok) {
    const fields: Record<string, string> = {};
    for (const s of r.short ?? []) fields[`line:${s.key}`] = `Only ${s.free} carton${s.free === 1 ? "" : "s"} free`;
    const first = (r.short ?? [])[0];
    throw new InwardError(
      "CONFLICT",
      first ? `Not enough stock: only ${first.free} carton${first.free === 1 ? "" : "s"} of one item are free` : "Not enough stock",
      fields,
    );
  }

  const importerId = before.importerId;
  const owner = isImporterOf(actor, importerId);
  const auto = !owner && (await trusted(actor, importerId));
  const status = owner || auto ? "APPROVED" : "PENDING";
  const kind = owner ? "IMPORTER_EDIT" : auto ? "AUTO" : null;
  await db.execute(sql`
    update wms.delivery_note
       set ${sets.length ? sql`${sql.join(sets, sql`, `)},` : sql``}
           status = ${status}, approval_kind = ${kind},
           approved_by = ${status === "APPROVED" ? actor.session.userId : null},
           approved_at = ${status === "APPROVED" ? sql`now()` : null},
           confirm_method = null, confirm_person = null, confirm_note = null,
           version = version + 1, edited_by = ${actor.session.userId}, edited_at = now(), updated_at = now()
     where id = ${id}
  `);
  const after0 = await getNote(scope, actor, id);
  await db.execute(sql`
    insert into wms.delivery_note_event (delivery_note_id, action, by_user, remarks)
    values (${id}, 'EDITED', ${actor.session.userId},
            ${status === "APPROVED" ? (owner ? "Changed by the importer — approved" : "Changed — trusted agent, approved again") : "Changed — needs approval again"})
  `);
  await auditQuietly({
    action: "delivery.note.edited",
    operation: "UPDATE",
    entityType: "delivery_note",
    entityId: String(id),
    entityLabel: before.dnNo,
    before: { status: before.status, lines: before.lineItems.map((l) => ({ key: l.key, cartons: l.cartons })) },
    after: { status, lines },
    ...auditBase(actor, meta),
  });
  await tell("delivery.edited", after0, actor, meta, {
    by: who(actor),
    status: status === "APPROVED" ? "approved" : "waiting for approval",
  });
  // Needs approval again → not ready for dispatch until it has it.
  await afterStep(id, before.work?.workStatus ?? "NEW", actor, meta);
  return getNote(scope, actor, id);
}

// ── Numbering ─────────────────────────────────────────────────────

export type Series = { prefix: string; orderPrefix: string; fy: string; nextNo: number; nextOrderNo: number; sample: string };

function seriesImporter(actor: Actor, requested: number | null): number {
  const g = grantFor(actor, "dispatch.order.approve");
  if (g?.scope === "ALL" && requested) return requested;
  const own = importerIdOf(actor);
  if (own === null || !isImporterOf(actor, own)) {
    throw new InwardError("FORBIDDEN", "Only the importer sets the delivery note numbers.");
  }
  return own;
}

export async function getSeries(actor: Actor, requested: number | null = null): Promise<Series> {
  const importerId = seriesImporter(actor, requested);
  const { fy } = fyOf();
  const rows = await getDb().execute<Record<string, unknown>>(sql`
    select prefix, order_prefix, fy, next_no, next_order_no from wms.delivery_series where importer_id = ${importerId}
  `);
  const r = rows[0];
  const sameYear = r && String(r.fy) === fy;
  const prefix = r ? String(r.prefix) : "";
  const nextNo = sameYear ? Number(r.next_no) : 1;
  return {
    prefix,
    orderPrefix: r ? String(r.order_prefix) : "E",
    fy,
    nextNo,
    nextOrderNo: sameYear ? Number(r.next_order_no) : 1,
    sample: `${prefix}/${fy}/${nextNo}`,
  };
}

export async function setSeries(
  actor: Actor,
  input: { prefix?: string; orderPrefix?: string; nextNo?: number; nextOrderNo?: number },
  meta: Meta,
  requested: number | null = null,
): Promise<Series> {
  const importerId = seriesImporter(actor, requested);
  const current = await getSeries(actor, importerId);
  const prefix = input.prefix !== undefined ? input.prefix.trim().slice(0, 12) : current.prefix;
  const orderPrefix = input.orderPrefix !== undefined ? input.orderPrefix.trim().slice(0, 12) || "E" : current.orderPrefix;
  const nextNo = input.nextNo ?? current.nextNo;
  const nextOrderNo = input.nextOrderNo ?? current.nextOrderNo;
  if (!Number.isInteger(nextNo) || nextNo < 1 || nextNo > 99_999_999) {
    throw new InwardError("VALIDATION_FAILED", "Next number must be 1 or more", { nextNo: "Next number must be 1 or more" });
  }
  if (!Number.isInteger(nextOrderNo) || nextOrderNo < 1 || nextOrderNo > 99_999_999) {
    throw new InwardError("VALIDATION_FAILED", "Next order number must be 1 or more", { nextOrderNo: "Must be 1 or more" });
  }
  if (/[/\s]/.test(prefix) || /[/\s]/.test(orderPrefix)) {
    throw new InwardError("VALIDATION_FAILED", "Prefixes cannot contain spaces or /", { prefix: "No spaces or /" });
  }
  // The next number must not already be on a note (or a number above it).
  const used = await getDb().execute<{ n: string }>(sql`
    select count(*)::text as n from wms.delivery_note
     where importer_id = ${importerId} and dn_no like ${`${prefix}/${current.fy}/%`}
       and nullif(split_part(dn_no, '/', 3), '')::bigint >= ${nextNo}
  `);
  if (Number(used[0]?.n ?? 0) > 0) {
    throw new InwardError("CONFLICT", `Numbers from ${prefix}/${current.fy}/${nextNo} are already used. Choose a higher next number.`, {
      nextNo: "Already used — choose a higher number",
    });
  }
  await getDb().execute(sql`
    insert into wms.delivery_series (importer_id, prefix, order_prefix, fy, next_no, next_order_no, updated_by, updated_at)
    values (${importerId}, ${prefix}, ${orderPrefix}, ${current.fy}, ${nextNo}, ${nextOrderNo}, ${actor.session.userId}, now())
    on conflict (importer_id) do update
      set prefix = excluded.prefix, order_prefix = excluded.order_prefix, fy = excluded.fy, next_no = excluded.next_no,
          next_order_no = excluded.next_order_no, updated_by = excluded.updated_by, updated_at = now()
  `);
  await auditQuietly({
    action: "delivery.series.updated",
    operation: "UPDATE",
    entityType: "delivery_series",
    entityId: String(importerId),
    before: { prefix: current.prefix, nextNo: current.nextNo, orderPrefix: current.orderPrefix, nextOrderNo: current.nextOrderNo },
    after: { prefix, nextNo, orderPrefix, nextOrderNo },
    ...auditBase(actor, meta),
  });
  return getSeries(actor, importerId);
}

// ── Trusted sales agents ──────────────────────────────────────────

export async function setAutoApprove(actor: Actor, agentId: number, on: boolean, meta: Meta) {
  const rows = await getDb().execute<{ importer_id: number; name: string; auto_approve: boolean }>(sql`
    select importer_id, trim(first_name || ' ' || coalesce(last_name, '')) as name, auto_approve
      from wms.sales_agent where id = ${agentId} and deleted_at is null
  `);
  const a = rows[0];
  if (!a) throw new InwardError("NOT_FOUND", "No such sales agent");
  const g = grantFor(actor, "sales_agent.update");
  const allowed = isImporterOf(actor, Number(a.importer_id)) || g?.scope === "ALL";
  if (!allowed || isAgentOnly(actor)) throw new InwardError("FORBIDDEN", "Only the importer decides which agents are trusted.");
  await getDb().execute(sql`
    update wms.sales_agent
       set auto_approve = ${on}, auto_approve_set_by = ${actor.session.userId}, auto_approve_set_at = now(), updated_at = now()
     where id = ${agentId}
  `);
  await auditQuietly({
    action: "delivery.agent.auto_approve",
    operation: "UPDATE",
    entityType: "sales_agent",
    entityId: String(agentId),
    entityLabel: a.name,
    before: { autoApprove: Boolean(a.auto_approve) },
    after: { autoApprove: on },
    ...auditBase(actor, meta),
  });
  return { id: agentId, autoApprove: on };
}

// ── Notifications ─────────────────────────────────────────────────

async function tell(eventKey: string, n: NoteSummary, actor: Actor, meta: Meta, extra: Record<string, string> = {}) {
  try {
    await announce({
      eventKey,
      values: {
        id: String(n.id),
        dn: n.dnNo,
        buyer: n.buyerName,
        cartons: String(n.cartons),
        warehouse: n.warehouseName,
        agent: n.createdByName,
        how: "",
        reason: "",
        by: who(actor),
        status: STATUS_LABEL[n.status] ?? n.status,
        ...extra,
      },
      dedupeSuffix: `delivery_note:${n.id}:${eventKey}:${Date.now()}`,
      actorUserId: actor.session.userId,
      subjectUserId: n.createdBy,
      skipActor: true,
      entityType: "delivery_note",
      entityId: String(n.id),
      importerId: n.importerId,
      warehouseId: n.warehouseId,
      correlationId: meta.requestId,
    });
  } catch (error) {
    console.error("[delivery] announce failed", { requestId: meta.requestId, eventKey, error: String(error) });
  }
}
