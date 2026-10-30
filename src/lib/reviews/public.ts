import "server-only";

import { sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";

import { getDb } from "@/db";

import { publicDisplayName } from "./validation";

/**
 * The review data the whole internet may read.
 *
 * Same boundary as `lib/faq/public`: columns named by hand, APPROVED
 * rows only. Never the email, the mobile, the full name or any id but
 * the review's own. When the writer chose not to be named, the company
 * goes too — only the city is left, so the reader still knows it is a
 * real business somewhere.
 */
export const PUBLIC_REVIEW_TAG = "public-reviews";

export type PublicReview = {
  id: number;
  rating: number;
  /** Plain text; blank lines become paragraphs. Never markup. */
  body: string;
  /** "Ravi S." — or null when the writer asked not to be named. */
  name: string | null;
  company: string | null;
  city: string | null;
  /** The day it was approved, YYYY-MM-DD. */
  date: string;
};

export type PublicReviewSummary = {
  count: number;
  /** One decimal, or null with no reviews. */
  average: number | null;
  reviews: PublicReview[];
};

const EMPTY: PublicReviewSummary = { count: 0, average: null, reviews: [] };

const readReviews = async (): Promise<PublicReviewSummary> => {
  let rows: Record<string, unknown>[];
  try {
    rows = await getDb().execute<Record<string, unknown>>(sql`
      select r.id, r.rating, r.body, r.show_name,
             u.first_name, u.last_name,
             coalesce(nullif(i.trade_name, ''), i.company_name) as company,
             c.name as city,
             to_char(coalesce(r.moderated_at, r.created_at), 'YYYY-MM-DD') as day
        from wms.review r
        join wms.users u on u.id = r.author_user_id
        join wms.importer i on i.id = r.importer_id
        left join wms.city c on c.id = i.city_id
       where r.deleted_at is null and r.status = 'APPROVED'
       order by r.moderated_at desc nulls last, r.id desc
       limit 200
    `);
  } catch (error) {
    // An unreachable database gives an empty page, never a failed build.
    console.error("[reviews] public list unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return EMPTY;
  }

  const reviews: PublicReview[] = rows.map((r) => {
    const named = Boolean(r.show_name);
    return {
      id: Number(r.id),
      rating: Number(r.rating),
      body: String(r.body),
      name: named ? publicDisplayName(String(r.first_name ?? ""), String(r.last_name ?? "")) : null,
      company: named ? String(r.company) : null,
      city: r.city === null ? null : String(r.city),
      date: String(r.day),
    };
  });
  if (reviews.length === 0) return EMPTY;
  const total = reviews.reduce((sum, r) => sum + r.rating, 0);
  return {
    count: reviews.length,
    average: Math.round((total / reviews.length) * 10) / 10,
    reviews,
  };
};

export const publicReviews = unstable_cache(readReviews, ["public-reviews", "list"], {
  tags: [PUBLIC_REVIEW_TAG],
  revalidate: 300,
});
