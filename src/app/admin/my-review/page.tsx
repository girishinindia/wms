import MyReviewForm from "@/components/admin/reviews/MyReviewForm";
import { Denied, PageHeader } from "@/components/admin/ui";
import { pageGuard } from "@/lib/auth/guard";
import { getMyReview, writerImporter } from "@/lib/reviews/ops";

export const dynamic = "force-dynamic";

/**
 * /admin/my-review — an importer's or sales agent's own review of the
 * warehouse. One per person; editing it sends it back for approval.
 * Nobody else reaches this page: `review.create` is granted to IMPORTER
 * and SALES_AGENT only, and `writerImporter` also insists on the role.
 */
export default async function MyReviewPage() {
  const guard = await pageGuard("review.create");
  if (!guard.ok) return <Denied what="this page" />;
  try {
    writerImporter(guard.actor);
  } catch {
    return <Denied what="this page" />;
  }
  const review = await getMyReview(guard.actor);

  return (
    <>
      <PageHeader
        title="My review"
        subtitle="Tell other importers how storing with us has gone. A super admin reads every review before it appears on the website."
      />
      <MyReviewForm initial={review} />
    </>
  );
}
