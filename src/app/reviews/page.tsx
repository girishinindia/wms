import type { Metadata } from "next";
import Link from "next/link";

import PageShell from "@/components/PageShell";
import { ArrowIcon } from "@/components/icons";
import { publicReviews } from "@/lib/reviews/public";

export const metadata: Metadata = {
  title: "What importers say",
  description: "Feedback from the brands whose stock we store, pick, pack and dispatch every day.",
};

/**
 * Only reviews a super admin has approved. Each one was written by a
 * signed-in importer or one of its sales agents — nobody else can write
 * one — so there is no anonymous form here, only a way in.
 */
export const revalidate = 300;

const WRITE_HREF = "/sign-in?next=/admin/my-review";

const paragraphs = (body: string) => body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

function Stars({ rating, className = "h-4 w-4" }: { rating: number; className?: string }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={`${className} ${n <= Math.round(rating) ? "text-amber-500" : "text-verdigris-300/25"}`}
          fill="currentColor"
        >
          <path d="M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z" />
        </svg>
      ))}
    </span>
  );
}

const DAY = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

export default async function Page() {
  const { count, average, reviews } = await publicReviews();

  return (
    <PageShell
      eyebrow="Reviews"
      title="What importers say"
      intro="Feedback from the brands whose stock we store, pick, pack and dispatch every day."
    >
      {count === 0 ? (
        <div className="card-shadow rounded-2xl border border-verdigris-300/10 bg-ink-850 p-10">
          <p className="text-[15px] leading-relaxed text-verdigris-200/70">
            No reviews yet. Reviews come only from importers who store with us, and are checked before they appear.
          </p>
          <Link
            href={WRITE_HREF}
            className="group mt-6 inline-flex items-center gap-2 text-sm font-medium text-verdigris-300 transition-colors hover:text-patina"
          >
            Store with us? Sign in to write one
            <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-10 flex flex-wrap items-center gap-4">
            <span className="text-4xl font-semibold text-verdigris-50">{average?.toFixed(1)}</span>
            <div>
              <Stars rating={average ?? 0} className="h-5 w-5" />
              <p className="mt-1 text-sm text-verdigris-200/60">
                From {count} {count === 1 ? "review" : "reviews"} by importers who store with us
              </p>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            {reviews.map((r) => (
              <article
                key={r.id}
                className="card-shadow flex min-w-0 flex-col rounded-2xl border border-verdigris-300/10 bg-ink-850 p-7"
              >
                <Stars rating={r.rating} />
                <div className="mt-4 flex-1 space-y-3">
                  {paragraphs(r.body).map((p, i) => (
                    <p key={i} className="whitespace-pre-line break-words text-[15px] leading-relaxed text-verdigris-100/85">
                      {p}
                    </p>
                  ))}
                </div>
                <footer className="mt-6 border-t border-verdigris-300/10 pt-4 text-sm">
                  <p className="font-medium text-verdigris-50">{r.name ?? "A verified importer"}</p>
                  <p className="mt-0.5 text-verdigris-200/55">
                    {[r.company, r.city].filter(Boolean).join(" · ") || "Importer"}
                    {" · "}
                    {DAY.format(new Date(`${r.date}T00:00:00+05:30`))}
                  </p>
                </footer>
              </article>
            ))}
          </div>

          <div className="mt-16 rounded-2xl border border-verdigris-300/10 bg-ink-900/60 p-8">
            <p className="text-[15px] text-verdigris-100">Store with us?</p>
            <p className="mt-2 text-sm leading-relaxed text-verdigris-200/65">
              Sign in and tell others how it has gone. Every review is read before it appears here.
            </p>
            <Link
              href={WRITE_HREF}
              className="group mt-6 inline-flex items-center gap-2 rounded-full bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina"
            >
              Write a review
              <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </>
      )}
    </PageShell>
  );
}
