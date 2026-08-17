import Link from "next/link";
import { ArrowIcon, LayersIcon } from "@/components/icons";

/**
 * Shared shell for the marketing sub-pages. Each route owns its own
 * copy; this only supplies the header, framing and footer so the pages
 * stay consistent while their content is written.
 */
export default function PageShell({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />

      <main id="main" className="flex-1">
        <section className="relative isolate overflow-hidden border-b border-verdigris-300/10">
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,#1b3b3a_0%,#0d2322_50%,#081615_100%)]"
          />
          <div aria-hidden className="grain-overlay absolute inset-0" />

          <div className="relative mx-auto max-w-[1400px] px-6 pb-20 pt-40">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-verdigris-400">
              {eyebrow}
            </p>
            <h1 className="text-tight mt-4 max-w-3xl text-4xl font-semibold text-verdigris-50 sm:text-5xl">
              {title}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-verdigris-200/75">
              {intro}
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-[1400px] px-6 py-24">
          {children ?? (
            <div className="card-shadow rounded-2xl border border-verdigris-300/10 bg-ink-850 p-10">
              <p className="text-[15px] leading-relaxed text-verdigris-200/70">
                This page is scaffolded and ready for content.
              </p>
              <Link
                href="/"
                className="group mt-6 inline-flex items-center gap-2 text-sm font-medium text-verdigris-300 transition-colors hover:text-patina"
              >
                Back to home
                <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          )}
        </section>
      </main>

      <SiteFooter />
    </>
  );
}

export const NAV_LINKS = [
  ["Home", "/"],
  ["About", "/about"],
  ["Warehouses", "/warehouses"],
  ["Reviews", "/reviews"],
  ["FAQs", "/faqs"],
  ["Contact", "/contact"],
] as const;

export function SiteHeader({ absolute = false }: { absolute?: boolean }) {
  return (
    <header
      className={
        absolute
          ? "absolute inset-x-0 top-0 z-30"
          : "absolute inset-x-0 top-0 z-30"
      }
    >
      <nav className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-verdigris-400 to-verdigris-700 shadow-lg shadow-verdigris-950/50">
            <LayersIcon className="h-5 w-5 text-ink-900" />
          </span>
          <span className="text-xl font-semibold tracking-tight text-verdigris-50">
            WMS
          </span>
        </Link>

        <div className="hidden items-center gap-7 lg:flex">
          {NAV_LINKS.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className="text-sm text-verdigris-100/80 transition-colors hover:text-verdigris-50"
            >
              {label}
            </Link>
          ))}
        </div>

        <a
          href="/sign-in"
          className="rounded-full border border-verdigris-300/20 bg-verdigris-100/5 px-4 py-2 text-sm font-medium text-verdigris-50 backdrop-blur-sm transition-colors hover:border-verdigris-300/40 hover:bg-verdigris-100/10"
        >
          Sign in
        </a>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-verdigris-300/10 bg-ink-850">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-verdigris-400 to-verdigris-700">
            <LayersIcon className="h-4 w-4 text-ink-900" />
          </span>
          <span className="text-base font-semibold tracking-tight text-verdigris-50">
            WMS
          </span>
        </div>

        {/* Note: this page is statically prerendered, so the year is baked in
            at build time. It updates on the next deploy, not at midnight on
            1 January — schedule a rebuild if that matters. */}
        <p className="text-sm text-verdigris-200/60">
          &copy; {new Date().getFullYear()} Genius ITens. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
