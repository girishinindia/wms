
import VerdigrisField from "@/components/VerdigrisField";
import { SiteFooter, SiteHeader } from "@/components/PageShell";
import {
  ArrowIcon,
  BoxIcon,
  ChartIcon,
  CheckShieldIcon,
  LockIcon,
  PinIcon,
  ReceiptIcon,
  ScanIcon,
  TruckIcon,
} from "@/components/icons";

const capabilities = [
  {
    icon: BoxIcon,
    title: "Secure Goods Storage",
    body: "Your imported stock is received, verified, and shelved under your account, with full traceability from dock to storage.",
  },
  {
    icon: ReceiptIcon,
    title: "Agent Order Intake",
    body: "Your marketing and sales agents raise orders straight into the system the moment a customer commits to buy.",
  },
  {
    icon: CheckShieldIcon,
    title: "Importer Approval Workflow",
    body: "Nothing leaves the warehouse without your sign-off — every order waits for your confirmation first.",
  },
  {
    icon: TruckIcon,
    title: "Fast Pick, Pack & Dispatch",
    body: "The moment you confirm an order, we pick, pack, and ship it straight to your client — no back-and-forth.",
  },
  {
    icon: ChartIcon,
    title: "Live Stock & Order Visibility",
    body: "See exactly what's stored, reserved, confirmed, and dispatched for every client, updated in real time.",
  },
  {
    icon: PinIcon,
    title: "Delivery Tracking",
    body: "Follow every shipment from our warehouse dock to your customer's doorstep.",
  },
];

const steps = [
  {
    n: "01",
    title: "You send us your stock",
    body: "Your imported goods arrive at our warehouse — we receive, inspect, and store them under your account.",
  },
  {
    n: "02",
    title: "Your agent places an order",
    body: "The moment your marketing or sales agent closes a sale, the order lands in the system.",
  },
  {
    n: "03",
    title: "You confirm it",
    body: "The order waits for your review — nothing ships until you approve it.",
  },
  {
    n: "04",
    title: "We dispatch to your client",
    body: "We pick, pack, and ship it straight to your customer's address, and keep you posted.",
  },
];

const stats = [
  { value: "250+", label: "Importer brands stored" },
  { value: "98%", label: "Orders dispatched same day" },
  { value: "50K+", label: "Orders fulfilled monthly" },
  { value: "24/7", label: "Warehouse operations" },
];

const assurances = [
  {
    icon: LockIcon,
    title: "Tenant isolation by construction",
    body: "Every query carries an importer and warehouse scope. Omitting it is a build error, not a data leak.",
  },
  {
    icon: CheckShieldIcon,
    title: "Dual-channel verification",
    body: "Independent SMS and email codes for registration, agent creation and any change of registered contact.",
  },
  {
    icon: ScanIcon,
    title: "Immutable movement ledger",
    body: "Stock moves are append-only. Documents keep a snapshot of the vehicle and driver as they were on the day.",
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader />

      <main id="main" className="flex-1">
        {/* ── Hero ──────────────────────────────────────────── */}
        <section className="relative isolate overflow-hidden">
          {/* CSS gradient fallback — visible if WebGL is unavailable */}
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,#1b3b3a_0%,#0d2322_45%,#081615_100%)]"
          />
          <VerdigrisField />
          <div aria-hidden className="grain-overlay absolute inset-0" />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-b from-ink-900/75 via-ink-900/25 to-transparent"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-r from-ink-900/70 via-ink-900/10 to-transparent"
          />
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-ink-900"
          />

          <div className="relative mx-auto flex min-h-[92vh] max-w-[1400px] flex-col justify-center px-6 pb-24 pt-36">
            <div className="animate-rise">
              <span className="glass inline-flex items-center gap-2.5 rounded-full px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-verdigris-200">
                <span className="h-1.5 w-1.5 rounded-full bg-patina" />
                Warehousing &amp; fulfilment for importers
              </span>
            </div>

            <h1
              className="text-tight mt-8 max-w-5xl animate-rise text-4xl font-semibold leading-[1.06] text-verdigris-50 sm:text-5xl lg:text-6xl"
              style={{ animationDelay: "80ms" }}
            >
              Your imported stock, stored safely{" "}
              <span className="bg-gradient-to-r from-verdigris-300 via-patina to-verdigris-400 bg-clip-text text-transparent">
                &mdash; dispatched only when you say go.
              </span>
            </h1>

            <p
              className="mt-7 max-w-2xl animate-rise text-lg leading-relaxed text-verdigris-200/75"
              style={{ animationDelay: "160ms" }}
            >
              WMS stores your imported goods in our warehouse and ships every
              order to your customers the moment your agent raises it and you
              confirm it &mdash; full visibility, zero guesswork.
            </p>

            <div
              className="mt-10 flex animate-rise flex-wrap items-center gap-4"
              style={{ animationDelay: "240ms" }}
            >
              <a
                href="/sign-up"
                className="group inline-flex items-center gap-2 rounded-full bg-verdigris-400 px-6 py-3 text-sm font-semibold text-ink-900 shadow-lg shadow-verdigris-500/20 transition-all hover:bg-patina hover:shadow-xl hover:shadow-patina/25"
              >
                Get started
                <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </a>
              <a
                href="/sign-in"
                className="inline-flex items-center gap-2 rounded-full border border-verdigris-300/20 px-6 py-3 text-sm font-medium text-verdigris-100 transition-colors hover:border-verdigris-300/45 hover:bg-verdigris-100/5"
              >
                Log in
              </a>
            </div>
          </div>
        </section>

        {/* ── Stats ─────────────────────────────────────────── */}
        <section className="border-y border-verdigris-300/10 bg-ink-850 py-14">
          <div className="mx-auto grid max-w-[1400px] grid-cols-2 gap-5 px-6 lg:grid-cols-4">
            {stats.map((s) => (
              <div
                key={s.label}
                className="card-shadow rounded-2xl border border-verdigris-300/10 bg-ink-900/60 px-6 py-7"
              >
                <div className="font-mono text-4xl font-medium text-verdigris-300">
                  {s.value}
                </div>
                <div className="mt-2 text-sm leading-snug text-verdigris-200/70">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Capabilities ──────────────────────────────────── */}
        <section id="platform" className="relative py-28">
          <div className="mx-auto max-w-[1400px] px-6">
            <div className="max-w-2xl">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-verdigris-400">
                Built for importers
              </p>
              <h2 className="text-tight mt-4 text-4xl font-semibold text-verdigris-50 sm:text-5xl">
                From warehouse shelf to your customer&rsquo;s door
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-verdigris-200/70">
                Every order follows the same trusted path: your agent raises it,
                you confirm it, we dispatch it.
              </p>
            </div>

            <div className="mt-16 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {capabilities.map(({ icon: Icon, title, body }) => (
                <article
                  key={title}
                  className="group card-shadow relative overflow-hidden rounded-2xl border border-verdigris-300/10 bg-ink-850 p-7 transition-all duration-300 hover:-translate-y-1 hover:border-verdigris-300/25 hover:bg-ink-800 hover:card-shadow-lg"
                >
                  <div
                    aria-hidden
                    className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-verdigris-500/10 blur-3xl transition-colors duration-500 group-hover:bg-verdigris-400/20"
                  />
                  <div className="relative">
                    <span className="grid h-11 w-11 place-items-center rounded-xl border border-verdigris-300/15 bg-verdigris-500/10 text-verdigris-300">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-6 text-lg font-semibold text-verdigris-50">
                      {title}
                    </h3>
                    <p className="mt-3 text-[15px] leading-relaxed text-verdigris-200/70">
                      {body}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── Process ───────────────────────────────────────── */}
        <section
          id="process"
          className="relative overflow-hidden border-y border-verdigris-300/10 bg-ink-850 py-28"
        >
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-verdigris-400/40 to-transparent"
          />
          <div className="mx-auto max-w-[1400px] px-6">
            <div className="max-w-2xl">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-verdigris-400">
                How it works
              </p>
              <h2 className="text-tight mt-4 text-4xl font-semibold text-verdigris-50 sm:text-5xl">
                Store it. Order it. Confirm it. Dispatched.
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-verdigris-200/70">
                Nothing skips a step. Stock cannot be dispatched before it is
                put away, and no dispatch starts without a recorded approval.
              </p>
            </div>

            <ol className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((s, i) => (
                <li
                  key={s.n}
                  className="card-shadow relative rounded-2xl border border-verdigris-300/10 bg-ink-900/70 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-verdigris-300/30 hover:card-shadow-lg"
                >
                  <span className="font-mono text-2xl font-medium text-verdigris-500/70">
                    {s.n}
                  </span>
                  <h3 className="mt-4 text-[15px] font-semibold text-verdigris-50">
                    {s.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-verdigris-200/70">
                    {s.body}
                  </p>
                  {i < steps.length - 1 && (
                    <span
                      aria-hidden
                      className="absolute -right-3 top-1/2 hidden h-px w-5 -translate-y-1/2 bg-verdigris-300/20 lg:block"
                    />
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Assurance ─────────────────────────────────────── */}
        <section id="assurance" className="py-28">
          <div className="mx-auto max-w-[1400px] px-6">
            <div className="grid gap-14 lg:grid-cols-[0.85fr_1.15fr]">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-verdigris-400">
                  Assurance
                </p>
                <h2 className="text-tight mt-4 text-4xl font-semibold text-verdigris-50">
                  Someone else&rsquo;s stock, held to that standard
                </h2>
                <p className="mt-5 text-[15px] leading-relaxed text-verdigris-200/75">
                  A warehouse holds material it does not own, for customers who
                  compete with each other. Isolation and audit are not features
                  here — they are the product.
                </p>
              </div>

              <ul className="space-y-4">
                {assurances.map(({ icon: Icon, title, body }) => (
                  <li
                    key={title}
                    className="card-shadow flex gap-5 rounded-2xl border border-verdigris-300/10 bg-ink-850 p-6"
                  >
                    <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-verdigris-300/15 bg-verdigris-500/10 text-verdigris-300">
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <div>
                      <h3 className="text-[15px] font-semibold text-verdigris-50">
                        {title}
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-verdigris-200/70">
                        {body}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── CTA ───────────────────────────────────────────── */}
        <section className="px-6 pb-28">
          <div className="relative mx-auto max-w-[1400px] overflow-hidden rounded-3xl border border-verdigris-300/15 bg-gradient-to-br from-verdigris-900 via-ink-800 to-ink-900 px-8 py-20 text-center">
            <div
              aria-hidden
              className="absolute left-1/2 top-0 h-64 w-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-verdigris-500/20 blur-[100px]"
            />
            <div className="relative">
              <h2 className="text-tight mx-auto max-w-2xl text-4xl font-semibold text-verdigris-50">
                Ready to store and dispatch with confidence?
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-verdigris-200/75">
                Bring your imported stock to our warehouse and let your agents
                sell — we handle storage, confirmation-gated dispatch, and
                delivery to your customers.
              </p>
              <div className="mt-9 flex flex-wrap justify-center gap-4">
                <a
                  href="mailto:support@geniusitens.com"
                  className="group inline-flex items-center gap-2 rounded-full bg-verdigris-400 px-6 py-3 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina"
                >
                  Get started
                  <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </a>
                <a
                  href="/sign-in"
                  className="inline-flex items-center rounded-full border border-verdigris-300/20 px-6 py-3 text-sm font-medium text-verdigris-100 transition-colors hover:border-verdigris-300/45 hover:bg-verdigris-100/5"
                >
                  Sign in
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
