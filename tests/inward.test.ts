import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { Actor, Grant } from "@/lib/auth/guard";
import { canDo, scopeFor, sniffDocument, submitRequirements, InwardError } from "@/lib/inward/ops";
import {
  containerNumber,
  inwardDecisionSchema,
  inwardSaveSchema,
  proposeSchema,
} from "@/lib/validation/api-inward";

vi.mock("server-only", () => ({}));

/**
 * Inward requests — the importer telling the warehouse what is coming.
 *
 * What is pinned here is the part that would be silent if it broke:
 * who may do what to a request in each status, that the dock's scope is
 * the actor's own sites and the importer's is their own company, that
 * a submit names every missing field, and that the SQL file carries
 * the grants the two sides depend on.
 */

const actorWith = (
  roles: { role: string; importerId?: number | null; warehouseId?: number | null }[],
  permissions: { permission: string; scope: "OWN" | "WAREHOUSE" | "ALL"; warehouseIds?: number[] }[],
) =>
  ({
    session: { userId: 77, email: "x@test.invalid", firstName: "X", lastName: "Y" },
    roles: roles.map((r) => ({ importerId: null, warehouseId: null, ...r })),
    permissions: permissions.map((p) => ({ warehouseIds: [], importerIds: [], ...p })),
    isSuperAdmin: false,
  }) as unknown as Actor;

const importer = actorWith(
  [{ role: "IMPORTER", importerId: 12 }],
  [
    { permission: "inward.request.read", scope: "OWN" },
    { permission: "inward.request.update", scope: "OWN" },
    { permission: "inward.request.delete", scope: "OWN" },
  ],
);
const otherImporter = actorWith(
  [{ role: "IMPORTER", importerId: 99 }],
  [
    { permission: "inward.request.update", scope: "OWN" },
    { permission: "inward.request.delete", scope: "OWN" },
  ],
);
const dock = actorWith(
  [{ role: "INWARD_MANAGER", warehouseId: 5 }],
  [
    { permission: "inward.request.read", scope: "WAREHOUSE", warehouseIds: [5] },
    { permission: "inward.request.approve", scope: "WAREHOUSE", warehouseIds: [5] },
  ],
);
const otherDock = actorWith(
  [{ role: "INWARD_MANAGER", warehouseId: 6 }],
  [{ permission: "inward.request.approve", scope: "WAREHOUSE", warehouseIds: [6] }],
);
const admin = actorWith(
  [{ role: "SUPER_ADMIN" }],
  [
    { permission: "inward.request.update", scope: "ALL" },
    { permission: "inward.request.delete", scope: "ALL" },
    { permission: "inward.request.approve", scope: "ALL" },
  ],
);

const row = (status: string) => ({ status: status as never, importerId: 12, warehouseId: 5 });

describe("the state machine", () => {
  it("lets the importer edit, submit and cancel a draft — and nothing of the dock's", () => {
    const can = canDo(importer, row("DRAFT"));
    expect(can).toMatchObject({ edit: true, submit: true, cancel: true, acknowledge: false, needs_changes: false, in_process: false, complete: false });
  });

  it("freezes a submitted request for the importer except cancel", () => {
    expect(canDo(importer, row("SUBMITTED"))).toMatchObject({ edit: false, submit: false, cancel: true });
  });

  it("gives the dock acknowledge and send-back on a submitted request, never edit", () => {
    expect(canDo(dock, row("SUBMITTED"))).toMatchObject({ acknowledge: true, needs_changes: true, in_process: false, complete: false, edit: false, cancel: false });
  });

  it("a sent-back request is the importer's again", () => {
    expect(canDo(importer, row("NEEDS_CHANGES"))).toMatchObject({ edit: true, submit: true, cancel: true });
    expect(canDo(dock, row("NEEDS_CHANGES"))).toMatchObject({ acknowledge: false, needs_changes: false });
  });

  it("walks acknowledged → in process → completed on the dock side only", () => {
    expect(canDo(dock, row("ACKNOWLEDGED"))).toMatchObject({ in_process: true, complete: true, needs_changes: true, acknowledge: false });
    expect(canDo(dock, row("IN_PROCESS"))).toMatchObject({ complete: true, in_process: false });
    expect(canDo(dock, row("COMPLETED"))).toMatchObject({ complete: false, in_process: false, needs_changes: false });
    expect(canDo(importer, row("ACKNOWLEDGED"))).toMatchObject({ edit: false, cancel: false, submit: false });
  });

  it("another importer's grant does not reach this company's request", () => {
    expect(Object.values(canDo(otherImporter, row("DRAFT"))).some(Boolean)).toBe(false);
  });

  it("another site's dock manager does not reach this warehouse's request", () => {
    expect(Object.values(canDo(otherDock, row("SUBMITTED"))).some(Boolean)).toBe(false);
  });

  it("ALL covers both sides", () => {
    expect(canDo(admin, row("DRAFT"))).toMatchObject({ edit: true, cancel: true });
    expect(canDo(admin, row("SUBMITTED"))).toMatchObject({ acknowledge: true, needs_changes: true });
  });

  it("nothing is possible on a cancelled request", () => {
    expect(Object.values(canDo(admin, row("CANCELLED"))).some(Boolean)).toBe(false);
  });
});

describe("scope", () => {
  const own: Grant = { permission: "inward.request.read", scope: "OWN", warehouseIds: [], importerIds: [] } as Grant;
  const wh: Grant = { permission: "inward.request.read", scope: "WAREHOUSE", warehouseIds: [5], importerIds: [] } as Grant;
  const all: Grant = { permission: "inward.request.read", scope: "ALL", warehouseIds: [], importerIds: [] } as Grant;

  it("the importer side is the actor's own company, whatever the request asks for", () => {
    expect(scopeFor(importer, own, { importerId: 99 })).toEqual({ side: "importer", importerId: 12 });
  });

  it("the dock side is the actor's own sites, from their assignments", () => {
    expect(scopeFor(dock, wh)).toEqual({ side: "warehouse", warehouseIds: [5] });
  });

  it("ALL may narrow by either id", () => {
    expect(scopeFor(admin, all, { importerId: 3, warehouseId: 4 })).toEqual({ side: "all", importerId: 3, warehouseId: 4 });
  });

  it("an OWN grant with no importer binding is refused, not widened", () => {
    const stray = actorWith([{ role: "STORAGE_MANAGER", warehouseId: 5 }], []);
    expect(() => scopeFor(stray, own)).toThrow(InwardError);
  });
});

describe("submit", () => {
  it("names every missing field, so the form can jump to it", () => {
    const missing = submitRequirements({
      containerNumber: null,
      containerTypeId: null,
      portId: 1,
      expectedArrival: null,
      transporterId: 1,
      vehicleId: null,
      driverId: null,
      lines: 0,
    });
    expect(Object.keys(missing).sort()).toEqual(
      ["containerNumber", "containerTypeId", "driverId", "expectedArrival", "items", "vehicleId"].sort(),
    );
  });

  it("is satisfied by a whole request", () => {
    expect(
      submitRequirements({
        containerNumber: "TCLU1234567",
        containerTypeId: 3,
        portId: 1,
        expectedArrival: "2026-10-15",
        transporterId: 1,
        vehicleId: 1,
        driverId: 1,
        lines: 2,
      }),
    ).toEqual({});
  });
});

describe("schemas", () => {
  it("upper-cases and checks the container number shape", () => {
    expect(containerNumber.parse(" tclu1234567 ")).toBe("TCLU1234567");
    expect(containerNumber.safeParse("TCLU12345").success).toBe(false);
    expect(containerNumber.safeParse("12345678901").success).toBe(false);
  });

  it("a draft may be nearly empty, but a line must add up", () => {
    expect(inwardSaveSchema.safeParse({ warehouseId: 5 }).success).toBe(true);
    const bad = inwardSaveSchema.safeParse({
      warehouseId: 5,
      items: [{ description: "x", cartonQty: 0, piecesPerCarton: 24, kgPerCarton: 8 }],
    });
    expect(bad.success).toBe(false);
    const good = inwardSaveSchema.safeParse({
      warehouseId: 5,
      containerNumber: "",
      items: [{ description: "Bottles", cartonQty: 100, piecesPerCarton: 24, unitId: 1, kgPerCarton: 8 }],
    });
    expect(good.success).toBe(true);
    if (good.success) expect(good.data.containerNumber).toBeNull();
  });

  it("a decision is one of four moves", () => {
    expect(inwardDecisionSchema.safeParse({ action: "ACKNOWLEDGE" }).success).toBe(true);
    expect(inwardDecisionSchema.safeParse({ action: "REJECT" }).success).toBe(false);
  });

  it("a proposal is discriminated on kind and normalises the plate", () => {
    const v = proposeSchema.safeParse({
      kind: "vehicle",
      transporterId: 1,
      vehicleTypeId: 2,
      registrationNumber: "mh 12 ab 1234",
    });
    expect(v.success).toBe(true);
    if (v.success && v.data.kind === "vehicle") expect(v.data.registrationNumber).toBe("MH12AB1234");
    expect(proposeSchema.safeParse({ kind: "driver", transporterId: 1, name: "R", mobile: "123", licenceNumber: "X" }).success).toBe(false);
  });
});

describe("documents", () => {
  it("trusts the bytes, not the header", () => {
    expect(sniffDocument(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])).type).toBe("application/pdf");
    expect(sniffDocument(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])).type).toBe("image/jpeg");
    expect(sniffDocument(new Uint8Array([0x89, 0x50, 0x4e, 0x47])).type).toBe("image/png");
    expect(() => sniffDocument(new Uint8Array([0x00, 0x01, 0x02]))).toThrow(InwardError);
    // RIFF alone is not WebP.
    expect(() => sniffDocument(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]))).toThrow(InwardError);
  });
});

describe("the SQL pack", () => {
  const sql = readFileSync(new URL("../../sql/29_inward_request.sql", import.meta.url), "utf8");

  it("gives the importer side back the carrier register to read", () => {
    expect(sql).toMatch(/\('IMPORTER',\s+'transporter\.read',\s+'ALL'\)/);
    expect(sql).toMatch(/\('SALES_AGENT',\s+'vehicle\.read',\s+'ALL'\)/);
  });

  it("keeps the request's own permission apart from inward.goods", () => {
    expect(sql).toMatch(/'inward\.request'/);
    expect(sql).not.toMatch(/delete from role_permission[\s\S]*inward\.goods/);
  });

  it("routes a submission to the target site's inward manager and the decisions back to the importer", () => {
    expect(sql).toMatch(/'inward\.request_submitted',\s+'WAREHOUSE_ROLE',\s+'INWARD_MANAGER'/);
    expect(sql).toMatch(/'inward\.request_acknowledged',\s+'IMPORTER_ROLE',\s+'IMPORTER'/);
    expect(sql).toMatch(/'inward\.request_needs_changes',\s+'IMPORTER_ROLE',\s+'IMPORTER'/);
  });

  it("generates the totals in the database", () => {
    expect(sql).toMatch(/total_pieces\s+integer generated always as \(carton_qty \* pieces_per_carton\) stored/);
    expect(sql).toMatch(/total_kg\s+numeric\(14,3\) generated always as \(carton_qty \* kg_per_carton\) stored/);
  });

  it("refuses a submitted row with a hole in it", () => {
    expect(sql).toMatch(/inward_request_submitted_complete/);
  });
});

describe("the routes", () => {
  const code = (path: string) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("a submit and a proposal both need a verified importer", () => {
    expect(code("src/app/api/v1/inward-requests/[id]/submit/route.ts")).toMatch(/requireVerifiedImporter\("inward\.request\.update"/);
    expect(code("src/app/api/v1/inward-requests/propose/route.ts")).toMatch(/requireVerifiedImporter\("inward\.request\.create"/);
  });

  it("a decision is keyed on approve, and only approve", () => {
    const decision = code("src/app/api/v1/inward-requests/[id]/decision/route.ts");
    expect(decision).toMatch(/requirePermission\("inward\.request\.approve"/);
    expect(decision).not.toMatch(/inward\.request\.update/);
  });

  it("the dock never lists a draft", () => {
    const ops = code("src/lib/inward/ops.ts");
    expect(ops).toMatch(/scope\.side === "warehouse"\) where\.push\(sql`r\.status <> 'DRAFT'`\)/);
  });
});
