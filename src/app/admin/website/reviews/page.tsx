import ReviewsModeration from "@/components/admin/reviews/ReviewsModeration";
import { Denied, PageHeader } from "@/components/admin/ui";
import { pageGuard } from "@/lib/auth/guard";
import { listReviewsForAdmin } from "@/lib/reviews/ops";
import { REVIEW_STATUSES, type ReviewStatus } from "@/lib/reviews/validation";

export const dynamic = "force-dynamic";

/**
 * /admin/website/reviews — the moderation queue.
 *
 * Importers and their sales agents write reviews from "My review"; none
 * reaches the public /reviews page until a super admin approves it here.
 * `review.approve` at ALL — 44_site_content.sql grants it to SUPER_ADMIN
 * alone, and the ALL check makes widening that grant insufficient.
 */
export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = await pageGuard("review.approve");
  if (!guard.ok || guard.grant.scope !== "ALL") return <Denied what="reviews" />;

  const raw = (await searchParams).status;
  const wanted = typeof raw === "string" ? raw.toUpperCase() : "PENDING";
  const status: ReviewStatus | null = wanted === "ALL"
    ? null
    : (REVIEW_STATUSES as readonly string[]).includes(wanted)
      ? (wanted as ReviewStatus)
      : "PENDING";
  const { items, counts } = await listReviewsForAdmin(guard.actor, status);

  return (
    <>
      <PageHeader
        title="Reviews"
        subtitle={
          counts.PENDING > 0
            ? `${counts.PENDING} waiting for a decision · ${counts.APPROVED} on the website`
            : `Nothing waiting · ${counts.APPROVED} on the website`
        }
      />
      <ReviewsModeration items={items} counts={counts} status={status ?? "ALL"} />
    </>
  );
}
