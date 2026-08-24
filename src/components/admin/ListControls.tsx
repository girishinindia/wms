"use client";

import type { ReactNode } from "react";

import { countLabel, DEFAULT_PAGE_SIZE, listHref, PAGE_SIZES, type ListState } from "@/lib/admin/listing";

/**
 * The controls every paginated admin list shares.
 *
 * Plain GET forms and plain anchors, no router. Every change to search,
 * filter, sort or page is a real page load with the new state in the
 * address bar — the same decision as the sidebar, for the same reason:
 * a navigation the browser performs cannot fail silently, and a
 * filtered list you can bookmark is worth more than one that repaints
 * 100ms faster.
 */

const inputClass =
  "rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-1.5 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40";
const selectClass = `${inputClass} pr-7`;

/** Hidden inputs that carry the parts of the state a form does not edit,
 *  so submitting the search box does not drop the status filter. */
function Carry({ list, except }: { list: ListState; except: string[] }) {
  const pairs: [string, string][] = [];
  if (!except.includes("q") && list.q) pairs.push(["q", list.q]);
  if (!except.includes("status") && list.status !== "all") pairs.push(["status", list.status]);
  if (!except.includes("sort")) pairs.push(["sort", list.sort]);
  if (!except.includes("dir") && list.dir !== "asc") pairs.push(["dir", list.dir]);
  if (!except.includes("size") && list.size !== DEFAULT_PAGE_SIZE) pairs.push(["size", String(list.size)]);
  for (const [k, v] of Object.entries(list.extra)) {
    if (!except.includes(k) && v) pairs.push([k, v]);
  }
  return (
    <>
      {pairs.map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}

export function ListToolbar({
  base,
  list,
  label,
  extraFilters,
  action,
  singular,
  showStatus = true,
}: {
  base: string;
  list: ListState;
  /** Plural noun for the placeholder and the count: "countries". */
  label: string;
  /** Screen-specific selects (e.g. a state filter on cities). Rendered
   *  inside the same form so they submit together. */
  extraFilters?: ReactNode;
  /** Right-hand slot — usually the Add button. */
  action?: ReactNode;
  /** "transporter", for the count line when there is exactly one. */
  singular?: string;
  /**
   * Whether to draw the Active / Inactive select.
   *
   * On by default, so every screen that had it keeps it unchanged. Off
   * for the audit log, where nothing is active or inactive — a control
   * that cannot change what you see is worse than no control, because
   * somebody tries it and concludes the page is broken.
   */
  showStatus?: boolean;
}) {
  const from = list.total === 0 ? 0 : (list.page - 1) * list.size + 1;
  const to = Math.min(list.total, list.page * list.size);

  return (
    <div className="border-b border-verdigris-300/10 px-5 py-4">
      <h2 className="text-sm font-semibold text-verdigris-50">
        {countLabel(list.total, label, singular)}
        {list.total > list.size ? (
          <span className="ml-2 font-normal text-verdigris-200/45">
            showing {from}–{to}
          </span>
        ) : null}
      </h2>

      {/**
       * Two rows: searching on the first, narrowing on the second.
       *
       * A grid rather than two stacked flex rows, because the Add button
       * has to sit at the end of ROW ONE while staying OUTSIDE the form
       * — see the note on `action` below. The form is `display: contents`
       * so its two children are the grid's own items; the form element
       * itself lays nothing out, but still owns every control in both
       * rows, so submitting, Enter-to-search and the carried hidden
       * fields are untouched.
       *
       * Column gap is deliberately absent (`gap-y-2` only): the second
       * column collapses to nothing on a screen with no Add button, and
       * a column gap would leave the search bar short of the right edge
       * while row two ran the full width. The Add button brings its own
       * left margin instead.
       */}
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-y-2">
        <form
          method="get"
          action={base}
          className="contents"
          // Any select in here — including ones a server component passed
          // in as `extraFilters`, which cannot carry handlers of their own
          // — submits the form the moment it changes.
          onChange={(e) => {
            if (e.target instanceof HTMLSelectElement) e.currentTarget.requestSubmit();
          }}
        >
          <Carry list={list} except={["q", "status", "size", ...Object.keys(list.extra)]} />

          {/* Row one: the search bar, as wide as the row allows. */}
          <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
            <input
              type="search"
              name="q"
              defaultValue={list.q}
              placeholder={`Search ${label}`}
              aria-label={`Search ${label}`}
              className={`${inputClass} min-w-0 flex-1`}
            />
            {/* Beside the box, not down with the filters: it is this
                input's submit button, and Enter does the same thing. */}
            <button
              type="submit"
              className="shrink-0 rounded-lg border border-verdigris-300/20 px-3 py-1.5 text-sm text-verdigris-100 transition-colors hover:border-verdigris-300/45"
            >
              Search
            </button>
          </div>

          {/* Row two: everything that narrows the list. */}
          <div className="col-span-full row-start-2 flex flex-wrap items-center gap-2">
            {showStatus ? (
              <select
                name="status"
                defaultValue={list.status}
                aria-label="Status"
                className={selectClass}
              >
                <option value="all" className="bg-ink-850">All</option>
                <option value="active" className="bg-ink-850">Active</option>
                <option value="inactive" className="bg-ink-850">Inactive</option>
              </select>
            ) : null}
            {extraFilters}
            <select
              name="size"
              defaultValue={String(list.size)}
              aria-label="Rows per page"
              className={selectClass}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n} className="bg-ink-850">
                  {n} / page
                </option>
              ))}
            </select>
            {list.q || list.status !== "all" || Object.keys(list.extra).length > 0 ? (
              <a
                href={listHref(base, list, {
                  q: "",
                  status: "all",
                  extra: Object.fromEntries(Object.keys(list.extra).map((k) => [k, ""])),
                })}
                className="text-xs text-verdigris-200/60 underline-offset-2 hover:text-verdigris-100 hover:underline"
              >
                Clear
              </a>
            ) : null}
          </div>
        </form>

        {/**
         * The Add button — placed into row one, kept out of the form.
         *
         * Not a nesting nicety. This form submits itself whenever any
         * select inside it changes, and `action` is a drawer trigger
         * whose panel is a REACT child of it. React events travel the
         * React tree, not the DOM tree, so a portalled drawer is still
         * inside this form as far as `onChange` is concerned: choosing a
         * type in the Add-warehouse drawer would submit the toolbar and
         * reload the page over a half-filled form. A trigger that forgot
         * `type="button"` would submit it too.
         *
         * So it stays a sibling of the form and is put in place by the
         * grid, which is the only reason this is a grid at all.
         */}
        {action ? (
          <div className="col-start-2 row-start-1 ml-2 flex items-center gap-2">{action}</div>
        ) : null}
      </div>
    </div>
  );
}

/** A column header that sorts. Click once for ascending, again to flip. */
export function SortHeader({
  base,
  list,
  sortKey,
  children,
  align = "left",
  width,
}: {
  base: string;
  list: ListState;
  sortKey: string;
  children: ReactNode;
  align?: "left" | "right";
  width?: number;
}) {
  const active = list.sort === sortKey;
  const nextDir = active && list.dir === "asc" ? "desc" : "asc";
  return (
    <th
      style={width ? { width: `${width}rem` } : undefined}
      aria-sort={active ? (list.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`px-4 py-3 font-mono text-[0.72rem] font-medium uppercase tracking-[0.14em] ${
        align === "right" ? "text-right" : "text-left"
      } ${active ? "text-verdigris-100" : "text-verdigris-400"}`}
    >
      <a
        href={listHref(base, list, { sort: sortKey, dir: nextDir })}
        className="inline-flex items-center gap-1 hover:text-verdigris-50"
      >
        {children}
        <span aria-hidden className={active ? "opacity-100" : "opacity-30"}>
          {active && list.dir === "desc" ? "↓" : "↑"}
        </span>
      </a>
    </th>
  );
}

/**
 * The bar along the bottom of every list.
 *
 * It used to `return null` when everything fitted on one page, which is
 * why Warehouse Types, Vehicle Types, Countries, Expense categories,
 * FAQ categories, Transporters and Vehicles — six rows, thirteen, one,
 * twelve, four, three, three — had no footer at all while the long
 * lists did. A bar that comes and goes depending on how much data
 * happens to be in the table reads as a rendering bug, and it takes the
 * row count with it.
 *
 * So it always renders. What changes is the contents: the page controls
 * appear only when there is more than one page, and a single-page list
 * gets the count instead. Same bar, same height, same place.
 */
export function Pager({ base, list }: { base: string; list: ListState }) {
  const from = list.total === 0 ? 0 : (list.page - 1) * list.size + 1;
  const to = Math.min(list.total, list.page * list.size);

  if (list.pages <= 1) {
    return (
      <nav
        aria-label="Pagination"
        className="flex flex-wrap items-center justify-between gap-2 border-t border-verdigris-300/10 px-5 py-3"
      >
        <span className="text-xs text-verdigris-200/60">
          {list.total === 0 ? "Nothing to show" : `All ${list.total} on one page`}
        </span>
        {/* Page 1 of 1, stated rather than implied: the reader can see
            the bar is the pager, and that there is nowhere else to go. */}
        <span className="text-xs text-verdigris-200/45">Page 1 of 1</span>
      </nav>
    );
  }

  // Window of page numbers around the current one, with the ends pinned.
  const around = new Set<number>([1, list.pages, list.page - 1, list.page, list.page + 1]);
  const numbers = [...around].filter((n) => n >= 1 && n <= list.pages).sort((a, b) => a - b);

  const link = (page: number, label: ReactNode, current = false, disabled = false) =>
    disabled ? (
      <span className="rounded-lg px-2.5 py-1 text-xs text-verdigris-200/30">{label}</span>
    ) : (
      <a
        href={listHref(base, list, { page })}
        aria-current={current ? "page" : undefined}
        className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
          current
            ? "bg-verdigris-500/15 text-verdigris-50"
            : "text-verdigris-200/70 hover:bg-verdigris-100/5 hover:text-verdigris-100"
        }`}
      >
        {label}
      </a>
    );

  const items: ReactNode[] = [];
  let prev = 0;
  for (const n of numbers) {
    if (prev && n - prev > 1) {
      items.push(
        <span key={`gap-${n}`} className="px-1 text-xs text-verdigris-200/30">
          …
        </span>,
      );
    }
    items.push(<span key={n}>{link(n, n, n === list.page)}</span>);
    prev = n;
  }

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-2 border-t border-verdigris-300/10 px-5 py-3"
    >
      <span className="text-xs text-verdigris-200/60">
        {from}–{to} of {list.total}
        <span className="ml-2 text-verdigris-200/45">
          page {list.page} of {list.pages}
        </span>
      </span>
      <div className="flex items-center gap-1">
        {link(list.page - 1, "‹ Prev", false, list.page <= 1)}
        {items}
        {link(list.page + 1, "Next ›", false, list.page >= list.pages)}
      </div>
    </nav>
  );
}
