import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import PageShell from "@/components/PageShell";
import PublicGallery from "@/components/PublicGallery";
import { ArrowIcon, CheckShieldIcon, PinIcon } from "@/components/icons";
import {
  getPublicWarehouse,
  listPublicWarehouses,
  type PublicWarehouse,
} from "@/lib/warehouses/public";

export const revalidate = 300;

/**
 * One facility, for anybody.
 *
 * Everything on this page comes from `lib/warehouses/public`, which
 * chooses its columns by hand. Nothing here reaches for the warehouse
 * row directly, so there is one file to read to know what a stranger
 * can see.
 *
 * No phone number and no email address appears anywhere on it. Somebody
 * who wants to talk to us goes through the enquiry form, which is a
 * form and not a mailto — a published number is scraped within days.
 */

type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const w = await getPublicWarehouse((await params).code);
  if (!w) return { title: "Facility not found" };
  const where = [w.cityName, w.stateName].filter(Boolean).join(", ");
  return {
    title: `${w.name}${where ? ` — ${where}` : ""}`,
    description: [
      w.typeName,
      where,
      w.totalAreaSqft ? `${w.totalAreaSqft.toLocaleString("en-IN")} sqft` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    alternates: { canonical: `/warehouses/${w.code}` },
    openGraph: w.coverUrl ? { images: [{ url: w.coverUrl }] } : undefined,
  };
}

const n = (v: number | null, unit = "") =>
  v === null ? null : `${v.toLocaleString("en-IN")}${unit}`;

function Facts({ title, items }: { title: string; items: [string, string][] }) {
  if (items.length === 0) return null;
  return (
    <div className="card-shadow rounded-2xl border border-verdigris-300/10 bg-ink-850 p-7">
      <h2 className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-verdigris-400">
        {title}
      </h2>
      <dl className="mt-5 space-y-3">
        {items.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-6">
            <dt className="text-sm text-verdigris-200/60">{k}</dt>
            <dd className="text-right text-sm font-medium text-verdigris-50">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default async function WarehousePage({ params }: Params) {
  const warehouse = await getPublicWarehouse((await params).code);
  // One 404 for "no such code", "switched off" and "deleted" alike.
  // Telling them apart would confirm that a code exists, which is not
  // something a stranger needs to know.
  if (!warehouse) notFound();

  const w: PublicWarehouse = warehouse;
  const where = [w.cityName, w.stateName].filter(Boolean).join(", ");

  const address = [w.address, w.landmark, w.area, where, w.pincode]
    .filter((part) => part && String(part).trim() !== "")
    .join(", ");

  const capacity: [string, string][] = (
    [
      ["Total area", n(w.totalAreaSqft, " sqft")],
      ["Usable area", n(w.usableAreaSqft, " sqft")],
      ["Storage capacity", n(w.storageCapacityCbm, " cbm")],
      ["Pallet positions", n(w.palletPositions)],
      ["Loading docks", n(w.dockCount)],
      ["Longest vehicle", n(w.maxVehicleLengthFt, " ft")],
      ["Floors", n(w.floorCount)],
    ] as [string, string | null][]
  ).filter((row): row is [string, string] => row[1] !== null);

  const facilities = [
    w.hasRacking ? "Racking" : null,
    w.hasCctv ? "CCTV" : null,
    w.hasWeighbridge ? "Weighbridge" : null,
  ].filter((v): v is string => v !== null);

  const others = (await listPublicWarehouses()).filter((o) => o.code !== w.code).slice(0, 3);

  return (
    <PageShell
      eyebrow={w.typeName ?? "Warehouse"}
      title={w.name}
      intro={where ? `${where}${w.pincode ? ` ${w.pincode}` : ""}` : "India"}
    >
      <Link
        href="/warehouses"
        className="group inline-flex items-center gap-2 text-sm font-medium text-verdigris-300 transition-colors hover:text-patina"
      >
        <ArrowIcon className="h-4 w-4 rotate-180 transition-transform group-hover:-translate-x-0.5" />
        All facilities
      </Link>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <div className="card-shadow rounded-2xl border border-verdigris-300/10 bg-ink-850 p-7">
            <h2 className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-verdigris-400">
              Where it is
            </h2>
            <p className="mt-5 flex gap-3 text-[15px] leading-relaxed text-verdigris-100">
              <PinIcon className="mt-1 h-4 w-4 shrink-0 text-verdigris-300" />
              <span>{address || where || "India"}</span>
            </p>
            {w.gmapUrl ? (
              <a
                href={w.gmapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group mt-5 inline-flex items-center gap-2 text-sm font-medium text-verdigris-300 transition-colors hover:text-patina"
              >
                Open in Maps
                <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </a>
            ) : null}
          </div>

          {facilities.length > 0 ? (
            <div className="card-shadow rounded-2xl border border-verdigris-300/10 bg-ink-850 p-7">
              <h2 className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-verdigris-400">
                On site
              </h2>
              <ul className="mt-5 flex flex-wrap gap-2.5">
                {facilities.map((f) => (
                  <li
                    key={f}
                    className="inline-flex items-center gap-2 rounded-full border border-verdigris-300/15 bg-verdigris-500/10 px-3.5 py-1.5 text-sm text-verdigris-100"
                  >
                    <CheckShieldIcon className="h-3.5 w-3.5 text-verdigris-300" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="space-y-6">
          <Facts title="Capacity" items={capacity} />

          {/**
           * The enquiry route.
           *
           * A name and a link, never a number: `contact_mobile` is a
           * person's own phone, and on a page a crawler can read it is
           * scraped within days. The form reaches the same person.
           */}
          <div className="card-shadow rounded-2xl border border-verdigris-300/10 bg-ink-900/60 p-7">
            <h2 className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-verdigris-400">
              Talk to us
            </h2>
            {w.contactPerson ? (
              <p className="mt-5 text-sm text-verdigris-200/70">
                Ask for{" "}
                <span className="font-medium text-verdigris-50">{w.contactPerson}</span> when
                you get in touch about {w.name}.
              </p>
            ) : (
              <p className="mt-5 text-sm text-verdigris-200/70">
                Send us a note about {w.name} and we will come back to you.
              </p>
            )}
            <Link
              href={`/contact?facility=${encodeURIComponent(w.code)}`}
              className="group mt-6 inline-flex items-center gap-2 rounded-full bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina"
            >
              Enquire about this facility
              <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <p className="mt-4 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-verdigris-400/70">
              Reference {w.code}
            </p>
          </div>
        </div>
      </div>

      {w.photos.length > 0 ? (
        <section className="mt-16">
          <h2 className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-verdigris-400">
            The facility
          </h2>
          <p className="mt-3 text-sm text-verdigris-200/55">
            Click any photograph to see it full size.
          </p>
          <div className="mt-6">
            <PublicGallery photos={w.photos} name={w.name} />
          </div>
        </section>
      ) : null}

      {others.length > 0 ? (
        <section className="mt-16 border-t border-verdigris-300/10 pt-12">
          <h2 className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-verdigris-400">
            Other facilities
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {others.map((o) => (
              <Link
                key={o.code}
                href={`/warehouses/${o.code}`}
                className="group card-shadow rounded-2xl border border-verdigris-300/10 bg-ink-850 p-5 transition-all duration-300 hover:-translate-y-1 hover:border-verdigris-300/25"
              >
                <p className="text-[15px] font-semibold text-verdigris-50">{o.name}</p>
                <p className="mt-1.5 text-sm text-verdigris-200/60">
                  {[o.cityName, o.typeName].filter(Boolean).join(" · ")}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </PageShell>
  );
}
