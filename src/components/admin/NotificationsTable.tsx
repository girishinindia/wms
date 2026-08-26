"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { EyeIcon, TrashIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";
import { fmtDateTime } from "@/lib/format/datetime";

import DataTable, { SelectAllHeader, SelectRowCell, type ColumnMeta } from "./DataTable";
import { NOTIFICATIONS_CHANGED } from "./NotificationBell";
import { Card, ConfirmDialog, IconButton } from "./ui";

export type NotificationRow = {
  id: number;
  eventKey: string;
  title: string;
  body: string;
  actionUrl: string | null;
  createdAt: string;
  readAt: string | null;
};

/**
 * Every notification this account has, on the same DataTable as the rest
 * of the portal: search, 20 a page, multi-select with a bulk bar.
 *
 * Delete is a real delete — the row and its delivery records go — so it
 * always asks first, in the centred dialog, and says what else goes with
 * it. The audit log keeps the fact that it happened.
 */
export default function NotificationsTable({
  rows,
  unread,
}: {
  rows: NotificationRow[];
  unread: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<"bulk" | number | null>(null);
  const [confirm, setConfirm] = useState<{ ids: number[] | "all"; label: string } | null>(null);

  /** Keep the header bell honest without waiting for its next poll. */
  const announceChange = () => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));

  async function mark(read: boolean, ids: number[] | "all") {
    setBusy("bulk");
    const result = await api<{ marked: number }>("/notifications/read", {
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
    const result = await api<{ deleted: number }>("/notifications/delete", {
      body: ids === "all" ? { all: true } : { ids },
    });
    setBusy(null);
    setConfirm(null);
    if (!result.ok) { toast.error(result.error.message); return; }
    toast.success(`Deleted ${result.data.deleted}.`);
    announceChange();
    router.refresh();
  }

  /** Opening one marks it read and follows its link, like the bell does. */
  async function open(row: NotificationRow) {
    if (!row.readAt) {
      setBusy(row.id);
      await api("/notifications/read", { body: { ids: [row.id] } });
      setBusy(null);
      announceChange();
    }
    if (row.actionUrl && row.actionUrl.startsWith("/")) {
      window.location.assign(row.actionUrl);
      return;
    }
    router.refresh();
  }

  const columns = useMemo<ColumnDef<NotificationRow, unknown>[]>(
    () => [
      {
        id: "select",
        enableSorting: false,
        header: ({ table }) => <SelectAllHeader table={table} />,
        cell: ({ row }) => <SelectRowCell row={row} label={row.original.title} />,
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
        accessorKey: "title",
        header: "Notification",
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => open(row.original)}
            className="block max-w-xl text-left"
          >
            {/* Bold whatever the read state. Hanging the weight on
                "unread" left every title on a caught-up list rendering at
                the same weight as the body beneath it, with nothing to
                anchor the row. Read still reads differently — the colour
                steps back, the dot goes, the row dims. */}
            <span className={`block font-semibold ${row.original.readAt ? "text-verdigris-100" : "text-verdigris-50"}`}>
              {row.original.title}
            </span>
            {/*
              /80, not /65. At 12px on the card this is the sentence
              people actually read, and at /65 it painted #78958a —
              5.5:1, which clears AA and still reads as grey mush. It
              was also DIMMER than the `user.created` event key beside
              it, which is machine noise. /80 is 7.6:1, well clear of
              the title above it at 16.6:1 so the row keeps its
              hierarchy. Size is untouched.
            */}
            <span className="mt-0.5 line-clamp-2 block text-xs text-verdigris-200/80">
              {row.original.body}
            </span>
          </button>
        ),
      },
      {
        accessorKey: "eventKey",
        header: "Event",
        meta: { className: "whitespace-nowrap", mono: true } satisfies ColumnMeta,
        cell: ({ getValue }) => (
          <span className="text-verdigris-200/55">{String(getValue())}</span>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "When",
        // /75 rather than /60: at 4.8:1 the timestamp was the faintest
        // thing in the row, and a date nobody can read is a column
        // nobody uses.
        meta: { className: "whitespace-nowrap text-xs text-verdigris-200/75" } satisfies ColumnMeta,
        cell: ({ getValue }) =>
          fmtDateTime(String(getValue())),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { className: "whitespace-nowrap text-right" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <IconButton
              label={`Open ${row.original.title}`}
              busy={busy === row.original.id}
              onClick={() => open(row.original)}
              icon={<EyeIcon className="h-4 w-4" />}
            />
            <IconButton
              label={`Delete ${row.original.title}`}
              tone="danger"
              onClick={() => setConfirm({ ids: [row.original.id], label: "this notification" })}
              icon={<TrashIcon className="h-4 w-4" />}
            />
          </span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy],
  );

  const b = "rounded-lg border px-3 py-1 text-xs transition-colors disabled:opacity-40";

  return (
    <>
      <Card>
        <DataTable<NotificationRow>
          columns={columns}
          data={rows}
          label="notifications"
          searchKeys={["title", "body", "eventKey"]}
          emptyTitle="Nothing here."
          emptyHint="Notifications about registrations, approvals and your sales agents land here."
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
              {rows.length > 0 ? (
                <button
                  type="button"
                  disabled={busy === "bulk"}
                  onClick={() => setConfirm({ ids: "all", label: "every notification" })}
                  className={`${b} border-rose-400/30 text-rose-200 hover:border-rose-400/60`}
                >
                  Delete all
                </button>
              ) : null}
            </div>
          }
          bulk={(selected, clear) => {
            const ids = selected.map((r) => r.id);
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
                  onClick={() => setConfirm({ ids, label: `${ids.length} notification${ids.length === 1 ? "" : "s"}` })}
                  className={`${b} border-rose-400/30 text-rose-200 hover:border-rose-400/60`}>
                  Delete
                </button>
                {busy === "bulk" ? <Spinner className="h-3.5 w-3.5" /> : null}
              </>
            );
          }}
        />
      </Card>

      {confirm ? (
        <ConfirmDialog
          title={`Delete ${confirm.label}?`}
          message="Gone for good, along with the record of the emails and push messages sent for them. The audit log keeps that this happened, and when."
          confirmLabel="Delete"
          busy={busy === "bulk"}
          onConfirm={() => remove(confirm.ids)}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </>
  );
}
