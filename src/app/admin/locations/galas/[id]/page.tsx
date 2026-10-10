import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, Denied, PageHeader } from "@/components/admin/ui";
import { pageGuard } from "@/lib/auth/guard";
import { fmtDateTime } from "@/lib/format/datetime";
import { InwardError } from "@/lib/inward/ops";
import { galaContents } from "@/lib/storage/store";

export const dynamic = "force-dynamic";

const fmt = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);

/** /admin/locations/galas/{id} — what is in one gala: by item, then every carton. */
export default async function GalaPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await pageGuard("storage.goods.update");
  if (!guard.ok || guard.grant.scope === "OWN") return <Denied what="galas" />;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  let g;
  try {
    g = await galaContents(guard.actor, id);
  } catch (error) {
    if (error instanceof InwardError) notFound();
    throw error;
  }
  return (
    <>
      <PageHeader
        title={`${g.gala.code} · ${g.gala.name}`}
        subtitle={`${g.gala.warehouse} · ${g.gala.floor} · ${fmt(g.cartons)} cartons${g.gala.isActive ? "" : " · switched off"}`}
        leading={
          <Link href={`/admin/locations?warehouse=${g.gala.warehouseId}`} className="text-sm text-verdigris-200/60 hover:text-patina" aria-label="Back to floors and galas">
            ←
          </Link>
        }
      />
      <div className="space-y-5">
        <Card className="p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">By item</p>
          {g.items.length === 0 ? (
            <p className="text-sm text-verdigris-200/60">Nothing stored here yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-verdigris-200/60">
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3">Importer</th>
                  <th className="py-2 pr-3 text-right">Cartons</th>
                  <th className="py-2 text-right">Pieces</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((it, i) => (
                  <tr key={i} className="border-t border-verdigris-300/10">
                    <td className="py-2 pr-3 text-verdigris-50">
                      {it.itemCode ? <span className="font-mono text-verdigris-200/60">{it.itemCode} · </span> : null}
                      {it.description}
                    </td>
                    <td className="py-2 pr-3 text-verdigris-200/70">{it.importer}</td>
                    <td className="py-2 pr-3 text-right font-mono text-verdigris-50">{fmt(it.cartons)}</td>
                    <td className="py-2 text-right font-mono text-verdigris-50">
                      {fmt(it.pieces)} {it.unitCode ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        {g.list.length ? (
          <Card className="p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Cartons (newest first)</p>
            <ul className="divide-y divide-verdigris-300/10 text-sm">
              {g.list.map((c) => (
                <li key={c.cartonNo} className="flex flex-wrap gap-x-3 py-1.5">
                  <span className="font-mono text-verdigris-50">{c.cartonNo}</span>
                  <span className="text-verdigris-200/70">{[c.itemCode, c.description].filter(Boolean).join(" · ")}</span>
                  <Link href={`/admin/inward/${c.inwardId}`} className="text-verdigris-300 hover:text-patina">
                    {c.inwardCode}
                  </Link>
                  <span className="ml-auto text-xs text-verdigris-200/55">
                    {c.storedAt ? fmtDateTime(c.storedAt) : ""}
                    {c.by ? ` · ${c.by}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
