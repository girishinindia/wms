import Link from "next/link";
import { CheckIcon, LayersIcon } from "@/components/icons";

/**
 * Split layout for the auth routes.
 *
 * Left panel carries the context — who the form is for, what happens
 * after submit, what the rules are — so the form column stays as short
 * and unambiguous as possible. The panel is hidden below `lg`, where a
 * side-by-side split would just squeeze both halves.
 *
 * The panel uses a FIXED gap under the logo (mt-20) rather than
 * `justify-between`, so the heading starts at the same height on every
 * page regardless of how much content follows. The footnote is pushed
 * down with `mt-auto` instead.
 *
 * No WebGL here: sign-in should be the fastest page on the site, and a
 * shader loop next to a password box earns nothing. If you want it,
 * dropping <VerdigrisField /> into the panel is a one-line change.
 */

export type PanelItem = {
  /** Set to render a numbered step instead of a check bullet. */
  n?: string;
  title: string;
  body: string;
};

const footerLinks = [
  ["Home", "/"],
  ["Terms", "/terms"],
  ["Privacy", "/privacy"],
  ["Contact", "/contact"],
] as const;

export default function AuthShell({
  panelTitle,
  panelIntro,
  panelItems,
  panelFootnote,
  title,
  subtitle,
  children,
  footer,
}: {
  panelTitle: string;
  panelIntro: string;
  panelItems: PanelItem[];
  panelFootnote?: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-ink-900">
      {/* ── Information panel ───────────────────────────────── */}
      <aside className="relative hidden w-[46%] max-w-[720px] shrink-0 flex-col overflow-hidden p-12 lg:flex xl:p-16">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(120%_100%_at_20%_0%,#24504e_0%,#132f2d_45%,#0a1b1a_100%)]"
        />
        <div aria-hidden className="grain-overlay absolute inset-0" />
        <div
          aria-hidden
          className="absolute -left-24 top-1/3 h-96 w-96 rounded-full bg-verdigris-500/15 blur-[120px]"
        />
        <div
          aria-hidden
          className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-verdigris-300/20 to-transparent"
        />

        <Link href="/" className="relative flex w-fit items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-verdigris-400 to-verdigris-700 shadow-lg shadow-verdigris-950/50">
            <LayersIcon className="h-5 w-5 text-ink-900" />
          </span>
          <span className="text-xl font-semibold tracking-tight text-verdigris-50">
            WMS
          </span>
        </Link>

        {/* Fixed offset — keeps the heading at the same height on
            every auth page, whatever the content length below. */}
        <div className="relative mt-20">
          <h2 className="text-tight max-w-md text-3xl font-semibold leading-tight text-verdigris-50 xl:text-4xl">
            {panelTitle}
          </h2>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-verdigris-200/70">
            {panelIntro}
          </p>

          <ul className="mt-10 max-w-md space-y-6">
            {panelItems.map((item) => (
              <li key={item.title} className="flex gap-4">
                <span
                  aria-hidden
                  className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-verdigris-300/20 bg-verdigris-500/10 font-mono text-[11px] font-medium text-verdigris-300"
                >
                  {item.n ?? <CheckIcon className="h-3.5 w-3.5" />}
                </span>
                <div>
                  <h3 className="text-[15px] font-medium text-verdigris-50">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-verdigris-200/65">
                    {item.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {panelFootnote && (
          <p className="relative mt-auto max-w-md pt-16 text-[13px] leading-relaxed text-verdigris-200/50">
            {panelFootnote}
          </p>
        )}
      </aside>

      {/* ── Form column ─────────────────────────────────────── */}
      <div className="flex flex-1 flex-col px-6 py-10 sm:px-10">
        <main
          id="main"
          className="flex flex-1 items-center justify-center py-6"
        >
          <div className="w-full max-w-md">
            <Link
              href="/"
              className="mb-10 flex w-fit items-center gap-3 lg:hidden"
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-verdigris-400 to-verdigris-700">
                <LayersIcon className="h-5 w-5 text-ink-900" />
              </span>
              <span className="text-lg font-semibold tracking-tight text-verdigris-50">
                WMS
              </span>
            </Link>

            <h1 className="text-tight text-3xl font-semibold text-verdigris-50">
              {title}
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-verdigris-200/70">
              {subtitle}
            </p>

            <div className="mt-9">{children}</div>

            {footer && (
              <p className="mt-8 text-right text-sm text-verdigris-200/65">
                {footer}
              </p>
            )}
          </div>
        </main>

        <footer className="mx-auto w-full max-w-md">
          <div className="flex flex-col gap-4 border-t border-verdigris-300/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
              {footerLinks.map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  className="text-xs text-verdigris-200/55 transition-colors hover:text-verdigris-100"
                >
                  {label}
                </Link>
              ))}
            </nav>
            <p className="text-xs text-verdigris-200/40">
              &copy; {new Date().getFullYear()} Genius ITens
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
