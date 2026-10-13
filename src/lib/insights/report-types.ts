/** Report catalogue and results — safe for the browser and the app. */

export type ColType = "text" | "int" | "num" | "money" | "pct" | "date" | "datetime" | "hours" | "days";

export type Column = { key: string; label: string; type: ColType; total?: boolean };

export type StatusOption = { value: string; label: string };

export type ReportMeta = {
  key: string;
  /** R1 … R35 — the number in the catalogue. */
  no: string;
  group: string;
  title: string;
  description: string;
  /** Uses the period filter (false: a snapshot as of now). */
  period: boolean;
  /** Offers the warehouse / importer filters (when the person may see more than one). */
  warehouse: boolean;
  importer: boolean;
  statuses: StatusOption[];
  columns: Column[];
};

export type ReportResult = {
  meta: ReportMeta;
  filters: { period: string; from: string; to: string; warehouseId: number | null; importerId: number | null; status: string | null };
  options: { warehouses: { id: number; label: string }[]; importers: { id: number; label: string }[] };
  rows: Record<string, string | number | null>[];
  /** All matching rows (the preview shows the first PREVIEW_ROWS). */
  count: number;
  totals: Record<string, number>;
  generatedAt: string;
};

export const REPORT_GROUPS = ["Inward", "Stock", "Storage billing", "Delivery notes", "Pick and pack", "Outward and LR", "Expenses", "Admin"] as const;

export const PREVIEW_ROWS = 500;
export const EXPORT_ROWS = 50_000;
