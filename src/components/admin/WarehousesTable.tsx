"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";

import { EyeIcon, ImageIcon, PencilIcon, TrashIcon } from "@/components/icons";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";
import type { ListState } from "@/lib/admin/listing";

import DataTable, { SelectAllHeader, SelectRowCell, Switch, type ColumnMeta } from "./DataTable";
import { Card, ConfirmDialog, IconButton } from "./ui";
import WarehouseDrawer, { type WarehouseValues } from "./WarehouseDrawer";

export type TypeOption = { id: number; name: string };
export type CityOption = { id: number; name: string; stateId: number; stateName: string; countryId: number };

export type WarehouseRow = {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
  typeName: string | null;
  cityLabel: string | null;
  totalAreaSqft: number | null;
  photos: number;
  /** "2 staff, 1 transporters" — empty when nothing is attached. */
  inUse: string;
  edit: WarehouseValues;
  flags: { hasRacking: boolean; hasCctv: boolean; hasWeighbridge: boolean };
  countryId: string;
  stateId: string;
};

/**
 * The warehouse list, on the same DataTable in server mode that the
 * master screens use — so search, filters, sort, page size and paging
 * are the same controls doing the same thing, not a second
 * implementation that drifts.
 */
export default function WarehousesTable({
  rows,
  list,
  base,
  filters,
  types,
  cities,
}: {
  rows: WarehouseRow[];
  list: ListState;
  base: string;
  filters: ReactNode;
  types: TypeOption[];
  cities: CityOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState<{ id: number; label: string; inUse: string } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  /** Which row's switch is mid-flight. Separate from `busy`, which
   *  belongs to the delete dialog. */
  const [toggling, setToggling] = useState<number | null>(null);

  /**
   * Switch a site on or off from the list, the way the master screens do.
   *
   * Worth knowing what this now does: `is_active` is also the gate on the
   * public website, so switching a warehouse off takes its page down and
   * removes it from /warehouses. The toast says so — it is not a change
   * anybody should have to discover.
   */
  async function toggle(row: WarehouseRow) {
    setToggling(row.id);
    const result = await api<{ ok: true }>(`/admin/warehouses/${row.id}`, {
      method: "PATCH",
      body: { isActive: !row.isActive },
    });
    setToggling(null);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success(
      row.isActive ? `${row.name} deactivated — it is off the public site now.` : `${row.name} activated.`,
    );
    router.refresh();
  }

  async function remove() {
    if (!confirm) return;
    if (reason.trim().length < 3) {
      toast.error("Give a short reason — it goes to the audit log.");
      return;
    }
    setBusy(true);
    const result = await api(`/admin/warehouses/${confirm.id}`, {
      method: "DELETE",
      body: { reason: reason.trim() },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success(`${confirm.label} deleted.`);
    setConfirm(null);
    setReason("");
    router.refresh();
  }

  const columns = useMemo<ColumnDef<WarehouseRow, unknown>[]>(
    () => [
      {
        id: "select",
        enableSorting: false,
        header: ({ table }) => <SelectAllHeader table={table} />,
        cell: ({ row }) => <SelectRowCell row={row} label={row.original.name} />,
        meta: { width: 2.5 } satisfies ColumnMeta,
      },
      {
        accessorKey: "code",
        header: "Code",
        meta: { mono: true, width: 7 } satisfies ColumnMeta,
      },
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <span className="font-medium">
            <span className="block whitespace-nowrap">{row.original.name}</span>
            {row.original.photos > 0 ? (
              <a
                href={`/admin/warehouses/gallery?warehouse=${row.original.id}`}
                className="mt-0.5 inline-flex items-center gap-1 text-xs font-normal text-verdigris-200/55 hover:text-patina"
              >
                <ImageIcon className="h-3 w-3" />
                {row.original.photos} {row.original.photos === 1 ? "photo" : "photos"}
              </a>
            ) : null}
          </span>
        ),
      },
      /**
       * `id`, not `accessorKey` — and that is a fix, not a style choice.
       *
       * In server mode the sort link is built from `column.id`, and the
       * page only accepts the keys in its `sortable` list: type, city,
       * status. Keyed off the field names these columns emitted
       * `sort=typeName`, `sort=cityLabel` and `sort=isActive`, which
       * `parseListQuery` does not recognise, so it fell back to the
       * default and clicking those three headers did nothing at all —
       * silently, because the URL still changed.
       */
      {
        id: "type",
        accessorFn: (r) => r.typeName,
        header: "Type",
        cell: ({ getValue }) => String(getValue() ?? "—"),
      },
      {
        id: "city",
        accessorFn: (r) => r.cityLabel,
        header: "City",
        cell: ({ getValue }) => String(getValue() ?? "—"),
      },
      {
        id: "totalAreaSqft",
        accessorFn: (r) => r.totalAreaSqft,
        header: "Total sqft",
        meta: { align: "right", mono: true } satisfies ColumnMeta,
        cell: ({ getValue }) => {
          const v = getValue();
          return v === null || v === undefined ? "—" : Number(v).toLocaleString("en-IN");
        },
      },
      {
        id: "status",
        accessorFn: (r) => r.isActive,
        header: "Active",
        cell: ({ row }) => (
          <Switch
            checked={row.original.isActive}
            busy={toggling === row.original.id}
            label={
              row.original.isActive
                ? `Deactivate ${row.original.name}`
                : `Activate ${row.original.name}`
            }
            onChange={() => toggle(row.original)}
          />
        ),
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
                href={`/admin/warehouses/gallery?warehouse=${r.id}`}
                aria-label={`Gallery for ${r.name}`}
                title="Gallery"
                className="inline-grid h-8 w-8 place-items-center rounded-lg border border-verdigris-300/15 text-verdigris-200/75 transition-colors hover:border-verdigris-300/40 hover:text-verdigris-50"
              >
                <ImageIcon className="h-4 w-4" />
              </a>
              <WarehouseDrawer
                mode="view"
                warehouse={r}
                types={types}
                cities={cities}
                trigger={(open) => (
                  <IconButton label={`View ${r.name}`} onClick={open} icon={<EyeIcon className="h-4 w-4" />} />
                )}
              />
              <WarehouseDrawer
                mode="edit"
                warehouse={r}
                types={types}
                cities={cities}
                trigger={(open) => (
                  <IconButton label={`Edit ${r.name}`} onClick={open} icon={<PencilIcon className="h-4 w-4" />} />
                )}
              />
              <IconButton
                label={`Delete ${r.name}`}
                tone="danger"
                onClick={() => {
                  setReason("");
                  setConfirm({ id: r.id, label: r.name, inUse: r.inUse });
                }}
                icon={<TrashIcon className="h-4 w-4" />}
              />
            </span>
          );
        },
      },
    ],
    // `toggle` is rebuilt every render and would defeat the memo; the
    // row id it is mid-flight on is what actually has to re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [types, cities, toggling],
  );

  const filtered = list.q !== "" || list.status !== "all" || Object.keys(list.extra).length > 0;

  return (
    <>
      <Card>
        <DataTable<WarehouseRow>
          columns={columns}
          data={rows}
          list={list}
          base={base}
          label="warehouses"
          filters={filters}
          enableSelection={false}
          emptyTitle={filtered ? "Nothing matches that search." : "No warehouses yet."}
          rowClassName={(row) => (row.original.isActive ? "" : "opacity-60")}
          action={
            <WarehouseDrawer
              mode="create"
              types={types}
              cities={cities}
              trigger={(open) => (
                <button
                  type="button"
                  onClick={open}
                  className="rounded-lg bg-verdigris-400 px-4 py-1.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina"
                >
                  Add warehouse
                </button>
              )}
            />
          }
        />
      </Card>

      {confirm ? (
        <ConfirmDialog
          title={`Delete ${confirm.label}?`}
          message={
            confirm.inUse
              ? `This warehouse still has ${confirm.inUse} attached. Move them first — the delete will be refused while anybody is posted here.`
              : "The warehouse is retired and its gallery photos are deleted from storage for good. The audit log keeps a copy of the record."
          }
          confirmLabel="Delete warehouse"
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
