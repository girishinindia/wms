import QrCodesScreen from "@/components/admin/QrCodesScreen";
import { Denied, PageHeader } from "@/components/admin/ui";
import { pageGuard } from "@/lib/auth/guard";
import { cartonQueue, cartonsFirstPaint } from "@/lib/inward/cartons";
import { scopeFor } from "@/lib/inward/ops";

export const dynamic = "force-dynamic";

/**
 * /admin/qr-codes — carton numbers, QR stickers and scanning without
 * hunting for the request: pick the inward, the cartons panel opens
 * right here. Super admin, warehouse admin, inward manager.
 */
export default async function QrCodesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = await pageGuard("inward.goods.update");
  if (!guard.ok) return <Denied what="QR codes" />;

  const raw = await searchParams;
  const completed = raw.completed === "1";
  const id = Number(raw.id);
  const picked = Number.isInteger(id) && id > 0 ? id : null;
  const scope = scopeFor(guard.actor, guard.grant);
  // The list and, when the address names one, that inward's cartons — together.
  const [{ requests }, cartons] = await Promise.all([
    cartonQueue(guard.actor, scope, { completed }),
    picked === null ? Promise.resolve(null) : cartonsFirstPaint(guard.actor, scope, picked),
  ]);

  return (
    <>
      <PageHeader
        title="QR codes"
        subtitle="Pick the inward, then number its cartons, print the stickers and scan them in."
      />
      <QrCodesScreen
        initial={requests}
        initialId={picked}
        initialCartons={cartons}
        initialCompleted={completed}
      />
    </>
  );
}
