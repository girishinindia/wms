import { cookies, headers } from "next/headers";

import { permissionsFor, rolesFor, findAccount } from "@/lib/auth/account";
import { resolveSession } from "@/lib/auth/session";
import { authEnv } from "@/lib/env";
import { handler, ok, toResponse, HandledError } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/auth/session — who am I, and what may I do.
 *
 * The permission set comes from `user_effective_permission`, which
 * already collapses every role the user holds to the widest scope per
 * permission and subtracts deny overrides. The client gets one flat list
 * and never has to reason about role precedence.
 *
 * Returns 401 rather than an empty session for an unauthenticated
 * caller: "no session" and "a session with no permissions" are different
 * states and a client that cannot tell them apart will render an empty
 * dashboard instead of a login page.
 */
export async function GET() {
  return handler(async ({ requestId }) => {
    try {
      const env = authEnv();
      /**
       * Bearer first, then the cookie — the same order as guard.ts.
       *
       * The mobile app holds its session as a bearer token (login only
       * returns one for platform ANDROID/IOS) and has no cookie jar, so
       * a cookie-only read here meant a native client could sign in but
       * never restore its session on the next launch. A browser never
       * sends the header, so the web path is unchanged.
       */
      const [store, headerList] = await Promise.all([cookies(), headers()]);
      const bearer = headerList.get("authorization")?.replace(/^Bearer\s+/i, "");
      const session = await resolveSession(
        bearer || store.get(env.AUTH_COOKIE_NAME)?.value,
      );

      if (!session) {
        throw new HandledError("UNAUTHENTICATED", "Sign in to continue.");
      }

      const [account, roles, permissions] = await Promise.all([
        findAccount(session.email),
        rolesFor(session.userId),
        permissionsFor(session.userId),
      ]);

      return ok(
        {
          user: {
            id: session.userId,
            email: session.email,
            firstName: session.firstName,
            lastName: session.lastName,
            mobile: account?.mobile ?? "",
            emailVerified: account?.emailVerifiedAt != null,
            mobileVerified: account?.mobileVerifiedAt != null,
            mustChangePassword: account?.mustChangePassword ?? false,
            roles,
          },
          permissions,
          // Absolute deadline. The idle window is enforced server-side on
          // every request and is deliberately not advertised.
          expiresAt: new Date(
            Date.now() + env.AUTH_SESSION_ABSOLUTE_TTL * 1000,
          ).toISOString(),
        },
        requestId,
      );
    } catch (error) {
      return toResponse(error, requestId);
    }
  })();
}
