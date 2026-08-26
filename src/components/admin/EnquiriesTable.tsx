"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { EyeIcon, TrashIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";
import { ENQUIRIES_CHANGED } from "@/lib/notifications/unread";

import DataTable, { SelectAllHeader, SelectRowCell, type ColumnMeta } from "./DataTable";
import EnquiryDetail from "./EnquiryDetail";
import { Card, ConfirmDialog, IconButton } from "./ui";

export type EnquiryRow = {
  id: number;
  name: string;
  email: string;
  mobile: string;
  subject: string;
  message: string;
  createdAt: string;
  readAt: string | null;
};

const b =
  "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-55";

/**
 * Everything the contact form has sent, on the same DataTable as the
 * rest of the panel: search, 20 a page, multi-select with a bulk bar.
 *
 * A shared inbox, not a personal one. Read state lives on the row
 * rather than per-viewer, so one super admin marking a message read
 * marks it read for the others too — which is the point of a shared
 * inbox and the opposite of how the notifications screen works.
 */
export default function EnquiriesTable({
  rows,
  unread,
}: {
  rows: EnquiryRow[];
  unread: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<"bulk" | number | null>(null);
  const [confirm, setConfirm] = useState<{ ids: number[] | "all"; label: string } | null>(null);
  const [open, setOpen] = useState<EnquiryRow | null>(null);

  /** Move the sidebar badge now rather than at the next poll. */
  const announceChange = () => window.dispatchEvent(new Event(ENQUIRIES_CHANGED));

  async function mark(read: boolean, ids: number[] | "all") {
    setBusy("bulk");
    const result = await api<{ marked: number }>("/admin/enquiries/read", {
      body: ids === "all" ? { all: true, read } : { ids, read },
    });
    setBusy(null);
    if (!result.ok) { toast.error(result.error.message); return; }
    toast.success(`${result.data.marked} marked as ${read ? "read" : "unread"}.`);
    announceChange();
    router.refresh();
  }

  async function remove(ids: number[] | "all") {
    setBusy("bulk");
    const result = await api<{ deleted: number }>("/admin/enquiries/delete", {
      body: ids === "all" ? { all: true } : { ids },
    });
    setBusy(null);
    setConfirm(null);
    if (!result.ok) { toast.error(result.error.message); return; }
    toast.success(`Removed ${result.data.deleted}.`);
    announceChange();
    router.refresh();
  }

  /** Opening one marks it read, the way opening an email does. */
  async function view(row: EnquiryRow) {
    setOpen(row);
    if (row.readAt) return;
    setBusy(row.id);
    await api("/admin/enquiries/read", { body: { ids: [row.id] } });
    setBusy(null);
    announceChange();
    router.refresh();
  }

  const columns = useMemo<ColumnDef<EnquiryRow, unknown>[]>(
    () => [
      {
        id: "select",
        enableSorting: false,
        header: ({ table }) => <SelectAllHeader table={table} />,
        cell: ({ row }) => <SelectRowCell row={row} label={row.original.subject} />,
        meta: { width: 2.5 } satisfies ColumnMeta,
      },
      {
        id: "unread",
        accessorFn: (r) => (r.readAt ? 1 : 0),
        header: "",
        enableSorting: true,
        meta: { width: 2 } satisfies ColumnMeta,
        cell: ({ row }) =>
          row.original.readAt ? (
            <span className="sr-only">Read</span>
          ) : (
            <span className="inline-block h-2 w-2 rounded-full bg-amber-400" title="Unread" />
          ),
      },
      {
        accessorKey: "subject",
        header: "Enquiry",
        cell: ({ row }) => (
          <button type="button" onClick={() => view(row.original)} className="block max-w-xl text-left">
            {/* Bold whatever the read state, for the same reason as the
                notifications list: hanging the weight on "unread" left a
                caught-up list with nothing anchoring each row. Read still
                reads differently — the dot goes and the row dims. */}
            <span className={`block font-semibold ${row.original.readAt ? "text-verdigris-100" : "text-verdigris-50"}`}>
              {row.original.subject}
            </span>
            <span className="mt-0.5 line-clamp-2 block text-xs text-verdigris-200/80">
              {row.original.message}
            </span>
          </button>
        ),
      },
      {
        accessorKey: "name",
        header: "From",
        meta: { width: 16 } satisfies ColumnMeta,
        cell: ({ row }) => (
          <div className="min-w-0">
            <span className="block truncate text-verdigris-100">{row.original.name}</span>
            {/*
              The address and number are the point of the row — this is
              a lead, and somebody is going to copy one of them. Mono so
              a digit cannot be misread, and `select-all` so one click
              takes the whole value rather than half of it.
            */}
            <a
              href={`mailto:${row.original.email}`}
              className="block truncate font-mono text-[0.72rem] text-verdigris-200/70 hover:text-patina"
            >
              {row.original.email}
            </a>
            <a
              href={`tel:+91${row.original.mobile}`}
              className="block font-mono text-[0.72rem] text-verdigris-200/70 hover:text-patina"
            >
              +91 {row.original.mobile}
            </a>
          </div>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Received",
        meta: { width: 11 } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-verdigris-200/70">
            {new Date(row.original.createdAt).toLocaleString("en-IN", {
              day: "2-digit", month: "short", year: "numeric",
              hour: "2-digit", minute: "2-digit",
            })}
          </span>
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        header: "",
        meta: { width: 6 } satisfies ColumnMeta,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1.5">
            <IconButton
              label={`View ${row.original.subject}`}
              icon={<EyeIcon className="h-4 w-4" />}
              busy={busy === row.original.id}
              onClick={() => view(row.original)}
            />
            <IconButton
              label={`Remove ${row.original.subject}`}
              tone="danger"
              icon={<TrashIcon className="h-4 w-4" />}
              onClick={() => setConfirm({ ids: [row.original.id], label: "this enquiry" })}
            />
          </div>
        ),
      },
    ],
    // `view` and `busy` are read inside the cells; without them the
    // spinner on a row would never appear.
    [busy], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <>
      <Card className="p-0">
        <DataTable
          data={rows}
          columns={columns}
          label="enquiries"
          searchKeys={["subject", "message", "name", "email", "mobile"]}
          emptyTitle="No enquiries yet."
          emptyHint="Messages sent from the contact form on the public site arrive here."
          rowClassName={(row) => (row.original.readAt ? "opacity-75" : "")}
          action={
            <div className="flex flex-wrap items-center gap-2">
              {unread > 0 ? (
                <button
                  type="button"
                  disabled={busy === "bulk"}
                  onClick={() => mark(true, "all")}
                  className={`${b} border-verdigris-300/25 text-verdigris-100 hover:border-verdigris-300/50`}
                >
                  Mark all read
                </button>
              ) : null}
            </div>
          }
          bulk={(selected, clear) => {
            const ids = selected.map((r) => r.id);
            const noun = `${ids.length} ${ids.length === 1 ? "enquiry" : "enquiries"}`;
            return (
              <>
                <button type="button" disabled={busy === "bulk"} onClick={() => mark(true, ids).then(clear)}
                  className={`${b} border-verdigris-300/25 text-verdigris-100 hover:border-verdigris-300/50`}>
                  Mark read
                </button>
                <button type="button" disabled={busy === "bulk"} onClick={() => mark(false, ids).then(clear)}
                  className={`${b} border-verdigris-300/25 text-verdigris-100 hover:border-verdigris-300/50`}>
                  Mark unread
                </button>
                <button type="button" disabled={busy === "bulk"}
                  onClick={() => setConfirm({ ids, label: noun })}
                  className={`${b} border-rose-400/30 text-rose-200 hover:border-rose-400/60`}>
                  Remove
                </button>
                {busy === "bulk" ? <Spinner className="h-3.5 w-3.5" /> : null}
              </>
            );
          }}
        />
      </Card>

      {open ? <EnquiryDetail row={open} onClose={() => setOpen(null)} /> : null}

      {confirm ? (
        <ConfirmDialog
          title={`Remove ${confirm.label}?`}
          message="It leaves this list for good. The record itself is kept, and the audit log holds who wrote in, their email and mobile, and what it was about — so a message removed by mistake is not lost, it just is not here."
          confirmLabel="Remove"
          busy={busy === "bulk"}
          onConfirm={() => remove(confirm.ids)}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </>
  );
}
