"use client";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type RowSelectionState,
  type SortingState,
  type Table,
} from "@tanstack/react-table";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { ChevronIcon } from "@/components/icons";
import { countLabel, DEFAULT_PAGE_SIZE, listHref, PAGE_SIZES, type ListState } from "@/lib/admin/listing";

import { ListToolbar, Pager } from "./ListControls";
import { Empty } from "./ui";

/**
 * The one table every admin screen renders through, on TanStack Table.
 *
 * TanStack owns the column model, header/cell rendering, sorting state
 * and row selection. Where the data comes from is the caller's choice,
 * and there are two modes:
 *
 *   server — the master screens. The page fetched exactly one page of
 *            rows from the database, already searched, filtered and
 *            sorted, and `list` says how. The table is told so
 *            (`manualSorting`, `manualPagination`, `manualFiltering`)
 *            and every sort click or page change is a real navigation
 *            with the new state in the URL — bookmarkable, back-button
 *            friendly, and immune to the client-routing failures this
 *            panel has already had three of.
 *
 *   client — small lists (importers, users) that arrive whole. TanStack
 *            sorts, filters and pages them in memory, so a click is
 *            instant and no request is made.
 *
 * Both modes get selection, a bulk bar when rows are selected, the
 * same headers, the same empty state, the same look.
 */

export type DataTableProps<T> = {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  /** Stable id per row, for selection. Defaults to `row.id`. */
  getRowId?: (row: T) => string;
  /** Present → server mode. */
  list?: ListState;
  /** Route the URL state belongs to (server mode). */
  base?: string;
  /** Plural noun: "countries". */
  label: string;
  /** Singular, for the count line when there is exactly one row. */
  singular?: string;
  /** Extra filter controls (server mode: rendered inside the GET form). */
  filters?: ReactNode;
  /** Right-hand toolbar slot — usually the Add button. */
  action?: ReactNode;
  /** Rendered above the table while at least one row is selected. */
  bulk?: (selected: T[], clear: () => void) => ReactNode;
  enableSelection?: boolean;
  /** Text-search over these keys in client mode. */
  searchKeys?: (keyof T & string)[];
  emptyTitle?: string;
  emptyHint?: string;
  /** Called with the table instance for callers that need imperative
   *  access (rare). */
  onTable?: (table: Table<T>) => void;
  rowClassName?: (row: Row<T>) => string;
};

/**
 * Header cells: a distinct band above the rows, white and bold, so the
 * column names read at a glance rather than as a faint rule.
 */
const HEADER =
  "bg-ink-900/70 px-4 py-3 text-[0.84rem] font-bold uppercase tracking-[0.08em] text-verdigris-50";

export default function DataTable<T>({
  columns,
  data,
  getRowId,
  list,
  base,
  label,
  singular,
  filters,
  action,
  bulk,
  enableSelection = true,
  searchKeys,
  emptyTitle,
  emptyHint,
  onTable,
  rowClassName,
}: DataTableProps<T>) {
  const serverMode = list !== undefined && base !== undefined;

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [globalFilter, setGlobalFilter] = useState("");
  const [clientSorting, setClientSorting] = useState<SortingState>([]);

  /** In server mode the sorting state is a projection of the URL. */
  const serverSorting = useMemo<SortingState>(
    () => (list ? [{ id: list.sort, desc: list.dir === "desc" }] : []),
    [list],
  );

  const table = useReactTable<T>({
    data,
    columns,
    getRowId: getRowId ?? ((row) => String((row as { id?: unknown }).id)),
    state: {
      rowSelection,
      sorting: serverMode ? serverSorting : clientSorting,
      globalFilter,
    },
    enableRowSelection: enableSelection,
    onRowSelectionChange: setRowSelection,
    onSortingChange: serverMode ? undefined : setClientSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    ...(serverMode
      ? { manualSorting: true, manualPagination: true, manualFiltering: true }
      : {
          getSortedRowModel: getSortedRowModel(),
          getFilteredRowModel: getFilteredRowModel(),
          getPaginationRowModel: getPaginationRowModel(),
          globalFilterFn: (row, _columnId, value: string) => {
            const needle = String(value ?? "").trim().toLowerCase();
            if (!needle) return true;
            const keys = searchKeys ?? (Object.keys(row.original as object) as (keyof T & string)[]);
            return keys.some((k) => {
              const v = (row.original as Record<string, unknown>)[k];
              // Arrays and objects (sales areas, roles) search by their
              // text, not "[object Object]".
              const text = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
              return text.toLowerCase().includes(needle);
            });
          },
          initialState: { pagination: { pageSize: DEFAULT_PAGE_SIZE } },
        }),
  });

  useEffect(() => {
    onTable?.(table);
  }, [onTable, table]);

  // Selection is per page in server mode: the rows on this page are the
  // only ones the user can see, so they are the only ones a bulk action
  // may touch. A new page load resets it, which is the right thing.
  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
  const clearSelection = () => setRowSelection({});

  const rows = table.getRowModel().rows;

  return (
    <div>
      {serverMode ? (
        <ListToolbar base={base!} list={list!} label={label} singular={singular} extraFilters={filters} action={action} />
      ) : (
        <ClientToolbar
          table={table}
          label={label}
          singular={singular}
          value={globalFilter}
          onChange={setGlobalFilter}
          action={action}
        />
      )}

      {bulk && selectedRows.length > 0 ? (
        <div
          role="region"
          aria-label="Bulk actions"
          className="flex flex-wrap items-center gap-3 border-b border-verdigris-300/10 bg-verdigris-500/[0.07] px-5 py-2.5"
        >
          <span className="text-[0.9rem] font-medium text-verdigris-50">
            {selectedRows.length} selected
          </span>
          {bulk(selectedRows, clearSelection)}
          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto text-xs text-verdigris-200/60 underline-offset-2 hover:text-verdigris-100 hover:underline"
          >
            Clear selection
          </button>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b-2 border-verdigris-300/25">
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  const align = (header.column.columnDef.meta as ColumnMeta | undefined)?.align;
                  const width = (header.column.columnDef.meta as ColumnMeta | undefined)?.width;
                  const content = header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext());

                  const inner = (
                    <span className="inline-flex items-center gap-1">
                      {content}
                      {canSort ? (
                        <ChevronIcon
                          aria-hidden
                          className={`h-3 w-3 transition-transform ${
                            sorted ? "opacity-100" : "opacity-40"
                          } ${sorted === "asc" ? "rotate-180" : ""}`}
                        />
                      ) : null}
                    </span>
                  );

                  return (
                    <th
                      key={header.id}
                      style={width ? { width: `${width}rem` } : undefined}
                      aria-sort={
                        sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"
                      }
                      className={`${HEADER} ${align === "right" ? "text-right" : "text-left"} ${
                        sorted ? "text-verdigris-200" : ""
                      }`}
                    >
                      {!canSort ? (
                        inner
                      ) : serverMode ? (
                        <a
                          href={listHref(base!, list!, {
                            sort: header.column.id,
                            dir: sorted === "asc" ? "desc" : "asc",
                          })}
                          className="hover:text-verdigris-50"
                        >
                          {inner}
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="hover:text-verdigris-50"
                        >
                          {inner}
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={table.getAllLeafColumns().length}>
                  <Empty
                    title={emptyTitle ?? `No ${label} to show.`}
                    hint={emptyHint}
                  />
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  data-selected={row.getIsSelected() || undefined}
                  className={`border-b border-verdigris-300/[0.06] transition-colors last:border-0 ${
                    row.getIsSelected()
                      ? "bg-verdigris-500/[0.08]"
                      : "hover:bg-verdigris-100/[0.03]"
                  } ${rowClassName?.(row) ?? ""}`}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
                    return (
                      <td
                        key={cell.id}
                        className={`px-4 py-3 text-verdigris-100 ${
                          meta?.align === "right" ? "text-right" : ""
                        } ${meta?.mono ? "whitespace-nowrap font-mono text-xs text-verdigris-300" : ""} ${
                          meta?.className ?? ""
                        }`}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {serverMode ? <Pager base={base!} list={list!} /> : <ClientPager table={table} />}
    </div>
  );
}

/** Per-column presentation hints, read from `columnDef.meta`. */
export type ColumnMeta = {
  align?: "left" | "right";
  mono?: boolean;
  width?: number;
  className?: string;
};

/** The header checkbox: all rows on this page, or none. */
export function SelectAllHeader<T>({ table }: { table: Table<T> }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all rows on this page"
      checked={table.getIsAllPageRowsSelected()}
      ref={(el) => {
        if (el) el.indeterminate = table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected();
      }}
      onChange={table.getToggleAllPageRowsSelectedHandler()}
      className="h-4 w-4 cursor-pointer accent-verdigris-400"
    />
  );
}

export function SelectRowCell<T>({ row, label }: { row: Row<T>; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={`Select ${label}`}
      checked={row.getIsSelected()}
      disabled={!row.getCanSelect()}
      onChange={row.getToggleSelectedHandler()}
      className="h-4 w-4 cursor-pointer accent-verdigris-400"
    />
  );
}

/** A yes/no switch. Used for the active column. */
export function Switch({
  checked,
  onChange,
  label,
  busy,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={`switch-track relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${
        checked
          ? "switch-on border-verdigris-300/40 bg-verdigris-400/80"
          : "switch-off border-verdigris-300/20 bg-ink-900/70"
      } ${busy ? "animate-pulse" : ""}`}
    >
      <span
        aria-hidden
        className={`inline-block h-3.5 w-3.5 transform rounded-full transition-transform ${
          checked ? "translate-x-[1.1rem] bg-ink-900" : "translate-x-0.5 bg-verdigris-200/60"
        }`}
      />
    </button>
  );
}

// ── client-mode chrome ────────────────────────────────────────────

const inputClass =
  "rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-1.5 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40";

function ClientToolbar<T>({
  table,
  label,
  singular,
  value,
  onChange,
  action,
}: {
  table: Table<T>;
  label: string;
  singular?: string;
  value: string;
  onChange: (v: string) => void;
  action?: ReactNode;
}) {
  const total = table.getPrePaginationRowModel().rows.length;
  const all = table.getCoreRowModel().rows.length;
  return (
    /**
     * The same two rows as `ListToolbar`, so a list does not rearrange
     * itself when you move between screens. These four are filtered in
     * the browser and have no filter selects of their own, so row two
     * carries only the page size — a thinner row than the master
     * screens have, in the same place.
     *
     * Plain flex, not the grid the other toolbar needs: there is no form
     * here to keep the Add button out of. Nothing is submitted; typing
     * filters the rows already in memory.
     */
    <div className="border-b border-verdigris-300/10 px-5 py-4">
      <h2 className="text-sm font-semibold text-verdigris-50">
        {countLabel(total, label, singular)}
        {total !== all ? (
          <span className="ml-2 font-normal text-verdigris-200/45">of {all}</span>
        ) : null}
      </h2>

      <div className="mt-3 flex items-center gap-2">
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Search ${label}`}
          aria-label={`Search ${label}`}
          className={`${inputClass} min-w-0 flex-1`}
        />
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={table.getState().pagination.pageSize}
          onChange={(e) => table.setPageSize(Number(e.target.value))}
          aria-label="Rows per page"
          className={`${inputClass} pr-7`}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n} className="bg-ink-850">
              {n} / page
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function ClientPager<T>({ table }: { table: Table<T> }) {
  const pages = table.getPageCount();
  if (pages <= 1) return null;
  const page = table.getState().pagination.pageIndex + 1;
  const btn =
    "rounded-lg px-2.5 py-1 text-xs text-verdigris-200/70 transition-colors hover:bg-verdigris-100/5 hover:text-verdigris-100 disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-2 border-t border-verdigris-300/10 px-5 py-3"
    >
      <span className="text-xs text-verdigris-200/45">
        Page {page} of {pages}
      </span>
      <div className="flex items-center gap-1">
        <button type="button" className={btn} onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
          ‹ Prev
        </button>
        <span className="rounded-lg bg-verdigris-500/15 px-2.5 py-1 text-xs text-verdigris-50">{page}</span>
        <button type="button" className={btn} onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
          Next ›
        </button>
      </div>
    </nav>
  );
}
