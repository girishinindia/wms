import AuditTable from "@/components/admin/AuditTable";
import { Card, Denied, PageHeader } from "@/components/admin/ui";
import {
  AUDIT_FILTER_KEYS,
  AUDIT_SORTABLE,
  DEFAULT_PERIOD,
  isPeriod,
  PERIODS,
  readAuditFacets,
  readAuditPage,
  RESULTS,
} from "@/lib/audit/query";
import { parseListQuery, type RawSearchParams } from "@/lib/admin/listing";
import { pageGuard } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * /admin/audit — who did what, and who was refused.
 *
 * Platform level only, and that is a decision about the DATA rather
 * than about seniority. `audit_log.read` is granted at WAREHOUSE to a
 * warehouse admin and at OWN to an importer, but the two columns that
 * exist to make those grants meaningful — `actor_warehouse_id` and
 * `actor_path`, both indexed, one with a whole `audit_for_subtree()`
 * function written against it — are never populated by the writer. Zero
 * rows out of every row in the table.
 *
 * So there is nothing to narrow by, and the choice is between showing a
 * branch manager everything (including every other branch's contact
 * details, which is the exact hole that had to be closed on the users
 * list) or showing them nothing. Nothing is the honest answer until the
 * writer fills those columns in.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const guard = await pageGuard("audit_log.read");
  if (!guard.ok) return <Denied what="the audit log" />;
  if (guard.grant.scope !== "ALL") return <Denied what="the audit log" />;

  const raw = await searchParams;
  const query = parseListQuery(raw, {
    sortable: AUDIT_SORTABLE,
    defaultSort: "occurred_at",
    // Newest first. An audit log opened at the oldest entry is a log
    // nobody reads twice.
    defaultDir: "desc",
    extraKeys: AUDIT_FILTER_KEYS,
  });

  // Read into a local before narrowing: TypeScript will not carry a
  // type guard across a second lookup on an index signature.
  const requested = query.extra.period ?? "";
  const period = isPeriod(requested) ? requested : DEFAULT_PERIOD;
  /**
   * The window is put back into `extra` so the toolbar's hidden inputs
   * carry it. Without this, changing the page or the search box would
   * drop the period back to the default and quietly change what is
   * being searched.
   */
  query.extra.period = period;

  // Sequential, never Promise.all — see src/db/index.ts on pipelining.
  const { rows, list } = await readAuditPage(query, period);
  const facets = await readAuditFacets(period);

  const select =
    "rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-1.5 pr-7 text-sm text-verdigris-50 focus:outline-none focus:ring-2 focus:ring-patina/40";

  const filters = (
    <>
      <select name="period" defaultValue={period} aria-label="Period" className={select}>
        {Object.entries(PERIODS).map(([key, p]) => (
          <option key={key} value={key} className="bg-ink-850">
            {p.label}
          </option>
        ))}
      </select>

      <select
        name="action"
        defaultValue={query.extra.action ?? ""}
        aria-label="Action"
        className={select}
      >
        <option value="" className="bg-ink-850">
          Any action
        </option>
        {facets.actions.map((a) => (
          <option key={a} value={a} className="bg-ink-850">
            {a}
          </option>
        ))}
      </select>

      <select
        name="entity"
        defaultValue={query.extra.entity ?? ""}
        aria-label="Record type"
        className={select}
      >
        <option value="" className="bg-ink-850">
          Any record
        </option>
        {facets.entityTypes.map((e) => (
          <option key={e} value={e} className="bg-ink-850">
            {e}
          </option>
        ))}
      </select>

      <select
        name="result"
        defaultValue={query.extra.result ?? ""}
        aria-label="Result"
        className={select}
      >
        <option value="" className="bg-ink-850">
          Any result
        </option>
        {RESULTS.map((r) => (
          <option key={r} value={r} className="bg-ink-850">
            {r.toLowerCase()}
          </option>
        ))}
      </select>
    </>
  );

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every change, and every attempt that was refused. Nothing here can be edited or removed."
      />
      <Card>
        <AuditTable rows={rows} list={list} filters={filters} />
      </Card>
    </>
  );
}
