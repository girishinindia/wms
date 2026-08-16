import Link from "next/link";
import { ArrowIcon, LayersIcon } from "@/components/icons";

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,#1b3b3a_0%,#0d2322_45%,#081615_100%)]"
      />
      <div aria-hidden className="grain-overlay absolute inset-0" />

      <div className="relative">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-verdigris-400 to-verdigris-700">
          <LayersIcon className="h-6 w-6 text-ink-900" />
        </span>

        <p className="mt-8 font-mono text-xs uppercase tracking-[0.2em] text-verdigris-400">
          404
        </p>
        <h1 className="text-tight mt-4 text-4xl font-semibold text-verdigris-50 sm:text-5xl">
          Nothing stored at this location
        </h1>
        <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-verdigris-200/60">
          The page you asked for does not exist, or you do not have access to
          it.
        </p>

        <Link
          href="/"
          className="group mt-9 inline-flex items-center gap-2 rounded-full bg-verdigris-400 px-6 py-3 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina"
        >
          Back to home
          <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </main>
  );
}
