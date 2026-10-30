import "server-only";

import { sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";

import { getDb } from "@/db";

import { ABOUT_LAYOUTS, parseAboutBody, type AboutContent, type AboutLayout } from "./layout";

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
  layout: AboutLayout;
  /** Plain text, as typed. Never markup. */
  body: string;
  /** The body read as its layout says — what the page and the app draw. */
  content: AboutContent;
  /** Call to action only: both, or neither. */
  button: { label: string; link: string } | null;
};

const readSections = async (): Promise<PublicAboutSection[]> => {
  try {
    const rows = await getDb().execute<Record<string, unknown>>(sql`
      select id, heading, body, layout, button_label, button_link
        from wms.about_section
       where is_active and deleted_at is null
       order by sort_order, id
    `);
    return rows.map((r) => {
      const wanted = String(r.layout);
      const layout: AboutLayout = (ABOUT_LAYOUTS as readonly string[]).includes(wanted) ? (wanted as AboutLayout) : "TEXT";
      const body = String(r.body);
      // Saved through the admin, so it fits — but a row edited by hand
      // that does not still shows, as paragraphs, rather than vanishing.
      const parsed = parseAboutBody(layout, body);
      const content: AboutContent = parsed.ok ? parsed.content : { layout: "TEXT", paragraphs: parseParagraphs(body) };
      const button =
        layout === "CALL_TO_ACTION" && r.button_label && r.button_link
          ? { label: String(r.button_label), link: String(r.button_link) }
          : null;
      return { id: Number(r.id), heading: String(r.heading), layout: content.layout, body, content, button };
    });
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

function parseParagraphs(body: string): string[] {
  const r = parseAboutBody("TEXT", body);
  return r.ok && r.content.layout === "TEXT" ? r.content.paragraphs : [body];
}
