import type { Metadata } from "next";
import Link from "next/link";

import PageShell from "@/components/PageShell";
import { ArrowIcon } from "@/components/icons";
import { publicAboutSections, type PublicAboutSection } from "@/lib/about/public";

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

function Paragraphs({ items }: { items: string[] }) {
  return (
    <div className="mt-4 space-y-4">
      {items.map((p, i) => (
        <p key={i} className="whitespace-pre-line text-[15px] leading-relaxed text-verdigris-200/70">
          {p}
        </p>
      ))}
    </div>
  );
}

/**
 * One section, drawn as its layout says. The text was pasted into one
 * box in the admin; `content` is that text already read into cards,
 * steps, points or numbers (lib/about/layout.ts). Everything is plain
 * text — nothing here renders markup.
 */
function Section({ s }: { s: PublicAboutSection }) {
  const c = s.content;
  return (
    <section className={c.layout === "TEXT" ? "max-w-3xl" : ""}>
      <h2 className="text-xl font-semibold text-verdigris-50">{s.heading}</h2>

      {c.layout === "TEXT" ? <Paragraphs items={c.paragraphs} /> : null}

      {c.layout === "CARDS" ? (
        <div className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
          {c.items.map((it, i) => (
            <div key={i} className="card-shadow min-w-0 rounded-2xl border border-verdigris-300/10 bg-ink-850 p-6">
              <h3 className="text-base font-semibold text-verdigris-50">{it.title}</h3>
              <p className="mt-2 break-words text-sm leading-relaxed text-verdigris-200/70">{it.text}</p>
            </div>
          ))}
        </div>
      ) : null}

      {c.layout === "STEPS" ? (
        <ol className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-4">
          {c.items.map((it, i) => (
            <li key={i} className="min-w-0 rounded-2xl border border-verdigris-300/10 bg-ink-850 p-5">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-verdigris-400 text-sm font-semibold text-ink-900">
                {i + 1}
              </span>
              <h3 className="mt-3 text-[15px] font-semibold text-verdigris-50">{it.title}</h3>
              <p className="mt-1.5 break-words text-sm leading-relaxed text-verdigris-200/70">{it.text}</p>
            </li>
          ))}
        </ol>
      ) : null}

      {c.layout === "CHECKLIST" ? (
        <ul className="mt-6 grid gap-x-8 gap-y-4 md:grid-cols-2">
          {c.items.map((it, i) => (
            <li key={i} className="flex min-w-0 gap-3">
              <span aria-hidden="true" className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-verdigris-400/15 text-sm font-bold text-verdigris-300">
                ✓
              </span>
              <p className="break-words text-[15px] leading-relaxed text-verdigris-200/70">
                <span className="font-semibold text-verdigris-50">{it.title}</span> {it.text}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      {c.layout === "NUMBERS" ? (
        <dl className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-4">
          {c.stats.map((st, i) => (
            <div key={i} className="min-w-0 rounded-2xl border border-verdigris-300/10 bg-ink-850 p-6 text-center">
              <dt className="sr-only">{st.label}</dt>
              <dd className="break-words text-3xl font-semibold tracking-tight text-verdigris-50">{st.value}</dd>
              <dd className="mt-1 text-sm text-verdigris-200/60">{st.label}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {c.layout === "CALL_TO_ACTION" ? (
        <div className="mt-5 rounded-2xl border border-verdigris-300/10 bg-ink-900/60 p-8">
          <div className="space-y-3">
            {c.paragraphs.map((p, i) => (
              <p key={i} className="whitespace-pre-line text-[15px] leading-relaxed text-verdigris-200/75">
                {p}
              </p>
            ))}
          </div>
          {s.button ? (
            <a
              href={s.button.link}
              className="group mt-6 inline-flex items-center gap-2 rounded-full bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina"
            >
              {s.button.label}
              <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default async function Page() {
  const sections = await publicAboutSections();
  // A page that ends on its own call to action does not need the
  // generic one under it as well.
  const endsWithCta = sections.at(-1)?.layout === "CALL_TO_ACTION";

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
          <div className="space-y-14">
            {sections.map((s) => (
              <Section key={s.id} s={s} />
            ))}
          </div>

          {endsWithCta ? null : (
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
          )}
        </>
      )}
    </PageShell>
  );
}
