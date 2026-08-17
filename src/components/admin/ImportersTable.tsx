"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";

import { EyeIcon } from "@/components/icons";

import DataTable, { type ColumnMeta } from "./DataTable";
import { StatusBadge } from "./ui";

export type ImporterListRow = {
  id: number;
  code: string;
  companyName: string;
  contactPerson: string;
  contactEmail: string;
  contactMobile: string;
  status: string;
  kycStatus: string;
  createdAt: string;
};

/**
 * The importer list on DataTable, client mode: the page hands over the
 * whole list (a couple of hundred rows at most) and TanStack sorts,
 * searches and pages it in memory. The status tabs stay server-side —
 * they change the query.
 */
export default function ImportersTable({ rows }: { rows: ImporterListRow[] }) {
  const columns = useMemo<ColumnDef<ImporterListRow, unknown>[]>(
    () => [
      {
        accessorKey: "code",
        header: "Code",
        meta: { mono: true, width: 7 } satisfies ColumnMeta,
        cell: ({ row }) => (
          <a href={`/admin/importers/${row.original.id}`} className="hover:text-patina">
            {row.original.code}
          </a>
        ),
      },
      {
        accessorKey: "companyName",
        header: "Company",
        cell: ({ row }) => (
          <a href={`/admin/importers/${row.original.id}`} className="font-medium hover:text-patina">
            {row.original.companyName}
          </a>
        ),
      },
      {
        accessorKey: "contactPerson",
        header: "Contact",
        cell: ({ row }) => (
          <span className="text-verdigris-200/60">
            <span className="block">{row.original.contactPerson}</span>
            <span className="block text-xs text-verdigris-200/40">{row.original.contactEmail}</span>
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ getValue }) => <StatusBadge value={String(getValue())} />,
      },
      {
        accessorKey: "kycStatus",
        header: "KYC",
        cell: ({ getValue }) => <StatusBadge value={String(getValue())} />,
      },
      {
        accessorKey: "createdAt",
        header: "Registered",
        meta: { className: "whitespace-nowrap text-xs text-verdigris-200/50" } satisfies ColumnMeta,
        cell: ({ getValue }) =>
          new Date(String(getValue())).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            // Pinned: the server renders in UTC and the browser in IST,
            // and a date that flips across midnight between the two is a
            // hydration mismatch.
            timeZone: "Asia/Kolkata",
          }),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { className: "text-right" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <a
            href={`/admin/importers/${row.original.id}`}
            aria-label={`View ${row.original.companyName}`}
            title="View"
            className="inline-grid h-8 w-8 place-items-center rounded-lg border border-verdigris-300/15 text-verdigris-200/75 transition-colors hover:border-verdigris-300/40 hover:text-verdigris-50"
          >
            <EyeIcon className="h-4 w-4" />
          </a>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable<ImporterListRow>
      columns={columns}
      data={rows}
      label="importers"
      enableSelection={false}
      searchKeys={["code", "companyName", "contactPerson", "contactEmail", "contactMobile", "status", "kycStatus"]}
      emptyTitle="No importers here."
      emptyHint="A registration appears once the applicant has verified both their email address and their mobile number."
    />
  );
}
