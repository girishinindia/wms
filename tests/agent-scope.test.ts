import { describe, expect, it } from "vitest";

import type { Actor, Grant } from "@/lib/auth/guard";
import { agentInScope, agentWhere, isAgentOnly, resolveImporterScope } from "@/lib/sales-agents/scope";
import { ADULT_MESSAGE, isAdultBirthDate, latestAdultBirthDate } from "@/lib/validation/age";

/**
 * Who a sales-agent request is allowed to see.
 *
 * The bug these pin down: IMPORTER and SALES_AGENT hold
 * `sales_agent.read` at the SAME scope, and the actor's role assignment
 * names the same company for both — so a scope resolved from the
 * permission alone handed an agent the whole company's list.
 */

const actorWith = (roles: { role: string; importerId: number | null }[], userId = 77) =>
  ({
    session: { userId, email: "x@test.invalid", firstName: "X", lastName: "Y" },
    roles,
    permissions: [],
    isSuperAdmin: false,
  }) as unknown as Actor;

const own: Grant = { permission: "sales_agent.read", scope: "OWN" } as Grant;
const all: Grant = { permission: "sales_agent.read", scope: "ALL" } as Grant;

const owner = actorWith([{ role: "IMPORTER", importerId: 12 }]);
const agent = actorWith([{ role: "SALES_AGENT", importerId: 12 }]);
const admin = actorWith([{ role: "SUPER_ADMIN", importerId: null }], 1);

describe("who an agent request is about", () => {
  it("tells an agent apart from the owner they share a company with", () => {
    expect(isAgentOnly(owner)).toBe(false);
    expect(isAgentOnly(agent)).toBe(true);
    expect(isAgentOnly(admin)).toBe(false);
  });

  it("treats someone who is both as an owner, not an agent", () => {
    const both = actorWith([
      { role: "SALES_AGENT", importerId: 12 },
      { role: "IMPORTER", importerId: 12 },
    ]);
    expect(isAgentOnly(both)).toBe(false);
  });

  it("gives the owner their company and the agent only themselves", () => {
    const forOwner = resolveImporterScope(owner, own, null, "r");
    const forAgent = resolveImporterScope(agent, own, null, "r");
    expect(forOwner).toEqual({ importerId: 12, selfUserId: null });
    expect(forAgent).toEqual({ importerId: 12, selfUserId: 77 });
  });

  it("ignores an importerId the caller asks for unless they hold ALL", () => {
    expect(resolveImporterScope(agent, own, 99, "r")).toEqual({ importerId: 12, selfUserId: 77 });
    expect(resolveImporterScope(admin, all, 99, "r")).toEqual({ importerId: 99, selfUserId: null });
  });

  it("filters on the agent's own user id, not on their company", () => {
    const clause = agentWhere({ importerId: 12, selfUserId: 77 });
    const text = JSON.stringify(clause);
    expect(text).toContain("a.user_id");
    expect(text).not.toContain("a.importer_id");
  });

  it("still filters an owner's list by company, and a super admin's by nothing", () => {
    expect(JSON.stringify(agentWhere({ importerId: 12, selfUserId: null }))).toContain("a.importer_id");
    expect(JSON.stringify(agentWhere({ importerId: null, selfUserId: null }))).toContain("true");
  });

  it("refuses a colleague fetched by id, and allows the agent's own row", () => {
    const scope = { importerId: 12, selfUserId: 77 };
    expect(agentInScope(scope, { importerId: 12, userId: 77 })).toBe(true);
    // Same company, different person — this is the leak.
    expect(agentInScope(scope, { importerId: 12, userId: 78 })).toBe(false);
    // The owner still sees both.
    const ownerScope = { importerId: 12, selfUserId: null };
    expect(agentInScope(ownerScope, { importerId: 12, userId: 78 })).toBe(true);
    expect(agentInScope(ownerScope, { importerId: 13, userId: 78 })).toBe(false);
  });
});

describe("a sales agent has to be an adult", () => {
  const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

  it("puts the boundary exactly eighteen years back", () => {
    expect(latestAdultBirthDate(at("2026-08-21"))).toBe("2008-08-21");
  });

  it("accepts the eighteenth birthday and refuses the day after it", () => {
    const now = at("2026-08-21");
    expect(isAdultBirthDate("2008-08-21", now)).toBe(true);
    expect(isAdultBirthDate("2008-08-22", now)).toBe(false);
  });

  it("refuses today and the future, which is what the form allowed", () => {
    const now = at("2026-08-21");
    expect(isAdultBirthDate("2026-08-21", now)).toBe(false);
    expect(isAdultBirthDate("2026-12-31", now)).toBe(false);
  });

  it("does not move the boundary for someone filling the form after midnight IST", () => {
    // 20:00 UTC on the 20th is 01:30 IST on the 21st.
    expect(latestAdultBirthDate(new Date("2026-08-20T20:00:00Z"))).toBe("2008-08-21");
  });

  it("is the rule the create schema enforces", async () => {
    const { salesAgentCreateSchema } = await import("@/lib/validation/api-importer");
    const base = {
      firstName: "Vishwa",
      lastName: "Chauhan",
      email: "vishwa@test.invalid",
      mobile: "8866645319",
      joiningDate: "2026-08-25",
    };
    const tooYoung = salesAgentCreateSchema.safeParse({ ...base, birthDate: "2026-08-22" });
    expect(tooYoung.success).toBe(false);
    if (!tooYoung.success) {
      expect(tooYoung.error.issues.map((i) => i.message)).toContain(ADULT_MESSAGE);
    }
    expect(salesAgentCreateSchema.safeParse({ ...base, birthDate: "1990-01-01" }).success).toBe(true);
    // Still optional — most agent records carry no birth date at all.
    expect(salesAgentCreateSchema.safeParse(base).success).toBe(true);
  });
});
