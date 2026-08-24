import type { ReactNode } from "react";

import Spinner from "@/components/Spinner";

import StickyTableBox from "./StickyTableBox";

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
  leading,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  /** Sits to the left of the title — an avatar on a person's page. Kept
   *  as a slot rather than an `avatar` prop so the header does not have
   *  to know what a person is. */
  leading?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-center gap-3.5">
        {leading}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-verdigris-50">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-verdigris-200/60">{subtitle}</p> : null}
        </div>
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
      <p className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-verdigris-400">
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
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.78rem] font-medium ${tone}`}
    >
      {value.toLowerCase().replace(/_/g, " ")}
    </span>
  );
}

/**
 * The plain table, for lists short enough not to need `DataTable`.
 *
 * `sticky` is opt-in and OFF by default: giving a four-row card its own
 * scroll region is worse than leaving it alone — a scrollbar appears,
 * the box reserves height it does not need, and nothing was gained.
 * Screens with enough rows to scroll the header out of sight turn it
 * on; `/admin/roles` is the one that does today.
 */
export function Table({
  head,
  children,
  sticky = false,
}: {
  head: ReactNode[];
  children: ReactNode;
  sticky?: boolean;
}) {
  const inner = (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          {head.map((cell, i) => (
            <th
              key={i}
              /**
               * When it pins, two things have to move onto the CELL: an
               * opaque background, because a sticky row is transparent
               * and the rows would scroll through it; and the rule as
               * an inset shadow rather than `border-b` on the row,
               * because under `border-collapse: collapse` that border
               * belongs to the table and stays behind when the head
               * moves away from it.
               */
              className={`px-4 py-3 text-left font-mono text-[0.72rem] font-medium uppercase tracking-[0.14em] text-verdigris-400 ${
                sticky
                  ? "sticky top-0 z-20 bg-ink-850 shadow-[inset_0_-1px_0_0_color-mix(in_oklab,var(--color-verdigris-300)_16%,transparent)]"
                  : "border-b border-verdigris-300/10"
              }`}
            >
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );

  /**
   * `overflow-x-auto` alone is a scroll container on BOTH axes — see
   * `StickyTableBox` for the measurement — so a sticky head inside one
   * has nothing to stick to. A sticky table gets the measured box.
   */
  return sticky ? (
    <StickyTableBox>{inner}</StickyTableBox>
  ) : (
    <div className="overflow-x-auto">{inner}</div>
  );
}

export function Row({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <tr
      className={`border-b border-verdigris-300/[0.06] last:border-0 hover:bg-verdigris-100/[0.03] ${className}`}
    >
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
/**
 * Label on the left, value on the right, every row aligned to the same
 * label column — the shape a record reads best in. Used by the master
 * view drawer and the detail pages, so "view" looks the same everywhere.
 */
export function FactList({
  items,
  labelWidth = "9rem",
  dense = false,
}: {
  items: { label: string; value: ReactNode; mono?: boolean }[];
  /** CSS length for the label column. */
  labelWidth?: string;
  dense?: boolean;
}) {
  return (
    <dl
      className={`grid gap-x-4 ${dense ? "gap-y-0" : "gap-y-0"}`}
      style={{ gridTemplateColumns: `${labelWidth} minmax(0, 1fr)` }}
    >
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt
            className={`border-b border-verdigris-300/10 text-[0.84rem] font-medium text-verdigris-200/70 ${
              dense ? "py-2" : "py-2.5"
            }`}
          >
            {item.label}
          </dt>
          <dd
            className={`min-w-0 border-b border-verdigris-300/10 text-sm text-verdigris-50 break-words ${
              dense ? "py-2" : "py-2.5"
            } ${item.mono ? "font-mono" : ""}`}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Kept for the detail pages: the same rows, laid out with the label
 *  on the left. */
export function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return <FactList items={items} labelWidth="11rem" />;
}

/**
 * A row action, as an icon.
 *
 * The label does not disappear — it moves. `aria-label` names the
 * control for a screen reader and `title` gives a sighted user the
 * tooltip, so replacing "Switch off" with a glyph costs nothing to
 * either. Without both, an icon button is an unlabelled button, which is
 * a genuine accessibility failure rather than a style choice.
 *
 * Sized at 32px square: below about 30 these stop being comfortable to
 * hit, and these sit in dense rows where a miss edits the wrong record.
 */
export function IconButton({
  label,
  icon,
  onClick,
  tone = "default",
  disabled,
  busy,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  tone?: "default" | "danger" | "primary";
  disabled?: boolean;
  busy?: boolean;
}) {
  const tones = {
    default:
      "border-verdigris-300/15 text-verdigris-200/75 hover:border-verdigris-300/40 hover:text-verdigris-50",
    danger: "border-rose-400/25 text-rose-300/85 hover:border-rose-400/55 hover:text-rose-200",
    primary: "border-transparent bg-verdigris-400 text-ink-900 hover:bg-patina",
  } as const;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-label={label}
      title={label}
      className={`inline-grid h-8 w-8 place-items-center rounded-lg border transition-colors disabled:opacity-45 ${tones[tone]}`}
    >
      {busy ? <Spinner className="h-3.5 w-3.5" /> : icon}
    </button>
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

/**
 * A centred confirmation dialog. Replaces the old bar that rendered at
 * the BOTTOM of the table — off-screen whenever the list was long, which
 * meant scrolling to find the Delete button you had just asked for.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  tone = "danger",
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "warn";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Extra content between the message and the buttons — a reason box. */
  children?: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" aria-label="Cancel" onClick={onCancel} className="absolute inset-0 bg-ink-900/70" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        /* `text-left` is not decoration. A dialog opened from a row's
           action column is a DOM descendant of a `text-right` cell and
           inherits its alignment; stating it here means the dialog reads
           the same wherever it was opened from. */
        className={`relative w-full max-w-md rounded-2xl border bg-ink-850 p-6 text-left card-shadow ${
          tone === "danger" ? "border-rose-400/30" : "border-amber-400/30"
        }`}
      >
        <h2 className="text-base font-semibold text-verdigris-50">{title}</h2>
        <div className={`mt-2 text-sm ${tone === "danger" ? "text-rose-100/90" : "text-amber-100/90"}`}>
          {message}
        </div>
        {children}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
              tone === "danger" ? "bg-rose-500/85 hover:bg-rose-500" : "bg-amber-500/85 text-ink-900 hover:bg-amber-500"
            }`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
