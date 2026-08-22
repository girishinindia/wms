"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";

import { EyeIcon, PencilIcon, TrashIcon } from "@/components/icons";
import { useToast } from "@/components/Toast";
import type { GeoOptions } from "@/lib/admin/geo";
import { api } from "@/lib/api/client";

import DataTable, { type ColumnMeta } from "./DataTable";
import ImporterEditDrawer, { type ImporterEditValues } from "./ImporterEditDrawer";
import { ConfirmDialog, IconButton, StatusBadge } from "./ui";

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
  /** Everything the edit drawer needs, so the pencil opens a filled form
   *  without a second round trip per row. */
  edit: ImporterEditValues;
  countryId: string;
  stateId: string;
};

/**
 * The importer list on DataTable, client mode: the page hands over the
 * whole list (a couple of hundred rows at most) and TanStack sorts,
 * searches and pages it in memory. The status tabs stay server-side —
 * they change the query.
 *
 * The row actions are the same three the sales-agent list has — view,
 * edit, delete — because they are the same three things an operator does
 * to a row, and having them in one place on one screen and three places
 * on another is how a portal starts to feel improvised.
 */
export default function ImportersTable({
  rows,
  geo,
  canEdit,
  canDelete,
  action,
}: {
  rows: ImporterListRow[];
  geo: GeoOptions;
  canEdit: boolean;
  canDelete: boolean;
  /**
   * The Add button.
   *
   * It used to hang off `PageHeader`, above the status tabs — the one
   * list in the admin where Add was not beside the search box. Same
   * button and same drawer; it just sits where every other list keeps
   * it.
   */
  action?: ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState<{ id: number; name: string } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  /**
   * Delete is the life-cycle endpoint, not a row delete: the company's
   * owner login, its sales agents and their logins all close with it.
   * Same call the detail page makes, same cascade, same audit trail.
   */
  async function remove() {
    if (!confirm) return;
    if (reason.trim().length < 3) {
      toast.error("Give a short reason — it goes to the audit log.");
      return;
    }
    setBusy(true);
    const result = await api(`/admin/importers/${confirm.id}/lifecycle`, {
      body: { action: "delete", reason: reason.trim() },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success(`${confirm.name} deleted, with its logins and sales agents.`);
    setConfirm(null);
    setReason("");
    router.refresh();
  }

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
        meta: { className: "whitespace-nowrap text-right" } satisfies ColumnMeta,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span className="inline-flex items-center gap-1.5">
              {/* A link rather than a button: opening a company in a new
                  tab is worth keeping, and middle-click is how people do
                  it. Styled to match IconButton exactly. */}
              <a
                href={`/admin/importers/${r.id}`}
                aria-label={`View ${r.companyName}`}
                title="View"
                className="inline-grid h-8 w-8 place-items-center rounded-lg border border-verdigris-300/15 text-verdigris-200/75 transition-colors hover:border-verdigris-300/40 hover:text-verdigris-50"
              >
                <EyeIcon className="h-4 w-4" />
              </a>
              {canEdit ? (
                <ImporterEditDrawer
                  importerId={r.id}
                  companyName={r.companyName}
                  geo={geo}
                  initial={r.edit}
                  initialCountryId={r.countryId}
                  initialStateId={r.stateId}
                  verified={r.status !== "PENDING"}
                  trigger={(open) => (
                    <IconButton
                      label={`Edit ${r.companyName}`}
                      onClick={open}
                      icon={<PencilIcon className="h-4 w-4" />}
                    />
                  )}
                />
              ) : null}
              {canDelete ? (
                <IconButton
                  label={`Delete ${r.companyName}`}
                  tone="danger"
                  onClick={() => {
                    setReason("");
                    setConfirm({ id: r.id, name: r.companyName });
                  }}
                  icon={<TrashIcon className="h-4 w-4" />}
                />
              ) : null}
            </span>
          );
        },
      },
    ],
    [canEdit, canDelete, geo],
  );

  return (
    <>
      <DataTable<ImporterListRow>
        columns={columns}
        data={rows}
        label="importers"
        action={action}
        enableSelection={false}
        searchKeys={["code", "companyName", "contactPerson", "contactEmail", "contactMobile", "status", "kycStatus"]}
        emptyTitle="No importers here."
        emptyHint="A registration appears once the applicant has verified both their email address and their mobile number."
      />

      {confirm ? (
        <ConfirmDialog
          title={`Delete ${confirm.name}?`}
          message="The company, its owner login, its sales agents and their logins are all closed. The audit log keeps a copy. This cannot be undone from the portal."
          confirmLabel="Delete company"
          busy={busy}
          onConfirm={remove}
          onCancel={() => {
            setConfirm(null);
            setReason("");
          }}
        >
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (kept in the audit log)"
            className="mt-4 w-full rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40"
          />
        </ConfirmDialog>
      ) : null}
    </>
  );
}
