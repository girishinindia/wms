import type { Metadata } from "next";
import Link from "next/link";

import FaqAccordion from "@/components/FaqAccordion";
import PageShell from "@/components/PageShell";
import { ArrowIcon } from "@/components/icons";
import { publicFaqGroups } from "@/lib/faq/public";

export const metadata: Metadata = {
  title: "Questions, answered",
  description:
    "Storage terms, billing, dispatch approval, delivery timelines and how onboarding works.",
};

/**
 * Cached for five minutes, like the warehouse pages, and for the same
 * reason: a public page is read by crawlers far more often than by
 * people. Saving a FAQ in the admin drops the tag, so an edit is on the
 * site at once rather than up to five minutes later.
 */
export const revalidate = 300;

export default async function FaqsPage() {
  const groups = await publicFaqGroups();

  return (
    <PageShell
      eyebrow="FAQs"
      title="Questions, answered"
      intro="Storage terms, billing, dispatch approval, delivery timelines and how onboarding works."
    >
      {groups.length === 0 ? (
        <div className="card-shadow rounded-2xl border border-verdigris-300/10 bg-ink-850 p-10">
          <p className="text-[15px] leading-relaxed text-verdigris-200/70">
            We are writing these up. In the meantime, ask us directly — we answer quickly.
          </p>
          <Link
            href="/contact"
            className="group mt-6 inline-flex items-center gap-2 text-sm font-medium text-verdigris-300 transition-colors hover:text-patina"
          >
            Ask a question
            <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      ) : (
        <>
          {/* Jump links. Cheap on a long page, and they give each
              category a real anchor somebody can send. */}
          {groups.length > 1 ? (
            <nav aria-label="FAQ categories" className="mb-10 flex flex-wrap gap-2">
              {groups.map((g) => (
                <a
                  key={g.code}
                  href={`#${g.code.toLowerCase()}`}
                  className="rounded-full border border-verdigris-300/12 px-3.5 py-1.5 text-xs font-medium text-verdigris-200/60 transition-colors hover:border-verdigris-300/30 hover:text-verdigris-100"
                >
                  {g.name}
                </a>
              ))}
            </nav>
          ) : null}

          <div className="space-y-14">
            {groups.map((g) => (
              <section key={g.code} id={g.code.toLowerCase()} className="scroll-mt-28">
                <h2 className="text-xl font-semibold text-verdigris-50">{g.name}</h2>
                {g.description ? (
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-verdigris-200/60">
                    {g.description}
                  </p>
                ) : null}
                <div className="mt-6">
                  <FaqAccordion faqs={g.faqs} />
                </div>
              </section>
            ))}
          </div>

          <div className="mt-16 rounded-2xl border border-verdigris-300/10 bg-ink-900/60 p-8">
            <p className="text-[15px] text-verdigris-100">Still not covered?</p>
            <p className="mt-2 text-sm leading-relaxed text-verdigris-200/65">
              Send us the question and we will answer it — and add it here if others are
              likely to ask the same thing.
            </p>
            <Link
              href="/contact"
              className="group mt-6 inline-flex items-center gap-2 rounded-full bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina"
            >
              Ask a question
              <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </>
      )}
    </PageShell>
  );
}
