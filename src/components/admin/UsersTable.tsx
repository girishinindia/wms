"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";

import { EyeIcon } from "@/components/icons";

import DataTable, { type ColumnMeta } from "./DataTable";
import { StatusBadge } from "./ui";

export type UserListRow = {
  id: number;
  name: string;
  email: string;
  mobile: string;
  status: string;
  emailVerified: boolean;
  mobileVerified: boolean;
  roles: string[];
  lastLoginAt: string | null;
};

/** The user list on DataTable, client mode. */
export default function UsersTable({ rows }: { rows: UserListRow[] }) {
  const columns = useMemo<ColumnDef<UserListRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <a href={`/admin/users/${row.original.id}`} className="font-medium hover:text-patina">
            {row.original.name}
          </a>
        ),
      },
      {
        accessorKey: "email",
        header: "Contact",
        cell: ({ row }) => (
          <span className="text-verdigris-200/60">
            <span className="block text-xs">
              {row.original.email}{" "}
              {row.original.emailVerified ? null : <span className="text-amber-300">unverified</span>}
            </span>
            <span className="block text-xs text-verdigris-200/40">
              {row.original.mobile}{" "}
              {row.original.mobileVerified ? null : <span className="text-amber-300">unverified</span>}
            </span>
          </span>
        ),
      },
      {
        id: "roles",
        accessorFn: (r) => r.roles.join(" "),
        header: "Roles",
        cell: ({ row }) =>
          row.original.roles.length > 0 ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-verdigris-300">
              {row.original.roles.join(" · ")}
            </span>
          ) : (
            <span className="text-xs text-amber-300">none</span>
          ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ getValue }) => <StatusBadge value={String(getValue())} />,
      },
      {
        accessorKey: "lastLoginAt",
        header: "Last seen",
        meta: { className: "whitespace-nowrap text-xs text-verdigris-200/50" } satisfies ColumnMeta,
        sortUndefined: "last",
        cell: ({ getValue }) => {
          const v = getValue() as string | null;
          return v
            ? new Date(v).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })
            : "never";
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { className: "text-right" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <a
            href={`/admin/users/${row.original.id}`}
            aria-label={`View ${row.original.name}`}
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
    <DataTable<UserListRow>
      columns={columns}
      data={rows}
      label="users"
      enableSelection={false}
      searchKeys={["name", "email", "mobile", "status"]}
      emptyTitle="No users yet."
    />
  );
}
