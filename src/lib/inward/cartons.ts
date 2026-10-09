import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { auditQuietly } from "@/lib/audit";
import type { Actor } from "@/lib/auth/guard";
import { announce } from "@/lib/notify/announce";
import { configured, publicUrl, putObject } from "@/lib/storage/bunny";
import { cartonNoFromScan, qrText, type LabelData } from "@/lib/inward/carton-format";
import {
  headerOf,
  InwardError,
  sniffDocument,
  STATUS_LABEL,
  tell,
  visibleHeader,
  type HeaderRow,
  type InwardScope,
  type InwardStatus,
  type Meta,
} from "@/lib/inward/ops";

/**
 * Cartons: a number and a QR sticker for every carton of an inward
 * request, and the scan that receives it at the dock.
 *
 * Who: `inward.goods` — the super admin (ALL), and the warehouse admin and
 * inward manager of the request's own warehouse (WAREHOUSE). Nobody on the
 * importer side sees any of this.
 *
 * When: from the moment the warehouse acknowledges the request until it
 * is completed. Generating needs the vehicle and driver, because they are
 * printed into every QR.
 */

const WORKING: InwardStatus[] = ["ACKNOWLEDGED", "IN_PROCESS"];

export type CartonCan = { view: boolean; generate: boolean; work: boolean };

/** Whether this actor may see / generate / print-and-scan cartons on this row. */
export function cartonCan(actor: Actor, row: { status: InwardStatus; warehouseId: number }): CartonCan {
  const covers = (permission: string) =>
    actor.permissions.some(
      (p) =>
        p.permission === permission &&
        (p.scope === "ALL" || (p.scope === "WAREHOUSE" && p.warehouseIds.includes(row.warehouseId))),
    );
  const working = WORKING.includes(row.status);
  const update = covers("inward.goods.update");
  return {
    view: update && (working || row.status === "COMPLETED"),
    generate: covers("inward.goods.create") && working,
    work: update && working,
  };
}

// ── Reading ───────────────────────────────────────────────────────

export type CartonLine = {
  lineId: number;
  itemCode: string | null;
  description: string;
  imageUrl: string | null;
  cartonQty: number;
  unitCode: string | null;
  piecesPerCarton: number;
  kgPerCarton: number;
  from: string | null;
  to: string | null;
  generated: number;
  printed: number;
  received: number;
  hold: number;
};

export type CartonTotals = {
  declared: number;
  generated: number;
  printed: number;
  printPending: number;
  received: number;
  hold: number;
  labelPending: number;
  missing: number;
};

export type ScanRow = {
  id: number;
  at: string;
  cartonNo: string | null;
  code: string;
  result: string;
  via: string;
  by: string | null;
  note: string | null;
};

export type CartonOverview = {
  request: { id: number; code: string; status: InwardStatus; statusLabel: string; importer: string; warehouse: string };
  ready: { vehicle: boolean; driver: boolean };
  can: CartonCan & { finish: boolean };
  totals: CartonTotals;
  lines: CartonLine[];
  recent: ScanRow[];
};

async function totalsOf(id: number): Promise<{ totals: CartonTotals; lines: CartonLine[] }> {
  const rows = await getDb().execute<{
    line_id: number;
    item_code: string | null;
    description: string;
    image_url: string | null;
    carton_qty: number;
    unit_code: string | null;
    pieces_per_carton: number;
    kg_per_carton: string;
    from_no: string | null;
    to_no: string | null;
    generated: string;
    printed: string;
    received: string;
    hold: string;
    label_pending: string;
    print_pending: string;
  }>(sql`
    select li.id as line_id, li.item_code, li.description, li.image_url, li.carton_qty, li.unit_code,
           li.pieces_per_carton, li.kg_per_carton::text,
           (array_agg(c.carton_no order by c.seq))[1] as from_no,
           (array_agg(c.carton_no order by c.seq desc))[1] as to_no,
           count(c.id)::text as generated,
           count(c.id) filter (where c.print_count > 0)::text as printed,
           count(c.id) filter (where c.status = 'RECEIVED')::text as received,
           count(c.id) filter (where c.status = 'HOLD')::text as hold,
           count(c.id) filter (where c.label_pending)::text as label_pending,
           count(c.id) filter (where c.print_count = 0)::text as print_pending
      from wms.inward_request_item li
      left join wms.inward_carton c on c.inward_request_item_id = li.id
     where li.inward_request_id = ${id}
     group by li.id
     order by li.sort_order, li.id
  `);
  const n = (v: string | number) => Number(v) || 0;
  const lines: CartonLine[] = rows.map((r) => ({
    lineId: Number(r.line_id),
    itemCode: r.item_code,
    description: r.description,
    imageUrl: r.image_url,
    cartonQty: n(r.carton_qty),
    unitCode: r.unit_code,
    piecesPerCarton: n(r.pieces_per_carton),
    kgPerCarton: n(r.kg_per_carton),
    from: r.from_no,
    to: r.to_no,
    generated: n(r.generated),
    printed: n(r.printed),
    received: n(r.received),
    hold: n(r.hold),
  }));
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((a, r) => a + n(r[k] as string), 0);
  const generated = sum("generated");
  const received = sum("received");
  const hold = sum("hold");
  return {
    lines,
    totals: {
      declared: lines.reduce((a, l) => a + l.cartonQty, 0),
      generated,
      printed: sum("printed"),
      printPending: sum("print_pending"),
      received,
      hold,
      labelPending: sum("label_pending"),
      missing: generated - received - hold,
    },
  };
}

async function recentScans(id: number, limit = 20): Promise<ScanRow[]> {
  const rows = await getDb().execute<{
    id: number;
    at: string;
    carton_no: string | null;
    code: string;
    result: string;
    via: string;
    by: string | null;
    note: string | null;
  }>(sql`
    select s.id, s.scanned_at::text as at, c.carton_no, s.code, s.result, s.via, s.note,
           trim(u.first_name || ' ' || coalesce(u.last_name, '')) as by
      from wms.inward_scan s
      left join wms.inward_carton c on c.id = s.carton_id
      left join wms.users u on u.id = s.scanned_by
     where s.inward_request_id = ${id}
     order by s.scanned_at desc, s.id desc
     limit ${limit}
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    at: r.at,
    cartonNo: r.carton_no,
    code: r.code.length > 40 ? `${r.code.slice(0, 39)}…` : r.code,
    result: r.result,
    via: r.via,
    by: r.by,
    note: r.note,
  }));
}

function requestOf(row: HeaderRow) {
  return {
    id: Number(row.id),
    code: row.code,
    status: row.status,
    statusLabel: STATUS_LABEL[row.status],
    importer: row.importer_name,
    warehouse: row.warehouse_name,
  };
}

async function visibleFor(actor: Actor, scope: InwardScope, id: number, need: keyof CartonCan) {
  const row = await visibleHeader(scope, id);
  const can = cartonCan(actor, { status: row.status, warehouseId: Number(row.warehouse_id) });
  if (!can[need]) {
    const why =
      need === "view"
        ? "Cartons are not available for this request"
        : `Cartons can be ${need === "generate" ? "generated" : "printed and scanned"} once the warehouse has acknowledged the request, and until it is completed`;
    throw new InwardError(need === "view" ? "NOT_FOUND" : "CONFLICT", why);
  }
  return { row, can };
}

export async function cartonOverview(actor: Actor, scope: InwardScope, id: number): Promise<CartonOverview> {
  const { row, can } = await visibleFor(actor, scope, id, "view");
  const [{ totals, lines }, recent] = await Promise.all([totalsOf(id), recentScans(id)]);
  return {
    request: requestOf(row),
    ready: { vehicle: row.vehicle_id !== null, driver: row.driver_id !== null },
    can: { ...can, finish: can.work && totals.generated > 0 },
    totals,
    lines,
    recent,
  };
}

// ── Sticker data ─────────────────────────────────────────────────

export type CartonLabel = LabelData & {
  id: number;
  lineId: number;
  status: string;
  printCount: number;
  labelPending: boolean;
  qr: string;
};

export type LabelFilter =
  | { kind: "all" }
  | { kind: "pending" }
  | { kind: "label_pending" }
  | { kind: "line"; lineId: number }
  | { kind: "ids"; ids: number[] }
  | { kind: "range"; from: number; to: number };

/**
 * The cartons to print (or to keep on a phone for offline checking), each
 * with everything its sticker shows and the exact text of its QR.
 */
export async function cartonLabels(
  actor: Actor,
  scope: InwardScope,
  id: number,
  filter: LabelFilter = { kind: "all" },
): Promise<{ total: number; labels: CartonLabel[] }> {
  const { row } = await visibleFor(actor, scope, id, "view");
  const where =
    filter.kind === "pending"
      ? sql`and c.print_count = 0`
      : filter.kind === "label_pending"
        ? sql`and c.label_pending`
        : filter.kind === "line"
          ? sql`and c.inward_request_item_id = ${filter.lineId}`
          : filter.kind === "ids"
            ? filter.ids.length
              ? sql`and c.id in (${sql.join(filter.ids.map((x) => sql`${x}`), sql`, `)})`
              : sql`and false`
            : filter.kind === "range"
              ? sql`and c.seq between ${filter.from} and ${filter.to}`
              : sql``;
  const rows = await getDb().execute<{
    id: number;
    line_id: number;
    seq: number;
    carton_no: string;
    status: string;
    print_count: number;
    label_pending: boolean;
    item_code: string | null;
    description: string;
    pieces_per_carton: number;
    unit_code: string | null;
    kg_per_carton: string;
    importer_mobile: string | null;
    importer_email: string | null;
    logo_url: string | null;
    total: string;
  }>(sql`
    select c.id, c.inward_request_item_id as line_id, c.seq, c.carton_no, c.status, c.print_count, c.label_pending,
           li.item_code, li.description, li.pieces_per_carton, li.unit_code, li.kg_per_carton::text,
           i.contact_mobile::text as importer_mobile, i.contact_email::text as importer_email, i.logo_url,
           (select count(*) from wms.inward_carton x where x.inward_request_id = c.inward_request_id)::text as total
      from wms.inward_carton c
      join wms.inward_request_item li on li.id = c.inward_request_item_id
      join wms.inward_request r on r.id = c.inward_request_id
      join wms.importer i on i.id = r.importer_id
     where c.inward_request_id = ${id} ${where}
     order by c.seq
  `);
  const labels = rows.map((r) => {
    const data: LabelData = {
      cartonNo: r.carton_no,
      seq: Number(r.seq),
      total: Number(r.total),
      inwardCode: row.code,
      warehouseName: row.warehouse_name,
      importerName: row.importer_name,
      importerMobile: r.importer_mobile,
      importerEmail: r.importer_email,
      importerLogoUrl: r.logo_url,
      itemCode: r.item_code,
      description: r.description,
      piecesPerCarton: Number(r.pieces_per_carton),
      unitCode: r.unit_code,
      kgPerCarton: Number(r.kg_per_carton),
      vehicle: row.vehicle_registration,
      driverName: row.driver_name,
      driverMobile: row.driver_mobile,
    };
    return {
      ...data,
      id: Number(r.id),
      lineId: Number(r.line_id),
      status: r.status,
      printCount: Number(r.print_count),
      labelPending: Boolean(r.label_pending),
      qr: qrText(data),
    };
  });
  return { total: rows.length ? Number(rows[0]!.total) : 0, labels };
}

// ── Generating ────────────────────────────────────────────────────

/**
 * One carton row per declared carton, numbered in line order:
 * INR-000006-0001 … Lines that already have cartons are left alone, so
 * pressing it twice (or on a second phone) adds nothing.
 */
export async function generateCartons(actor: Actor, scope: InwardScope, id: number, meta: Meta) {
  const { row } = await visibleFor(actor, scope, id, "generate");
  if (row.vehicle_id === null || row.driver_id === null) {
    throw new InwardError(
      "VALIDATION_FAILED",
      "Add the vehicle and the driver first — they are printed in every QR",
      { ...(row.vehicle_id === null ? { vehicleId: "Required" } : {}), ...(row.driver_id === null ? { driverId: "Required" } : {}) },
    );
  }
  const db = getDb();
  let made = 0;
  try {
    const out = await db.execute<{ n: string }>(sql`
      with base as (
        select coalesce(max(seq), 0) as b from wms.inward_carton where inward_request_id = ${id}
      ),
      todo as (
        select li.id, li.carton_qty,
               coalesce(sum(li.carton_qty) over (order by li.sort_order, li.id
                         rows between unbounded preceding and 1 preceding), 0) as off
          from wms.inward_request_item li
         where li.inward_request_id = ${id}
           and not exists (select 1 from wms.inward_carton c where c.inward_request_item_id = li.id)
      ),
      put as (
        insert into wms.inward_carton (inward_request_id, inward_request_item_id, seq, carton_no, created_by)
        select ${id}, t.id, base.b + t.off + g,
               ${row.code} || '-' || lpad((base.b + t.off + g)::text, greatest(4, length((base.b + t.off + g)::text)), '0'),
               ${actor.session.userId}
          from todo t cross join base cross join lateral generate_series(1, t.carton_qty) as g
        returning 1
      )
      select count(*)::text as n from put
    `);
    made = Number(out[0]?.n ?? 0);
  } catch (error) {
    // Two people pressing Generate together: the unique index stops the
    // second; what the first made is the answer.
    if (!String(error).includes("unique")) throw error;
  }
  if (made > 0) {
    await auditQuietly({
      action: "inward.cartons.generated",
      operation: "INSERT",
      entityType: "inward_request",
      entityId: String(id),
      entityLabel: row.code,
      actorUserId: actor.session.userId,
      actorEmail: actor.session.email,
      actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
      after: { cartons: made },
      ip: meta.ip,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    });
  }
  return { made, overview: await cartonOverview(actor, scope, id) };
}

// ── Printing ──────────────────────────────────────────────────────

/** The print button was pressed for these cartons: count it. A reprint
 *  keeps the number and adds one to print_count. */
export async function markPrinted(actor: Actor, scope: InwardScope, id: number, ids: number[], meta: Meta) {
  const { row } = await visibleFor(actor, scope, id, "work");
  if (ids.length === 0) return cartonOverview(actor, scope, id);
  const by = actor.session.userId;
  const out = await getDb().execute<{ id: number; reprint: boolean }>(sql`
    update wms.inward_carton
       set print_count = print_count + 1,
           status = case when status = 'GENERATED' then 'PRINTED' else status end,
           first_printed_at = coalesce(first_printed_at, now()),
           first_printed_by = coalesce(first_printed_by, ${by}),
           last_printed_at = now(), last_printed_by = ${by}, updated_at = now()
     where inward_request_id = ${id} and id in (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})
    returning id, print_count > 1 as reprint
  `);
  const reprints = out.filter((r) => r.reprint).length;
  await auditQuietly({
    action: reprints ? "inward.cartons.reprinted" : "inward.cartons.printed",
    operation: "UPDATE",
    entityType: "inward_request",
    entityId: String(id),
    entityLabel: row.code,
    actorUserId: by,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    after: { printed: out.length, reprints },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
  return cartonOverview(actor, scope, id);
}

// ── Scanning ──────────────────────────────────────────────────────

export type ScanInput = {
  code: string;
  clientScanId?: string | null;
  via?: "SCAN" | "MANUAL";
  device?: string | null;
};

export type ScanResult = {
  clientScanId: string | null;
  code: string;
  cartonNo: string | null;
  result: "RECEIVED" | "DUPLICATE" | "OTHER_REQUEST" | "UNKNOWN";
  message: string;
  labelConfirmed?: boolean;
  carton?: { id: number; seq: number; itemCode: string | null; description: string; piecesPerCarton: number; unitCode: string | null };
  previous?: { at: string | null; by: string | null; status: string };
};

type CartonHit = {
  id: number;
  inward_request_id: number;
  request_code: string;
  seq: number;
  carton_no: string;
  status: string;
  label_pending: boolean;
  received_at: string | null;
  received_by_name: string | null;
  hold_reason: string | null;
  item_code: string | null;
  description: string;
  pieces_per_carton: number;
  unit_code: string | null;
};

async function findCarton(no: string): Promise<CartonHit | null> {
  const rows = await getDb().execute<CartonHit>(sql`
    select c.id, c.inward_request_id, r.code as request_code, c.seq, c.carton_no, c.status, c.label_pending,
           c.received_at::text, trim(u.first_name || ' ' || coalesce(u.last_name, '')) as received_by_name,
           c.hold_reason, li.item_code, li.description, li.pieces_per_carton, li.unit_code
      from wms.inward_carton c
      join wms.inward_request r on r.id = c.inward_request_id
      join wms.inward_request_item li on li.id = c.inward_request_item_id
      left join wms.users u on u.id = c.received_by
     where c.carton_no = ${no}
  `);
  return rows[0] ?? null;
}

/**
 * A batch of scans, in the order they happened. Phones send them in
 * bursts (and again after being offline); the client's own id makes a
 * resend harmless — the stored result is handed back instead.
 */
export async function recordScans(actor: Actor, scope: InwardScope, id: number, scans: ScanInput[], meta: Meta) {
  const { row } = await visibleFor(actor, scope, id, "work");
  const db = getDb();
  const by = actor.session.userId;
  const results: ScanResult[] = [];
  let received = 0;

  for (const s of scans) {
    const clientScanId = s.clientScanId?.slice(0, 80) || null;
    const via = s.via === "MANUAL" ? "MANUAL" : "SCAN";
    const code = s.code.slice(0, 1000);
    const no = cartonNoFromScan(code);

    if (clientScanId) {
      const seen = await db.execute<{ result: string; note: string | null; carton_no: string | null }>(sql`
        select s.result, s.note, c.carton_no from wms.inward_scan s
          left join wms.inward_carton c on c.id = s.carton_id
         where s.client_scan_id = ${clientScanId}
      `);
      if (seen[0]) {
        results.push({
          clientScanId,
          code,
          cartonNo: seen[0].carton_no ?? no,
          result: seen[0].result as ScanResult["result"],
          message: seen[0].note ?? "Already recorded",
        });
        continue;
      }
    }

    const log = async (result: string, cartonId: number | null, note: string) => {
      await db.execute(sql`
        insert into wms.inward_scan (inward_request_id, carton_id, code, result, via, client_scan_id, device, note, scanned_by)
        values (${id}, ${cartonId}, ${code}, ${result}, ${via}, ${clientScanId}, ${s.device?.slice(0, 80) ?? null}, ${note}, ${by})
        on conflict (client_scan_id) do nothing
      `);
    };

    const hit = no ? await findCarton(no) : null;
    if (!hit) {
      const message = no ? `${no} is not a carton in the system` : "That is not a carton QR code";
      await log("UNKNOWN", null, message);
      results.push({ clientScanId, code, cartonNo: no, result: "UNKNOWN", message });
      continue;
    }
    const carton = {
      id: Number(hit.id),
      seq: Number(hit.seq),
      itemCode: hit.item_code,
      description: hit.description,
      piecesPerCarton: Number(hit.pieces_per_carton),
      unitCode: hit.unit_code,
    };
    if (Number(hit.inward_request_id) !== id) {
      const message = `This carton belongs to ${hit.request_code}, not ${row.code}`;
      await log("OTHER_REQUEST", Number(hit.id), message);
      results.push({ clientScanId, code, cartonNo: hit.carton_no, result: "OTHER_REQUEST", message, carton });
      continue;
    }

    // First scan wins: only a carton still waiting moves to RECEIVED.
    const won = await db.execute<{ id: number }>(sql`
      update wms.inward_carton
         set status = 'RECEIVED', received_at = now(), received_by = ${by}, received_via = ${via},
             received_device = ${s.device?.slice(0, 80) ?? null},
             label_pending = ${via === "MANUAL"}, updated_at = now()
       where id = ${hit.id} and status in ('GENERATED','PRINTED')
      returning id
    `);
    if (won[0]) {
      received += 1;
      const message = via === "MANUAL" ? "Received — label to be printed" : "Received";
      await log("RECEIVED", Number(hit.id), message);
      results.push({ clientScanId, code, cartonNo: hit.carton_no, result: "RECEIVED", message, carton });
      continue;
    }

    // Received earlier by typing the number: this scan proves the sticker
    // is on now. Not counted again.
    if (hit.status === "RECEIVED" && hit.label_pending && via === "SCAN") {
      await db.execute(sql`update wms.inward_carton set label_pending = false, updated_at = now() where id = ${hit.id}`);
      await log("RECEIVED", Number(hit.id), "Label confirmed");
      results.push({ clientScanId, code, cartonNo: hit.carton_no, result: "RECEIVED", message: "Label confirmed", labelConfirmed: true, carton });
      continue;
    }

    const fresh = (await findCarton(hit.carton_no))!;
    const message =
      fresh.status === "HOLD"
        ? `Already scanned — on hold: ${fresh.hold_reason ?? ""}`.trim()
        : `Already scanned${fresh.received_by_name ? ` by ${fresh.received_by_name}` : ""}`;
    await log("DUPLICATE", Number(hit.id), message);
    results.push({
      clientScanId,
      code,
      cartonNo: hit.carton_no,
      result: "DUPLICATE",
      message,
      carton,
      previous: { at: fresh.received_at, by: fresh.received_by_name, status: fresh.status },
    });
  }

  // The first carton through the door: the request is in process.
  if (received > 0 && row.status === "ACKNOWLEDGED") await markInProcess(actor, row, meta);

  return { results, overview: await cartonOverview(actor, scope, id) };
}

async function markInProcess(actor: Actor, row: HeaderRow, meta: Meta) {
  const by = actor.session.userId;
  const moved = await getDb().execute<{ id: number }>(sql`
    update wms.inward_request
       set status = 'IN_PROCESS', last_status_by = ${by}, last_status_at = now(), updated_by = ${by}
     where id = ${row.id} and status = 'ACKNOWLEDGED'
    returning id
  `);
  if (!moved[0]) return;
  await auditQuietly({
    action: "inward.request.in_process",
    operation: "UPDATE",
    entityType: "inward_request",
    entityId: String(row.id),
    entityLabel: row.code,
    actorUserId: by,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    before: { status: "ACKNOWLEDGED" },
    after: { status: "IN_PROCESS", reason: "first carton scanned" },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
  const fresh = await headerOf(Number(row.id));
  if (fresh) await tell("inward.request_status", fresh, actor, meta, { statusLabel: STATUS_LABEL.IN_PROCESS.toLowerCase() });
}

// ── Hold and release ──────────────────────────────────────────────

export const HOLD_REASONS = ["Damaged", "Short quantity", "Wrong item", "Wet", "Weight mismatch", "Other"] as const;

async function cartonIn(id: number, cartonId: number) {
  const rows = await getDb().execute<{ id: number; carton_no: string; status: string; hold_photo_url: string | null }>(sql`
    select id, carton_no, status, hold_photo_url from wms.inward_carton where id = ${cartonId} and inward_request_id = ${id}
  `);
  if (!rows[0]) throw new InwardError("NOT_FOUND", "No such carton on this request");
  return rows[0];
}

/** Put a carton aside — damaged, short, wrong item… The warehouse side
 *  and the super admins hear about it. */
export async function holdCarton(
  actor: Actor,
  scope: InwardScope,
  id: number,
  cartonId: number,
  reason: string,
  note: string | null,
  meta: Meta,
) {
  const { row } = await visibleFor(actor, scope, id, "work");
  const c = await cartonIn(id, cartonId);
  const by = actor.session.userId;
  await getDb().execute(sql`
    update wms.inward_carton
       set status = 'HOLD', hold_reason = ${reason}, hold_note = ${note}, hold_at = now(), hold_by = ${by},
           updated_at = now()
     where id = ${cartonId}
  `);
  await getDb().execute(sql`
    insert into wms.inward_scan (inward_request_id, carton_id, code, result, via, note, scanned_by)
    values (${id}, ${cartonId}, ${c.carton_no}, 'HOLD', 'MANUAL', ${[reason, note].filter(Boolean).join(" — ")}, ${by})
  `);
  await auditQuietly({
    action: "inward.carton.hold",
    operation: "UPDATE",
    entityType: "inward_carton",
    entityId: String(cartonId),
    entityLabel: c.carton_no,
    actorUserId: by,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    before: { status: c.status },
    after: { status: "HOLD", reason, note },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
  try {
    await announce({
      eventKey: "inward.carton_hold",
      values: {
        id: String(row.id),
        code: row.code,
        company: row.importer_name,
        carton: c.carton_no,
        reason,
        noteSuffix: note ? ` — ${note}` : "",
      },
      dedupeSuffix: `inward_carton:${cartonId}:hold:${Date.now()}`,
      actorUserId: by,
      skipActor: true,
      entityType: "inward_request",
      entityId: String(row.id),
      importerId: Number(row.importer_id),
      warehouseId: Number(row.warehouse_id),
      correlationId: meta.requestId,
    });
  } catch (error) {
    console.error("[cartons] hold announce failed", { requestId: meta.requestId, error: String(error) });
  }
  return cartonOverview(actor, scope, id);
}

/** The problem is sorted: take the carton in after all. */
export async function releaseCarton(actor: Actor, scope: InwardScope, id: number, cartonId: number, meta: Meta) {
  const { row } = await visibleFor(actor, scope, id, "work");
  const c = await cartonIn(id, cartonId);
  if (c.status !== "HOLD") throw new InwardError("CONFLICT", "That carton is not on hold");
  const by = actor.session.userId;
  await getDb().execute(sql`
    update wms.inward_carton
       set status = 'RECEIVED', received_at = coalesce(received_at, now()), received_by = coalesce(received_by, ${by}),
           received_via = coalesce(received_via, 'MANUAL'),
           hold_reason = null, hold_note = null, hold_at = null, hold_by = null, updated_at = now()
     where id = ${cartonId}
  `);
  await getDb().execute(sql`
    insert into wms.inward_scan (inward_request_id, carton_id, code, result, via, note, scanned_by)
    values (${id}, ${cartonId}, ${c.carton_no}, 'RELEASED', 'MANUAL', 'Released from hold', ${by})
  `);
  await auditQuietly({
    action: "inward.carton.released",
    operation: "UPDATE",
    entityType: "inward_carton",
    entityId: String(cartonId),
    entityLabel: c.carton_no,
    actorUserId: by,
    actorEmail: actor.session.email,
    actorName: `${actor.session.firstName} ${actor.session.lastName}`.trim(),
    before: { status: "HOLD" },
    after: { status: "RECEIVED" },
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
  if (row.status === "ACKNOWLEDGED") await markInProcess(actor, row, meta);
  return cartonOverview(actor, scope, id);
}

/** A photo of the damage, on a carton that is on hold. */
export async function setHoldPhoto(actor: Actor, scope: InwardScope, id: number, cartonId: number, bytes: Uint8Array) {
  await visibleFor(actor, scope, id, "work");
  const c = await cartonIn(id, cartonId);
  if (c.status !== "HOLD") throw new InwardError("CONFLICT", "Put the carton on hold first");
  if (bytes.length > 3 * 1024 * 1024) throw new InwardError("VALIDATION_FAILED", "That photo is over 3 MB");
  const { type, ext } = sniffDocument(bytes);
  if (type === "application/pdf") throw new InwardError("VALIDATION_FAILED", "Send a photo");
  if (!configured()) throw new InwardError("CONFLICT", "Image storage is not configured on this environment");
  const key = `cartons/${id}/${c.carton_no}-${randomBytes(4).toString("hex")}.${ext}`;
  const put = await putObject(key, bytes, type);
  if (!put.ok) throw new InwardError("INTERNAL", "The photo could not be stored. Try again.");
  const url = publicUrl(key);
  await getDb().execute(sql`update wms.inward_carton set hold_photo_url = ${url}, updated_at = now() where id = ${cartonId}`);
  return { url };
}

/** The cartons on hold, with what is wrong — for the manager to sort out. */
export async function holdList(actor: Actor, scope: InwardScope, id: number) {
  await visibleFor(actor, scope, id, "view");
  const rows = await getDb().execute<{
    id: number;
    carton_no: string;
    item_code: string | null;
    description: string;
    hold_reason: string | null;
    hold_note: string | null;
    hold_photo_url: string | null;
    hold_at: string | null;
    by: string | null;
  }>(sql`
    select c.id, c.carton_no, li.item_code, li.description, c.hold_reason, c.hold_note, c.hold_photo_url,
           c.hold_at::text, trim(u.first_name || ' ' || coalesce(u.last_name, '')) as by
      from wms.inward_carton c
      join wms.inward_request_item li on li.id = c.inward_request_item_id
      left join wms.users u on u.id = c.hold_by
     where c.inward_request_id = ${id} and c.status = 'HOLD'
     order by c.seq
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    cartonNo: r.carton_no,
    itemCode: r.item_code,
    description: r.description,
    reason: r.hold_reason,
    note: r.hold_note,
    photoUrl: r.hold_photo_url,
    at: r.hold_at,
    by: r.by,
  }));
}

// ── Guards used by the request flow ──────────────────────────────

/** True once anything physical has happened to a carton of this request
 *  (a sticker printed, a carton received or held). From then on the
 *  goods list is fixed: no sending it back, no moving it. */
export async function cartonsLocked(id: number): Promise<boolean> {
  const rows = await getDb().execute<{ locked: boolean }>(sql`
    select exists(
      select 1 from wms.inward_carton
       where inward_request_id = ${id} and (status <> 'GENERATED' or print_count > 0)
    ) as locked
  `);
  return Boolean(rows[0]?.locked);
}

/** Numbers made but never printed go when the request is sent back —
 *  the importer may change the lines. */
export async function dropUnprintedCartons(id: number): Promise<void> {
  await getDb().execute(sql`
    delete from wms.inward_carton where inward_request_id = ${id} and status = 'GENERATED' and print_count = 0
  `);
}
