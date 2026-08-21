"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { EyeIcon, TrashIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";

import DataTable, { SelectAllHeader, SelectRowCell, Switch, type ColumnMeta } from "./DataTable";
import { ConfirmDialog, IconButton, StatusBadge } from "./ui";

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
  isSuperAdmin: boolean;
  /** The importer an IMPORTER / SALES_AGENT login belongs to. */
  company: string | null;
};

/**
 * Every login on DataTable, client mode — same chrome as every other list:
 * multi-select with a bulk bar, the Active switch second-last, view and
 * delete last.
 *
 * Deactivating or deleting here reaches the company or the sales-agent
 * profile behind the login (lifecycle.ts), which is why the confirm text
 * says so. Super admins and your own row have no switch and no bin.
 */
export default function UsersTable({
  rows,
  canUpdate,
  canDelete,
  selfId,
}: {
  rows: UserListRow[];
  canUpdate: boolean;
  canDelete: boolean;
  selfId: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<number | "bulk" | null>(null);
  const [confirm, setConfirm] = useState<{ ids: number[]; label: string } | null>(null);

  const locked = (r: UserListRow) => r.isSuperAdmin || r.id === selfId;

  async function toggle(row: UserListRow) {
    setBusy(row.id);
    const next = row.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    const result = await api<{ ok: true; importerId: number | null; agentId: number | null }>(
      `/admin/users/${row.id}/status`,
      { method: "PATCH", body: { status: next, reason: next === "SUSPENDED" ? "Deactivated from the users screen" : undefined } },
    );
    setBusy(null);
    if (!result.ok) { toast.error(result.error.message); return; }
    const also = result.data.importerId ? " Their company and its sales agents followed." : result.data.agentId ? " Their sales-agent profile followed." : "";
    toast.success((next === "SUSPENDED" ? "Deactivated." : "Activated.") + also);
    router.refresh();
  }

  async function bulk(action: "activate" | "deactivate" | "delete", ids: number[]) {
    setBusy("bulk");
    const result = await api<{ done: number[]; skipped: { id: number; reason: string }[] }>("/admin/users/bulk", { body: { action, ids } });
    setBusy(null);
    setConfirm(null);
    if (!result.ok) { toast.error(result.error.message); return; }
    const verb = action === "delete" ? "Deleted" : action === "activate" ? "Activated" : "Deactivated";
    const { done, skipped } = result.data;
    const parts = [`${verb} ${done.length}.`];
    if (skipped.length) parts.push(`Skipped ${skipped.length} — ${skipped[0]!.reason}.`);
    (skipped.length && !done.length ? toast.error : toast.success)(parts.join(" "));
    router.refresh();
  }

  const columns = useMemo<ColumnDef<UserListRow, unknown>[]>(() => {
    const cols: ColumnDef<UserListRow, unknown>[] = [];
    if (canUpdate || canDelete) {
      cols.push({
        id: "select", enableSorting: false,
        header: ({ table }) => <SelectAllHeader table={table} />,
        cell: ({ row }) => (locked(row.original) ? null : <SelectRowCell row={row} label={row.original.name} />),
        meta: { width: 2.5 } satisfies ColumnMeta,
      });
    }
    cols.push(
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
            <span className="font-mono text-[0.72rem] uppercase tracking-[0.1em] text-verdigris-300">
              {row.original.roles.join(" · ")}
            </span>
          ) : (
            <span className="text-xs text-amber-300">none</span>
          ),
      },
      {
        id: "company",
        accessorFn: (r) => r.company ?? "",
        header: "Company",
        cell: ({ row }) => row.original.company ?? <span className="text-verdigris-200/35">—</span>,
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
        id: "active",
        accessorFn: (r) => r.status === "ACTIVE",
        header: "Active",
        cell: ({ row }) => {
          const r = row.original;
          if (!canUpdate || locked(r)) return <StatusBadge value={r.status === "ACTIVE" ? "ACTIVE" : "SUSPENDED"} />;
          return (
            <Switch
              checked={r.status === "ACTIVE"}
              busy={busy === r.id}
              disabled={r.status === "PENDING"}
              label={r.status === "ACTIVE" ? `Deactivate ${r.name}` : `Activate ${r.name}`}
              onChange={() => toggle(r)}
            />
          );
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { className: "whitespace-nowrap text-right" } satisfies ColumnMeta,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span className="inline-flex items-center gap-1.5">
              <a
                href={`/admin/users/${r.id}`}
                aria-label={`View ${r.name}`}
                title="View"
                className="inline-grid h-8 w-8 place-items-center rounded-lg border border-verdigris-300/15 text-verdigris-200/75 transition-colors hover:border-verdigris-300/40 hover:text-verdigris-50"
              >
                <EyeIcon className="h-4 w-4" />
              </a>
              {canDelete && !locked(r) ? (
                <IconButton label={`Delete ${r.name}`} tone="danger" onClick={() => setConfirm({ ids: [r.id], label: r.name })} icon={<TrashIcon className="h-4 w-4" />} />
              ) : null}
            </span>
          );
        },
      },
    );
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUpdate, canDelete, selfId, busy]);

  return (
    <>
      <DataTable<UserListRow>
        columns={columns}
        data={rows}
        label="users"
        enableSelection={canUpdate || canDelete}
        searchKeys={["name", "email", "mobile", "status", "company"]}
        emptyTitle="No users yet."
        rowClassName={(row) => (row.original.status === "ACTIVE" ? "" : "opacity-60")}
        bulk={(selected, clear) => {
          const ids = selected.filter((r) => !locked(r)).map((r) => r.id);
          const b = "rounded-lg border px-3 py-1 text-xs transition-colors disabled:opacity-40";
          return (
            <>
              {canUpdate ? (
                <>
                  <button type="button" disabled={busy === "bulk" || !ids.length} onClick={() => bulk("activate", ids).then(clear)} className={`${b} border-verdigris-300/25 text-verdigris-100 hover:border-verdigris-300/50`}>Activate</button>
                  <button type="button" disabled={busy === "bulk" || !ids.length} onClick={() => bulk("deactivate", ids).then(clear)} className={`${b} border-verdigris-300/25 text-verdigris-100 hover:border-verdigris-300/50`}>Deactivate</button>
                </>
              ) : null}
              {canDelete ? (
                <button type="button" disabled={busy === "bulk" || !ids.length} onClick={() => setConfirm({ ids, label: `${ids.length} user${ids.length === 1 ? "" : "s"}` })} className={`${b} border-rose-400/30 text-rose-200 hover:border-rose-400/60`}>Delete</button>
              ) : null}
              {busy === "bulk" ? <Spinner className="h-3.5 w-3.5" /> : null}
            </>
          );
        }}
      />

      {confirm ? (
        <ConfirmDialog
          title={`Delete ${confirm.label}?`}
          message="The login is closed and, if it is an importer, their company and its sales agents go with it; a sales agent's profile goes too. The audit log keeps everything."
          confirmLabel="Delete"
          busy={busy === "bulk"}
          onConfirm={() => bulk("delete", confirm.ids)}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </>
  );
}
