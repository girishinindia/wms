import { type NextRequest } from "next/server";
import { cookies } from "next/headers";

import { resolveSession, revokeSession, sessionCookieOptions } from "@/lib/auth/session";
import { clientIp } from "@/lib/auth/ratelimit";
import { auditQuietly } from "@/lib/audit";
import { authEnv } from "@/lib/env";
import { handler, ok, toResponse } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/auth/logout
 *
 * Always answers `{ ok: true }`, including for a token that was already
 * dead. Logout is the one action a user must never see fail: an error
 * here reads as "you are still signed in" on a shared terminal, which is
 * the opposite of what happened.
 *
 * The cookie is cleared regardless, so even an unrecognised token leaves
 * the browser in a signed-out state.
 */
export async function POST(request: NextRequest) {
  return handler(async ({ requestId }) => {
    try {
      const env = authEnv();
      const store = await cookies();
      /**
       * Bearer first, then the cookie — the same order as guard.ts and
       * /auth/session. A native sign-out sends the token it holds in the
       * Authorization header; a cookie-only read here meant the revoke
       * silently did nothing and the "signed out" session stayed live on
       * the server. A browser never sends the header, so nothing changes
       * for the web.
       */
      const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      const token = bearer || store.get(env.AUTH_COOKIE_NAME)?.value;

      if (token) {
        // Resolve first, so the audit row can name who signed out.
        const session = await resolveSession(token);
        await revokeSession(token, "logout");
        if (session) {
          await auditQuietly({
            action: "auth.logout", operation: "LOGOUT", entityType: "user",
            entityId: String(session.userId), entityLabel: session.email,
            actorUserId: session.userId, actorEmail: session.email,
            actorName: `${session.firstName} ${session.lastName}`,
            ip: clientIp(request.headers),
            userAgent: request.headers.get("user-agent"),
            requestId, metadata: { sessionId: session.sessionId },
          });
        }
      }

      store.set({ ...sessionCookieOptions(0), value: "" });
      return ok({ ok: true as const }, requestId);
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
