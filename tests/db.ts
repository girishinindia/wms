import postgres from "postgres";

/**
 * A raw client for tests, configured exactly like the app's.
 *
 * The bigint parser matters: without it a test's own `select id` returns
 * a STRING while the application returns a NUMBER, and assertions start
 * failing for a reason that has nothing to do with the behaviour under
 * test. Worse, `expect(ids).toContain(id)` would pass by accident if
 * both sides were wrong in the same way.
 *
 * Keeping the two in one place is the point — see src/db/index.ts.
 */
export function testDb(url: string): postgres.Sql {
  return postgres(url, {
    max: 2,
    prepare: false,
    ssl: false,
    onnotice: () => {},
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (value: number | bigint) => value.toString(),
        parse: (value: string) => Number(value),
      },
    },
  });
}
