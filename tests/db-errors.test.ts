import { describe, expect, it } from "vitest";

import {
  isCheckViolation,
  isForeignKeyViolation,
  isUniqueViolation,
} from "@/lib/db-errors";

/**
 * Why this needs a test at all.
 *
 * Both admin routes originally asked `/(duplicate key)/.test(error.message)`
 * and neither ever matched. Drizzle wraps the driver's error, so the
 * outer message is always `Failed query: insert into …` and the SQLSTATE
 * sits on `cause`. The visible symptom was a bare 500 on a duplicate
 * code — a conflict the user could have fixed in two seconds, presented
 * as "something went wrong".
 *
 * The shapes below are what the postgres.js driver actually produces,
 * wrapped the way drizzle wraps it.
 */

/** What a real wrapped unique violation looks like. */
function wrapped(code: string, message: string) {
  const driver = Object.assign(new Error(message), { code });
  return Object.assign(new Error("Failed query: insert into wms.vehicle_type ..."), {
    cause: driver,
  });
}

describe("isUniqueViolation", () => {
  it("finds 23505 through drizzle's wrapper", () => {
    expect(
      isUniqueViolation(
        wrapped("23505", 'duplicate key value violates unique constraint "vehicle_type_code_key"'),
      ),
    ).toBe(true);
  });

  it("does not match on the wrapper alone", () => {
    // The regression, stated as a test: the outer message says nothing.
    const outerOnly = new Error("Failed query: insert into wms.vehicle_type ...");
    expect(isUniqueViolation(outerOnly)).toBe(false);
  });

  it("matches the SQLSTATE even with no English in the message", () => {
    // A server under a different lc_messages still sends 23505.
    expect(isUniqueViolation(wrapped("23505", "Schlüsselwert verletzt Unique-Constraint"))).toBe(
      true,
    );
  });

  it("does not confuse it with another constraint", () => {
    expect(isUniqueViolation(wrapped("23503", "violates foreign key constraint"))).toBe(false);
    expect(isUniqueViolation(wrapped("23514", "violates check constraint"))).toBe(false);
  });

  it("survives a chain several levels deep, and a cycle", () => {
    const deep = Object.assign(new Error("a"), {
      cause: Object.assign(new Error("b"), { cause: wrapped("23505", "duplicate key value") }),
    });
    expect(isUniqueViolation(deep)).toBe(true);

    // A self-referencing cause must terminate rather than hang.
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(isUniqueViolation(loop)).toBe(false);
  });

  it("handles the things that are not errors at all", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });
});

describe("the other two", () => {
  it("recognises a foreign key and a check violation", () => {
    expect(isForeignKeyViolation(wrapped("23503", "violates foreign key constraint"))).toBe(true);
    expect(isCheckViolation(wrapped("23514", "violates check constraint"))).toBe(true);
  });
});
