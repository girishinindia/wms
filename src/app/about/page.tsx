import type { Metadata } from "next";
import Link from "next/link";

import PageShell from "@/components/PageShell";
import { ArrowIcon } from "@/components/icons";
import { publicAboutSections } from "@/lib/about/public";

export const metadata: Metadata = {
  title: "Who we are",
  description: "The team, the warehouses, and why importers trust us with stock they have not yet sold.",
};

/**
 * Written by a super admin under Setup → Website → About page. Cached
 * for five minutes; saving a section drops the tag, so an edit shows at
 * once. Plain text only — blank lines become paragraphs.
 */
export const revalidate = 300;

const paragraphs = (body: string) => body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

export default async function Page() {
  const sections = await publicAboutSections();

  return (
    <PageShell
      eyebrow="About"
      title="Who we are"
      intro="The team, the warehouses, and why importers trust us with stock they have not yet sold."
    >
      {sections.length === 0 ? (
        <div className="card-shadow rounded-2xl border border-verdigris-300/10 bg-ink-850 p-10">
          <p className="text-[15px] leading-relaxed text-verdigris-200/70">
            We are writing this page. In the meantime, have a look at our warehouses or ask us directly.
          </p>
          <div className="mt-6 flex flex-wrap gap-6">
            <Link
              href="/warehouses"
              className="group inline-flex items-center gap-2 text-sm font-medium text-verdigris-300 transition-colors hover:text-patina"
            >
              See the warehouses
              <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/contact"
              className="group inline-flex items-center gap-2 text-sm font-medium text-verdigris-300 transition-colors hover:text-patina"
            >
              Contact us
              <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-12">
            {sections.map((s) => (
              <section key={s.id} className="max-w-3xl">
                <h2 className="text-xl font-semibold text-verdigris-50">{s.heading}</h2>
                <div className="mt-4 space-y-4">
                  {paragraphs(s.body).map((p, i) => (
                    <p key={i} className="whitespace-pre-line text-[15px] leading-relaxed text-verdigris-200/70">
                      {p}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="mt-16 rounded-2xl border border-verdigris-300/10 bg-ink-900/60 p-8">
            <p className="text-[15px] text-verdigris-100">Want to see a warehouse?</p>
            <p className="mt-2 text-sm leading-relaxed text-verdigris-200/65">
              Tell us what you import and how much space you need — we will show you around.
            </p>
            <Link
              href="/contact"
              className="group mt-6 inline-flex items-center gap-2 rounded-full bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina"
            >
              Contact us
              <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </>
      )}
    </PageShell>
  );
}
