/**
 * The shape every dashboard answers with — safe for the browser and the
 * app. The page (or the phone) only knows how to draw tiles, charts and
 * lists; what goes in them is decided on the server, per role.
 */

export type ValueFormat = "int" | "money" | "pct" | "hours" | "days" | "kg";
export type Tone = "default" | "good" | "warn" | "danger";

export type Tile = {
  key: string;
  label: string;
  value: number;
  format: ValueFormat;
  tone?: Tone;
  /** A short line under the number ("of 42 galas", "vs 1,204 last period"). */
  note?: string | null;
  /** The list this number came from. */
  href?: string | null;
};

export type Series = {
  name: string;
  data: number[];
  /** For a bar + line chart: which one this series is. */
  kind?: "bar" | "line";
  /** Draw on the right-hand axis. */
  right?: boolean;
  /** One of the palette slots, so meaning keeps its colour (in = teal, out = blue…). */
  color?: Color;
};

export type Color = "teal" | "blue" | "violet" | "amber" | "rose" | "slate" | "green" | "cyan";

export type ChartKind = "line" | "bar" | "hbar" | "stacked" | "donut" | "combo" | "funnel" | "heatmap";

export type HeatCell = { label: string; value: number; max: number; group: string; href?: string | null; note?: string | null };

export type Chart = {
  key: string;
  title: string;
  kind: ChartKind;
  labels: string[];
  series: Series[];
  format?: ValueFormat;
  /** Heat map cells (kind = heatmap). */
  cells?: HeatCell[];
  /** A sentence under the chart. */
  note?: string | null;
  /** Wide charts take the whole row. */
  wide?: boolean;
  /** Where a click on a bar or slice goes; `{label}` is replaced by the clicked label. */
  href?: string | null;
};

export type ListRow = { title: string; subtitle?: string | null; badge?: string | null; tone?: Tone; href?: string | null };

export type List = { key: string; title: string; rows: ListRow[]; empty: string; href?: string | null };

export type DashboardId = "executive" | "inward" | "storage" | "pickpack" | "outward" | "expenses" | "platform" | "importer" | "agent";

export type DashboardMeta = { id: DashboardId; title: string; subtitle: string; icon: string };

export type Option = { id: number; label: string };

export type DashboardData = {
  meta: DashboardMeta;
  /** The filters as applied (the server may have narrowed them). */
  filters: { period: string; from: string; to: string; warehouseId: number | null; importerId: number | null };
  /** What the filter bar may offer: only what the caller can see. */
  options: { warehouses: Option[]; importers: Option[] };
  tiles: Tile[];
  charts: Chart[];
  lists: List[];
  generatedAt: string;
};

export const PERIOD_LABELS: Record<string, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  month: "This month",
  fy: "This FY",
  custom: "Custom",
};
