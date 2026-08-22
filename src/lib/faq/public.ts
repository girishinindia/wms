import "server-only";

import { sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";

import { getDb } from "@/db";

/**
 * The FAQ data the whole internet may read.
 *
 * Same boundary as `lib/warehouses/public`: every column is named by
 * hand, there is no `select *`, and nothing else on the public site
 * reaches these tables. A column added to `wms.faq` next year is
 * private until somebody comes here and decides otherwise.
 *
 * Withheld: the audit columns and both user id columns, the primary
 * keys of anything but the rows themselves, and every row that is
 * switched off or deleted. There is nothing personal on either table —
 * no name, no number, no address — which is the other reason this file
 * is short.
 */

/** Switched on, and not deleted. Applied to both tables, every query. */
const LIVE_CATEGORY = sql`c.is_active and c.deleted_at is null`;
const LIVE_FAQ = sql`f.is_active and f.deleted_at is null`;

export const PUBLIC_FAQ_TAG = "public-faqs";

export type PublicFaq = {
  /** Stable per row, for the anchor and the accordion's key. */
  id: number;
  question: string;
  /** Plain text. Paragraphs are separated by blank lines; the page
   *  splits on them and renders each as its own <p>. Never markup. */
  answer: string;
};

export type PublicFaqGroup = {
  code: string;
  name: string;
  description: string | null;
  faqs: PublicFaq[];
};

/**
 * Every live FAQ, grouped by its category.
 *
 * One query, then grouped here — a category per query would be a round
 * trip per heading on a page that exists to be crawled. Categories with
 * no live questions are dropped: a heading that opens onto nothing
 * reads as a broken page, not as an empty category.
 */
const readGroups = async (): Promise<PublicFaqGroup[]> => {
  /**
   * A database that cannot be reached gives an empty page, not a
   * failure.
   *
   * This page reads no `searchParams`, so Next prerenders it during the
   * build — and a prerender that throws fails the whole deploy. A
   * Supabase project that has paused itself would therefore stop a
   * release over the FAQ list, which is not a trade anybody would make
   * on purpose. At runtime the same catch turns a blip into the "ask us
   * directly" panel rather than a 500 on a public page.
   *
   * Logged, not swallowed: the empty state is a symptom somebody should
   * be able to find the cause of.
   */
  let rows: Record<string, unknown>[];
  try {
    rows = await getDb().execute<Record<string, unknown>>(sql`
      select c.code   as category_code,
             c.name   as category_name,
             c.description as category_description,
             f.id, f.question, f.answer
        from wms.faq f
        join wms.faq_category c on c.id = f.faq_category_id
       where ${LIVE_FAQ} and ${LIVE_CATEGORY}
       order by c.sort_order, c.name, f.sort_order, f.id
    `);
  } catch (error) {
    console.error("[faq] public list unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  const groups = new Map<string, PublicFaqGroup>();
  for (const r of rows) {
    const code = String(r.category_code);
    let group = groups.get(code);
    if (!group) {
      group = {
        code,
        name: String(r.category_name),
        description: r.category_description === null ? null : String(r.category_description),
        faqs: [],
      };
      groups.set(code, group);
    }
    group.faqs.push({
      id: Number(r.id),
      question: String(r.question),
      answer: String(r.answer),
    });
  }
  return [...groups.values()];
};

/**
 * Cached, and dropped by tag on any save.
 *
 * The page above reads no `searchParams`, so `export const revalidate`
 * would work there too — but caching the query rather than the page is
 * what the warehouse pages settled on after measuring, and one pattern
 * for both is worth more than saving a wrapper here.
 */
export const publicFaqGroups = unstable_cache(readGroups, ["public-faq", "groups"], {
  tags: [PUBLIC_FAQ_TAG],
  revalidate: 300,
});
