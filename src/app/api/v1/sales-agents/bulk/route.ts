import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, fieldsFrom, handler, ok, toResponse } from "@/lib/api/respond";
import { requireVerifiedImporter } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/ratelimit";
import { deleteSalesAgent, loadSalesAgent, updateSalesAgent } from "@/lib/sales-agents/ops";
import { resolveImporterScope } from "@/lib/sales-agents/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  action: z.enum(["activate", "deactivate", "delete"]),
  ids: z.array(z.number().int().positive()).min(1).max(200),
});

/** Same shape as the master bulk endpoint: row by row, each reported. */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail("VALIDATION_FAILED", "Expected a JSON body", requestId);
      }
      const parsed = bodySchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION_FAILED", "Please check the request", requestId, { fields: fieldsFrom(parsed.error) });
      }
      const { action, ids } = parsed.data;
      const { actor, grant } = await requireVerifiedImporter(
        `sales_agent.${action === "delete" ? "delete" : "update"}`,
        { entityType: "sales_agent" },
      );
      const scope = resolveImporterScope(actor, grant, null, requestId);
      if ("response" in scope) return scope.response;
      const meta = { requestId, ip: clientIp(request.headers), userAgent: request.headers.get("user-agent") };

      const done: number[] = [];
      const skipped: { id: number; reason: string }[] = [];
      for (const id of [...new Set(ids)]) {
        const agent = await loadSalesAgent(id);
        if (!agent || (scope.importerId !== null && agent.importerId !== scope.importerId)) {
          skipped.push({ id, reason: "not found" });
          continue;
        }
        if (action === "delete") await deleteSalesAgent(agent, actor, meta);
        else await updateSalesAgent(agent, { isActive: action === "activate" }, actor, meta);
        done.push(id);
      }
      return ok({ action, done, skipped, notes: [] }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
