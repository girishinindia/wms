import { type NextRequest } from "next/server";

import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { requireVerifiedImporter } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { deleteSalesAgent, loadSalesAgent, updateSalesAgent } from "@/lib/sales-agents/ops";
import { agentInScope, resolveImporterScope } from "@/lib/sales-agents/scope";
import { salesAgentUpdateSchema } from "@/lib/validation/api-importer";
import { isUniqueViolation } from "@/lib/db-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function load(id: string, requestId: string) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return { response: fail("VALIDATION_FAILED", "Which agent?", requestId) };
  const agent = await loadSalesAgent(n);
  if (!agent) return { response: fail("NOT_FOUND", "No such sales agent", requestId) };
  return { agent };
}

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handler(async ({ requestId }) => {
    try {
      const { actor, grant } = await requireVerifiedImporter("sales_agent.read", { entityType: "sales_agent" });
      const found = await load((await context.params).id, requestId);
      if ("response" in found) return found.response;
      const scope = resolveImporterScope(actor, grant, found.agent.importerId, requestId);
      if ("response" in scope) return scope.response;
      // Not found, rather than forbidden: an id an agent may not read
      // should not be confirmable by the shape of the refusal.
      if (!agentInScope(scope, found.agent)) {
        return fail("NOT_FOUND", "No such sales agent", requestId);
      }
      return ok(found.agent, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handler(async ({ requestId }) => {
    try {
      const { actor, grant } = await requireVerifiedImporter("sales_agent.update", { entityType: "sales_agent" });
      const found = await load((await context.params).id, requestId);
      if ("response" in found) return found.response;
      const scope = resolveImporterScope(actor, grant, found.agent.importerId, requestId);
      if ("response" in scope) return scope.response;
      // Not found, rather than forbidden: an id an agent may not read
      // should not be confirmable by the shape of the refusal.
      if (!agentInScope(scope, found.agent)) {
        return fail("NOT_FOUND", "No such sales agent", requestId);
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      }
      const parsed = salesAgentUpdateSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the highlighted fields", requestId, {
          fields: fieldsFrom(parsed.error),
        });
      }
      const meta = { requestId, ip: clientIp(request.headers), userAgent: request.headers.get("user-agent") };
      const after = await updateSalesAgent(found.agent, parsed.data as Record<string, unknown>, actor, meta);
      return ok(after, requestId);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return fail("CONFLICT", "This importer already has an agent with that mobile, email or PAN", requestId);
      }
      return toResponse(error, requestId);
    }
  })();
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handler(async ({ requestId }) => {
    try {
      const { actor, grant } = await requireVerifiedImporter("sales_agent.delete", { entityType: "sales_agent" });
      const found = await load((await context.params).id, requestId);
      if ("response" in found) return found.response;
      const scope = resolveImporterScope(actor, grant, found.agent.importerId, requestId);
      if ("response" in scope) return scope.response;
      // Not found, rather than forbidden: an id an agent may not read
      // should not be confirmable by the shape of the refusal.
      if (!agentInScope(scope, found.agent)) {
        return fail("NOT_FOUND", "No such sales agent", requestId);
      }
      const meta = { requestId, ip: clientIp(request.headers), userAgent: request.headers.get("user-agent") };
      await deleteSalesAgent(found.agent, actor, meta);
      return ok({ ok: true as const }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
