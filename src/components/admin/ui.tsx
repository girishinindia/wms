import type { ReactNode } from "react";

/**
 * The handful of shapes every admin screen is made of.
 *
 * Kept small on purpose. These are not a component library — they are
 * the four or five arrangements the panel actually uses, named once so
 * that a table on the users screen and a table on the importers screen
 * cannot drift apart. Anything used exactly once stays in its page.
 *
 * All of it sits inside the existing ink/verdigris palette from
 * globals.css; there are no new colour tokens here.
 */

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-verdigris-50">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-verdigris-200/60">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-verdigris-300/10 bg-ink-850 card-shadow ${className}`}
    >
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  note,
  tone = "default",
}: {
  label: string;
  value: string | number;
  note?: string;
  tone?: "default" | "warn" | "danger";
}) {
  const valueTone =
    tone === "danger"
      ? "text-rose-300"
      : tone === "warn"
        ? "text-amber-300"
        : "text-verdigris-300";
  return (
    <Card className="p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-verdigris-400">
        {label}
      </p>
      <p className={`mt-2 font-mono text-3xl font-medium ${valueTone}`}>{value}</p>
      {note ? <p className="mt-1 text-xs text-verdigris-200/50">{note}</p> : null}
    </Card>
  );
}

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "border-verdigris-300/35 bg-verdigris-500/15 text-verdigris-100",
  PENDING: "border-amber-400/35 bg-amber-500/10 text-amber-200",
  DRAFT: "border-verdigris-300/20 bg-ink-900/70 text-verdigris-200/70",
  SUSPENDED: "border-rose-400/35 bg-rose-500/10 text-rose-200",
  REJECTED: "border-rose-400/35 bg-rose-500/10 text-rose-200",
  CLOSED: "border-verdigris-300/20 bg-ink-900/70 text-verdigris-200/60",
  VERIFIED: "border-verdigris-300/35 bg-verdigris-500/15 text-verdigris-100",
  NOT_STARTED: "border-verdigris-300/20 bg-ink-900/70 text-verdigris-200/60",
  SUBMITTED: "border-amber-400/35 bg-amber-500/10 text-amber-200",
  UNDER_REVIEW: "border-amber-400/35 bg-amber-500/10 text-amber-200",
};

/** Status pills. Unknown values fall back to neutral rather than throwing —
 *  a new enum member should look plain, not break the page. */
export function StatusBadge({ value }: { value: string }) {
  const tone = STATUS_TONE[value] ?? "border-verdigris-300/20 bg-ink-900/70 text-verdigris-200/70";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${tone}`}
    >
      {value.toLowerCase().replace(/_/g, " ")}
    </span>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-verdigris-300/10">
            {head.map((cell, i) => (
              <th
                key={i}
                className="px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-verdigris-400"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return (
    <tr className="border-b border-verdigris-300/[0.06] last:border-0 hover:bg-verdigris-100/[0.03]">
      {children}
    </tr>
  );
}

export function Cell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 text-verdigris-100 ${className}`}>{children}</td>;
}

/**
 * The empty state.
 *
 * Given a `hint` rather than just "nothing here", because in this panel
 * an empty table usually has a specific cause the reader can act on —
 * no cities have been added yet, no importer has registered yet — and
 * saying so is the difference between a dead end and a next step.
 */
export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-4 py-14 text-center">
      <p className="text-sm text-verdigris-100">{title}</p>
      {hint ? <p className="mx-auto mt-1.5 max-w-md text-xs text-verdigris-200/50">{hint}</p> : null}
    </div>
  );
}

/** A short definition list — the shape used all over the detail screens. */
export function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-verdigris-400">
            {item.label}
          </dt>
          <dd className="mt-1 text-sm text-verdigris-100">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Shown when a guard refuses, instead of a redirect that loses the URL. */
export function Denied({ what }: { what: string }) {
  return (
    <Card className="p-8 text-center">
      <p className="text-sm text-verdigris-100">You do not have permission to view {what}.</p>
      <p className="mt-1.5 text-xs text-verdigris-200/50">
        Ask a super admin to grant it, then reload this page.
      </p>
    </Card>
  );
}
