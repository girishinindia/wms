/**
 * Browser-side calls to /api/v1.
 *
 * Every handler answers in one envelope — data on success,
 * `{ error: { code, message, fields?, retryAfter?, requestId } }` on
 * failure — so this is the only place that has to know the shape. A
 * form gets back either a value or a typed failure it can render.
 *
 * `credentials: "same-origin"` matters: the session is an httpOnly
 * cookie, so fetch has to be told to send it. Without this, login
 * appears to work and every subsequent call is a 401.
 */

export type ApiFailure = {
  code: string;
  message: string;
  /** Server-side validation messages, keyed by form field. */
  fields?: Record<string, string>;
  /** Seconds to wait, on a 429. */
  retryAfter?: number;
  requestId?: string;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiFailure };

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: init.method ?? "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: init.signal,
    });
  } catch {
    // Offline, DNS, a dropped connection. Given a code of its own so a
    // form can say "check your connection" rather than "server error",
    // which sends the user to support for something they can fix.
    return {
      ok: false,
      error: { code: "NETWORK", message: "Could not reach the server. Check your connection." },
    };
  }

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    return {
      ok: false,
      error: { code: "INTERNAL", message: "The server returned an unreadable response." },
    };
  }

  if (!response.ok) {
    const error = (payload as { error?: ApiFailure }).error;
    return {
      ok: false,
      error: error ?? { code: "INTERNAL", message: "Something went wrong. Please try again." },
    };
  }
  return { ok: true, data: payload as T };
}

/**
 * Apply server-side field errors to a react-hook-form.
 *
 * The client schema and the server schema are not identical — the server
 * also owns "this mobile is already registered" and anything else that
 * needs the database. Those have to land on the field, not in a banner
 * at the bottom that the user has already scrolled past.
 */
export function applyFieldErrors(
  fields: Record<string, string> | undefined,
  setError: (name: never, error: { type: string; message: string }) => void,
): boolean {
  if (!fields) return false;
  let applied = false;
  for (const [name, message] of Object.entries(fields)) {
    setError(name as never, { type: "server", message });
    applied = true;
  }
  return applied;
}
