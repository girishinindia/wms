import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { requirePermission, requireVerifiedImporter } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { announce } from "@/lib/notify/announce";
import { AgentConflictError, createSalesAgent, listSalesAgents } from "@/lib/sales-agents/ops";
import { resolveImporterScope } from "@/lib/sales-agents/scope";
import { salesAgentCreateSchema } from "@/lib/validation/api-importer";
import { isUniqueViolation } from "@/lib/db-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/v1/sales-agents           — mine (importer) or all/?importerId= (super admin)
 * POST /api/v1/sales-agents           — add one; importer must be verified
 */
export async function GET(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor, grant } = await requirePermission("sales_agent.read", { entityType: "sales_agent" });
      const wanted = request.nextUrl.searchParams.get("importerId");
      const scope = resolveImporterScope(actor, grant, wanted ? Number(wanted) : null, requestId);
      if ("response" in scope) return scope.response;
      const where = scope.importerId === null ? sql`true` : sql`a.importer_id = ${scope.importerId}`;
      return ok({ agents: await listSalesAgents(where) }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}

export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const { actor, grant } = await requireVerifiedImporter("sales_agent.create", { entityType: "sales_agent" });

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      }
      const parsed = salesAgentCreateSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const input = parsed.data;

      const scope = resolveImporterScope(actor, grant, input.importerId, requestId);
      if ("response" in scope) return scope.response;
      if (scope.importerId === null) {
        return fail("VALIDATION_FAILED", "Which importer?", requestId, { fields: { importerId: "Required" } });
      }
      const meta = { requestId, ip: clientIp(request.headers), userAgent: request.headers.get("user-agent") };
      const { agent, login, tempPassword } = await createSalesAgent(scope.importerId, input, actor, meta);

      try {
        await announce({
          eventKey: "sales_agent.created",
          values: {
            agent: `${agent.firstName} ${agent.lastName}`,
            agent_code: agent.code,
            company: agent.importerName,
          },
          dedupeSuffix: `sales_agent:${agent.id}`,
          actorUserId: actor.session.userId,
          entityType: "sales_agent",
          entityId: String(agent.id),
          importerId: agent.importerId,
          correlationId: requestId,
        });
      } catch (error) {
        console.error("[sales-agents] announce failed", { requestId, error: String(error) });
      }

      // The one-time password is returned ONCE, to the creator, so they
      // can hand it over in person; it is never stored or shown again.
      return ok({ agent, login, tempPassword }, requestId, 201);
    } catch (error) {
      if (error instanceof AgentConflictError) {
        return fail("CONFLICT", "Some details are already in use — see the highlighted fields", requestId, {
          fields: error.fields,
        });
      }
      if (isUniqueViolation(error)) {
        return fail("CONFLICT", "This importer already has an agent with that mobile, email or PAN", requestId);
      }
      return toResponse(error, requestId);
    }
  })();
}
