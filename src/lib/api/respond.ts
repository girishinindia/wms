import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "@/lib/openapi/zod";

/**
 * One response shape for every endpoint, and one place that decides how
 * long a request is allowed to take.
 *
 * The uniform envelope matters because the Flutter client is generated
 * from the OpenAPI document: two error shapes means two code paths in
 * the client for every call.
 *
 * The timing floor matters more, and is the reason this file exists at
 * all. Sign-in and forgot-password must take the same wall-clock time
 * whether the account exists or not. Getting that right by being careful
 * in each handler does not survive the third handler; enforcing it in
 * the wrapper does.
 */

export type ApiErrorCode =
  | "VALIDATION_FAILED"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_INACTIVE"
  | "RATE_LIMITED"
  | "CAPTCHA_FAILED"
  | "OTP_INVALID"
  | "OTP_EXPIRED"
  | "OTP_ATTEMPTS_EXCEEDED"
  | "RESEND_TOO_SOON"
  | "UNAUTHENTICATED"
  /**
   * Signed in, and still not allowed. Kept separate from
   * UNAUTHENTICATED deliberately: one means "sign in", the other means
   * "signing in again will not help you". A client that collapses the
   * two bounces the user to the login screen forever.
   */
  | "FORBIDDEN"
  | "CONFLICT"
  | "NOT_FOUND"
  | "INTERNAL";

const STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: 422,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_LOCKED: 423,
  ACCOUNT_INACTIVE: 403,
  RATE_LIMITED: 429,
  CAPTCHA_FAILED: 400,
  OTP_INVALID: 400,
  OTP_EXPIRED: 410,
  OTP_ATTEMPTS_EXCEEDED: 429,
  RESEND_TOO_SOON: 429,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  NOT_FOUND: 404,
  INTERNAL: 500,
};

export const errorSchema = z.object({
  error: z.object({
    code: z.string().openapi({ example: "INVALID_CREDENTIALS" }),
    message: z.string().openapi({ example: "Email or password is incorrect" }),
    /** Field-level messages, keyed by form field. */
    fields: z.record(z.string()).optional(),
    /** Seconds to wait, on a 429. */
    retryAfter: z.number().int().optional(),
    requestId: z.string(),
  }),
});

export type ApiError = z.infer<typeof errorSchema>;

export class HandledError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly extra: { fields?: Record<string, string>; retryAfter?: number } = {},
  ) {
    super(message);
    this.name = "HandledError";
  }
}

export function ok<T>(data: T, requestId: string, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
  });
}

export function fail(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  extra: { fields?: Record<string, string>; retryAfter?: number } = {},
): NextResponse {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    "X-Request-Id": requestId,
  };
  if (extra.retryAfter) headers["Retry-After"] = String(extra.retryAfter);

  return NextResponse.json(
    { error: { code, message, requestId, ...extra } },
    { status: STATUS[code], headers },
  );
}

/**
 * Turn a Zod failure into field-keyed messages the form can render
 * directly, rather than a flattened array the client has to re-map.
 */
export function fieldsFrom(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  return fields;
}

/**
 * Wrap a handler: request id, error translation, and a minimum duration.
 *
 * `minMillis` is the anti-enumeration control. Without it, "no such
 * account" returns in 3ms and a real login takes 90ms, and that gap
 * alone lets an attacker harvest valid addresses without ever guessing a
 * password. The floor is applied to BOTH outcomes, so the two are
 * indistinguishable from outside.
 *
 * It is a floor, not a fixed delay — a slow request is never made
 * slower, and a fast one is padded up. Combined with `fakeVerify()` on
 * the credential path, the observable time is flat.
 */
export function handler<T>(
  run: (ctx: { requestId: string; startedAt: number }) => Promise<T>,
  options: { minMillis?: number } = {},
): () => Promise<T> {
  return async () => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    try {
      return await run({ requestId, startedAt });
    } finally {
      const floor = options.minMillis ?? 0;
      const elapsed = Date.now() - startedAt;
      if (floor > elapsed) await sleep(floor - elapsed);
    }
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Translate a thrown error into a response.
 *
 * An unexpected error becomes a bare INTERNAL with the request id and
 * nothing else. The details go to stderr: a stack trace or a Postgres
 * message in the response body tells an attacker about the schema, the
 * driver and the file layout.
 */
export function toResponse(error: unknown, requestId: string): NextResponse {
  if (error instanceof HandledError) {
    return fail(error.code, error.message, requestId, error.extra);
  }
  console.error("[api] unhandled error", { requestId, error });
  return fail("INTERNAL", "Something went wrong. Please try again.", requestId);
}
