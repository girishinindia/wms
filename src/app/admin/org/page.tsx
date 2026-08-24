import OrgTree from "@/components/admin/OrgTree";
import { Card, Denied, PageHeader } from "@/components/admin/ui";
import type { RawSearchParams } from "@/lib/admin/listing";
import { pageGuard } from "@/lib/auth/guard";
import { buildTree, DEFAULT_VIEW, isView, VIEWS } from "@/lib/org/tree";

export const dynamic = "force-dynamic";

/**
 * /admin/org — the business hierarchy.
 *
 * Four views of one graph, because which axis comes first decides which
 * question it answers. The site-first tree is the one people ask for and
 * it cannot show three things that exist: the platform roles (no site to
 * sit under), the importer side (hangs off a customer), and a role
 * nobody holds. So the axis is a choice, and it lives in the URL.
 *
 * Scoped, and here that is honest: `user_role_assignment.warehouse_id`
 * is populated on every warehouse assignment, so a warehouse admin sees
 * their own sites and their own line. Keyed on `user.read` and
 * deliberately NOT `allOnly` — a branch manager reviewing who works for
 * them is the ordinary use of this screen, not an exception to it.
 */
export default async function OrgPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const guard = await pageGuard("user.read");
  if (!guard.ok) return <Denied what="the hierarchy" />;

  const raw = await searchParams;
  const asked = Array.isArray(raw.view) ? (raw.view[0] ?? "") : (raw.view ?? "");
  const view = isView(asked) ? asked : DEFAULT_VIEW;

  const nodes = await buildTree(view, guard.actor, guard.grant.scope);

  const tab = (key: string, label: string) =>
    key === view ? (
      <span
        key={key}
        aria-current="page"
        className="rounded-lg bg-verdigris-500/15 px-3 py-1.5 text-sm font-medium text-verdigris-50"
      >
        {label}
      </span>
    ) : (
      <a
        key={key}
        href={`/admin/org?view=${key}`}
        className="rounded-lg px-3 py-1.5 text-sm text-verdigris-200/70 transition-colors hover:bg-verdigris-100/5 hover:text-verdigris-100"
      >
        {label}
      </a>
    );

  const HINT: Record<string, string> = {
    site: "Every site, the roles held there, and who holds them. Platform roles apply everywhere, so they sit in their own branch.",
    role: "Every role by seniority, where it applies, and who holds it — including the ones nobody holds.",
    line: "Who created whom, from the account tree. The line a person sits on decides whose people they are.",
    customer: "Importers and the sales agents under them.",
  };

  return (
    <>
      <PageHeader title="Business hierarchy" subtitle={HINT[view]} />

      <div className="mb-4 flex flex-wrap items-center gap-1 rounded-xl border border-verdigris-300/10 bg-ink-850 p-1.5">
        {Object.entries(VIEWS).map(([key, label]) => tab(key, label))}
      </div>

      <Card>
        <OrgTree nodes={nodes} />
      </Card>
    </>
  );
}
