import "server-only";

import { sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";

import { getDb } from "@/db";

/**
 * The About page sections, for the whole internet.
 *
 * Active and not deleted, in the order the super admin set. Heading and
 * body only — no audit columns, no user ids.
 */
export const PUBLIC_ABOUT_TAG = "public-about";

export type PublicAboutSection = {
  id: number;
  heading: string;
  /** Plain text; blank lines become paragraphs. Never markup. */
  body: string;
};

const readSections = async (): Promise<PublicAboutSection[]> => {
  try {
    const rows = await getDb().execute<Record<string, unknown>>(sql`
      select id, heading, body
        from wms.about_section
       where is_active and deleted_at is null
       order by sort_order, id
    `);
    return rows.map((r) => ({ id: Number(r.id), heading: String(r.heading), body: String(r.body) }));
  } catch (error) {
    console.error("[about] public sections unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};

export const publicAboutSections = unstable_cache(readSections, ["public-about", "sections"], {
  tags: [PUBLIC_ABOUT_TAG],
  revalidate: 300,
});
