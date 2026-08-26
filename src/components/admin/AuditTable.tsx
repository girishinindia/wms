"use client";

import { type ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";

import type { ListState } from "@/lib/admin/listing";
import { fmtDay, fmtTime } from "@/lib/format/datetime";

import AuditDetail from "./AuditDetail";
import DataTable from "./DataTable";
import type { ColumnMeta } from "./DataTable";

/**
 * The audit log, as a list.
 *
 * A summary only: who, what, to which record, when, and whether it was
 * allowed. The payload — `before`, `after`, IP, user agent — is one
 * click away in a drawer, because it carries contact details, GSTIN and
 * PAN, and a hundred rows of that on every page is a data-protection
 * problem dressed as a convenience.
 *
 * No selection checkboxes and no bulk actions, because there is nothing
 * to do TO an audit row. The table is append-only at the database — a
 * trigger refuses UPDATE and DELETE outright — so a tick box would only
 * ever lead to a button that cannot work.
 */

export type AuditRow = {
  id: string;
  occurredAt: string;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  operation: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  result: string;
  reason: string | null;
  hasDetail: boolean;
};

const TONE: Record<string, string> = {
  SUCCESS: "border-verdigris-400/30 text-verdigris-200/80",
  DENIED: "border-rose-400/40 text-rose-200",
  FAILED: "border-amber-400/40 text-amber-200",
};

function ResultPill({ value }: { value: string }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[0.68rem] font-medium uppercase tracking-wide ${
        TONE[value] ?? "border-verdigris-300/20 text-verdigris-200/70"
      }`}
    >
      {value.toLowerCase()}
    </span>
  );
}

export default function AuditTable({
  rows,
  list,
  filters,
}: {
  rows: AuditRow[];
  list: ListState;
  filters: React.ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const columns = useMemo<ColumnDef<AuditRow, unknown>[]>(
    () => [
      {
        accessorKey: "occurredAt",
        header: "When",
        meta: { className: "whitespace-nowrap text-xs text-verdigris-200/75" } satisfies ColumnMeta,
        cell: ({ getValue }) => {
          const iso = String(getValue());
          return (
            <>
              <span className="block text-verdigris-100">{fmtDay(iso)}</span>
              <span className="block text-[0.72rem] text-verdigris-200/65">{fmtTime(iso)}</span>
            </>
          );
        },
      },
      {
        id: "actor",
        header: "Who",
        cell: ({ row }) => (
          <>
            <span className="block text-sm text-verdigris-100">
              {row.original.actorName ?? <span className="text-verdigris-200/50">not signed in</span>}
            </span>
            {row.original.actorEmail ? (
              <span className="block text-[0.72rem] text-verdigris-200/65">
                {row.original.actorEmail}
              </span>
            ) : null}
          </>
        ),
      },
      {
        accessorKey: "action",
        header: "Did",
        meta: { mono: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <>
            <span className="block font-mono text-[0.76rem] text-verdigris-100">
              {row.original.action}
            </span>
            {row.original.reason ? (
              <span className="mt-0.5 line-clamp-1 block text-[0.72rem] text-verdigris-200/70">
                {row.original.reason}
              </span>
            ) : null}
          </>
        ),
      },
      {
        id: "entity",
        header: "To",
        cell: ({ row }) => (
          <>
            <span className="block text-xs text-verdigris-200/80">
              {row.original.entityType} #{row.original.entityId}
            </span>
            {row.original.entityLabel ? (
              <span className="mt-0.5 line-clamp-1 block text-[0.72rem] text-verdigris-200/65">
                {row.original.entityLabel}
              </span>
            ) : null}
          </>
        ),
      },
      {
        accessorKey: "result",
        header: "Result",
        meta: { className: "whitespace-nowrap" } satisfies ColumnMeta,
        cell: ({ row }) => <ResultPill value={row.original.result} />,
      },
      {
        id: "open",
        header: "",
        meta: { className: "whitespace-nowrap text-right" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => setOpen(row.original.id)}
            className="rounded-lg border border-verdigris-300/20 px-2.5 py-1 text-xs text-verdigris-100 transition-colors hover:border-verdigris-300/50"
          >
            {row.original.hasDetail ? "Details" : "Open"}
          </button>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        list={list}
        base="/admin/audit"
        label="entries"
        singular="entry"
        filters={filters}
        // Nothing here is active or inactive, and nothing can be
        // selected or acted on — the table is append-only.
        showStatus={false}
        enableSelection={false}
        emptyTitle="Nothing in this window"
        emptyHint="Widen the period, or clear the filters."
      />
      {open ? <AuditDetail id={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
