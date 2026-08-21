import "server-only";

/**
 * Recognising the database errors a user can act on.
 *
 * Matching on `error.message` does not work here, and that is the whole
 * reason this file exists. Drizzle wraps the driver's error, so the
 * outer message is only ever `Failed query: insert into …` — the
 * SQLSTATE and the real text sit on `cause`, one or more levels down. A
 * handler that tests the outer message silently never matches, and a
 * conflict the user could have fixed arrives as a bare 500.
 *
 * Matching on the five-digit SQLSTATE rather than on English also
 * survives a server running under a different `lc_messages`.
 */

/** Walk `cause` looking for a SQLSTATE, or a message that gives it away. */
function findCode(error: unknown, pattern: RegExp, ...codes: string[]): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && codes.includes(candidate.code)) return true;
    if (typeof candidate.message === "string" && pattern.test(candidate.message)) return true;
    current = candidate.cause;
  }
  return false;
}

/** 23505 — a unique index refused the row. */
export function isUniqueViolation(error: unknown): boolean {
  return findCode(error, /duplicate key value/i, "23505");
}

/** 23503 — a foreign key. Something still points at it, or the thing it
 *  points at is not there. */
export function isForeignKeyViolation(error: unknown): boolean {
  return findCode(error, /violates foreign key constraint/i, "23503");
}

/** 23514 — a CHECK refused the row. In this schema that is usually a
 *  value the form should have offered as a fixed choice. */
export function isCheckViolation(error: unknown): boolean {
  return findCode(error, /violates check constraint/i, "23514");
}

/** The violated constraint's name, when the driver reported one. */
export function constraintNameOf(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as { constraint_name?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    const name = candidate.constraint_name ?? candidate.constraint;
    if (typeof name === "string") return name;
    if (typeof candidate.message === "string") {
      const m = /unique constraint "([^"]+)"/.exec(candidate.message);
      if (m) return m[1]!;
    }
    current = candidate.cause;
  }
  return null;
}
