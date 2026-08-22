import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { ArrowIcon, ImageIcon, PinIcon } from "@/components/icons";
import PageShell from "@/components/PageShell";
import { listPublicWarehouses, publicFilterOptions } from "@/lib/warehouses/public";

export const metadata: Metadata = {
  title: "Where your stock lives",
  description:
    "Locations, capacity, storage systems and handling capability across our facilities.",
};

/**
 * Cached for five minutes.
 *
 * This page is public, so crawlers and bots load it far more often than
 * people do, and without this every one of those is a database query on
 * a Hobby plan. The admin does not wait out the window: creating,
 * editing or photographing a warehouse calls `revalidatePath` on its
 * way out, so a change is on the site at once.
 */
export const revalidate = 300;

const sqft = (n: number | null) => (n === null ? null : `${n.toLocaleString("en-IN")} sqft`);

export default async function WarehousesPage({
  searchParams,
}: {
  searchParams?: Promise<{ city?: string; type?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const city = typeof params.city === "string" && params.city ? params.city : null;
  const type = typeof params.type === "string" && params.type ? params.type : null;

  // Sequential, not Promise.all: this pool runs through the transaction
  // pooler and the whole app queries it one statement at a time.
  const warehouses = await listPublicWarehouses({
    city: city ?? undefined,
    type: type ?? undefined,
  });
  const options = await publicFilterOptions();

  /**
   * Filters are links, not a form.
   *
   * A real navigation with the choice in the address bar: the result is
   * a URL somebody can send, it works with JavaScript switched off, and
   * a crawler follows it — which is the entire point of a public page.
   * `null` clears that filter and keeps the other.
   */
  const href = (next: { city?: string | null; type?: string | null }) => {
    const q = new URLSearchParams();
    const c = next.city === undefined ? city : next.city;
    const t = next.type === undefined ? type : next.type;
    if (c) q.set("city", c);
    if (t) q.set("type", t);
    const s = q.toString();
    return s ? `/warehouses?${s}` : "/warehouses";
  };

  const chip = (key: string, label: string, to: string, on: boolean) => (
    <Link
      key={key}
      href={to}
      aria-current={on ? "true" : undefined}
      className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
        on
          ? "border-verdigris-300/40 bg-verdigris-500/15 text-verdigris-50"
          : "border-verdigris-300/12 text-verdigris-200/60 hover:border-verdigris-300/30 hover:text-verdigris-100"
      }`}
    >
      {label}
    </Link>
  );

  const filterRow = (
    kind: "city" | "type",
    heading: string,
    values: string[],
    active: string | null,
  ) =>
    values.length > 1 ? (
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-verdigris-400">
          {heading}
        </span>
        {chip(`${kind}-all`, "All", href({ [kind]: null }), active === null)}
        {values.map((v) =>
          chip(
            `${kind}-${v}`,
            v,
            href({ [kind]: v }),
            active !== null && active.toLowerCase() === v.toLowerCase(),
          ),
        )}
      </div>
    ) : null;

  return (
    <PageShell
      eyebrow="Warehouses"
      title="Where your stock lives"
      intro="Locations, capacity, storage systems and handling capability across our facilities."
    >
      <div className="mb-10 space-y-3">
        {filterRow("city", "City", options.cities, city)}
        {filterRow("type", "Type", options.types, type)}
      </div>

      {warehouses.length === 0 ? (
        <div className="card-shadow rounded-2xl border border-verdigris-300/10 bg-ink-850 p-10">
          <p className="text-[15px] leading-relaxed text-verdigris-200/70">
            {city || type
              ? "No facility matches that. Try another city or storage type."
              : "Our facilities are being listed here shortly."}
          </p>
          <Link
            href={city || type ? "/warehouses" : "/contact"}
            className="group mt-6 inline-flex items-center gap-2 text-sm font-medium text-verdigris-300 transition-colors hover:text-patina"
          >
            {city || type ? "Show every facility" : "Talk to us"}
            <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {warehouses.map((w) => (
            <Link
              key={w.code}
              href={`/warehouses/${w.code}`}
              className="group card-shadow flex flex-col overflow-hidden rounded-2xl border border-verdigris-300/10 bg-ink-850 transition-all duration-300 hover:-translate-y-1 hover:border-verdigris-300/25 hover:card-shadow-lg"
            >
              <div className="relative aspect-[16/10] overflow-hidden bg-ink-900/60">
                {w.coverUrl ? (
                  <Image
                    src={w.coverUrl}
                    alt={`${w.name} — ${w.typeName ?? "warehouse"}`}
                    width={w.coverWidth ?? 1600}
                    height={w.coverHeight ?? 1000}
                    unoptimized
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
                  />
                ) : (
                  <span className="grid h-full w-full place-items-center text-verdigris-300/25">
                    <ImageIcon className="h-9 w-9" />
                  </span>
                )}
                {w.photoCount > 1 ? (
                  <span className="absolute bottom-3 right-3 rounded-full bg-ink-900/80 px-2.5 py-1 font-mono text-[0.66rem] text-verdigris-100/85 backdrop-blur-sm">
                    {w.photoCount} photos
                  </span>
                ) : null}
              </div>

              <div className="flex flex-1 flex-col p-6">
                <h2 className="text-lg font-semibold text-verdigris-50">{w.name}</h2>
                <p className="mt-1.5 flex items-center gap-1.5 text-sm text-verdigris-200/65">
                  <PinIcon className="h-3.5 w-3.5 shrink-0" />
                  {[w.cityName, w.stateName].filter(Boolean).join(", ") || "India"}
                </p>
                <p className="mt-4 text-sm text-verdigris-200/55">
                  {[
                    w.typeName,
                    sqft(w.totalAreaSqft),
                    w.dockCount ? `${w.dockCount} docks` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-verdigris-300 transition-colors group-hover:text-patina">
                  View facility
                  <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </PageShell>
  );
}
