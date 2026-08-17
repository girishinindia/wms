/**
 * Search, filter, sort and pagination for admin lists — the state that
 * lives in the URL.
 *
 * In the URL and nowhere else, deliberately. Every admin screen already
 * navigates with real page loads (see AdminShell), so a list whose state
 * is in the query string gets three things for free: the back button
 * works, a filtered view can be bookmarked or pasted into a chat, and
 * nothing depends on client-side routing — which has now failed
 * silently often enough on this project to have earned its exile.
 *
 * The parse is defensive because every value comes off the address bar.
 * An unknown sort key falls back to the default; a page beyond the end
 * is clamped by the caller once the total is known; a page size outside
 * the menu is snapped to the nearest allowed value.
 */

export const PAGE_SIZES = [20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;

export type Direction = "asc" | "desc";
export type StatusFilter = "all" | "active" | "inactive";

export type ListQuery = {
  q: string;
  status: StatusFilter;
  sort: string;
  dir: Direction;
  page: number;
  size: number;
  /** Extra single-valued filters a screen defines, e.g. `state` on cities. */
  extra: Record<string, string>;
};

/** What the client needs to render the controls: the query, plus the
 *  totals it cannot know. */
export type ListState = ListQuery & {
  total: number;
  pages: number;
  /** Sort keys the screen accepts, in the order they should default. */
  sortable: string[];
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export function parseListQuery(
  raw: RawSearchParams,
  options: {
    sortable: readonly string[];
    defaultSort: string;
    defaultDir?: Direction;
    extraKeys?: readonly string[];
  },
): ListQuery {
  const q = first(raw.q).trim().slice(0, 100);

  const statusRaw = first(raw.status);
  const status: StatusFilter =
    statusRaw === "active" || statusRaw === "inactive" ? statusRaw : "all";

  const sortRaw = first(raw.sort);
  const sort = options.sortable.includes(sortRaw) ? sortRaw : options.defaultSort;

  const dirRaw = first(raw.dir);
  const dir: Direction =
    dirRaw === "asc" || dirRaw === "desc" ? dirRaw : (options.defaultDir ?? "asc");

  const pageRaw = Number.parseInt(first(raw.page), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  const sizeRaw = Number.parseInt(first(raw.size), 10);
  const size = (PAGE_SIZES as readonly number[]).includes(sizeRaw) ? sizeRaw : DEFAULT_PAGE_SIZE;

  const extra: Record<string, string> = {};
  for (const key of options.extraKeys ?? []) {
    const v = first(raw[key]).trim().slice(0, 50);
    if (v) extra[key] = v;
  }

  return { q, status, sort, dir, page, size, extra };
}

/** Clamp the page once the total is known, so `?page=999` shows the
 *  last page rather than an empty one. */
export function finishList(
  query: ListQuery,
  total: number,
  sortable: readonly string[],
): ListState {
  const pages = Math.max(1, Math.ceil(total / query.size));
  return { ...query, page: Math.min(query.page, pages), total, pages, sortable: [...sortable] };
}

/**
 * Turn a search string into a `LIKE` pattern with the user's own
 * wildcards neutralised. `%` and `_` typed by a user are literal
 * characters as far as they are concerned; treating them as wildcards
 * would let `_` match everything and be a puzzling result.
 */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Build the href for a state change, keeping everything else as it is.
 * Page resets to 1 for anything that changes what is being listed,
 * because page 4 of a different search is almost never what was meant.
 */
export function listHref(
  base: string,
  current: Pick<ListQuery, "q" | "status" | "sort" | "dir" | "page" | "size" | "extra">,
  patch: Partial<Pick<ListQuery, "q" | "status" | "sort" | "dir" | "page" | "size">> & {
    extra?: Record<string, string>;
  },
): string {
  const next = { ...current, ...patch, extra: { ...current.extra, ...(patch.extra ?? {}) } };
  const resetsPage =
    patch.q !== undefined ||
    patch.status !== undefined ||
    patch.sort !== undefined ||
    patch.dir !== undefined ||
    patch.size !== undefined ||
    patch.extra !== undefined;
  if (resetsPage && patch.page === undefined) next.page = 1;

  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.status !== "all") params.set("status", next.status);
  if (next.sort) params.set("sort", next.sort);
  if (next.dir !== "asc") params.set("dir", next.dir);
  if (next.page > 1) params.set("page", String(next.page));
  if (next.size !== DEFAULT_PAGE_SIZE) params.set("size", String(next.size));
  for (const [k, v] of Object.entries(next.extra)) if (v) params.set(k, v);

  const s = params.toString();
  return s ? `${base}?${s}` : base;
}
