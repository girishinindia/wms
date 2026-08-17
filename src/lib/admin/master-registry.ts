import { z } from "@/lib/openapi/zod";

/**
 * The five master-data tables, described once.
 *
 * Five tables with the same shape would otherwise be five copies of the
 * same route handler differing only in a table name and a schema, and
 * five copies drift. So the shape lives here and the handler, the page
 * and the table component all read it — columns, filters, parent
 * pickers, in-use counts, validation, the lot.
 *
 * The important property is that NOTHING in this file ever comes from a
 * request. A URL segment selects an entry by key from a frozen record;
 * if it is not a key, the request is a 404 before any SQL is composed.
 * The table and column identifiers are therefore literals from this
 * file, which is what makes it safe for the handler to interpolate them
 * — a value from the request never reaches an identifier position.
 */

export type MasterFieldType = "text" | "number" | "select";

export type MasterField = {
  /** JSON key, camelCase. */
  key: string;
  /** SQL column, snake_case. From here, never from a request. */
  column: string;
  label: string;
  type: MasterFieldType;
  /** For `select`. Mirrors the table's CHECK constraint exactly. */
  options?: readonly string[];
  required?: boolean;
  /** Rendered in the mono face — codes, not prose. */
  mono?: boolean;
  align?: "left" | "right";
  /** Column width hint for the table, in rem. */
  width?: number;
  hint?: string;
  /** Offer this field as a dropdown filter above the table. Only
   *  meaningful for `select` fields. */
  filterable?: boolean;
};

export type MasterDependent = {
  table: string;
  column: string;
  /** "vehicles", so the count reads "3 vehicles". */
  noun: string;
};

export type MasterResource = {
  slug: string;
  table: string;
  label: string;
  singular: string;
  /** `master.vehicle_type`; the handler appends `.create` / `.update` /
   *  `.delete`. */
  permission: string;
  fields: MasterField[];
  /**
   * A foreign key to another master table, rendered as a select and
   * required on create. `country_id` on state; the cities screen has its
   * own for `state_id`.
   */
  parent?: {
    key: string;
    column: string;
    label: string;
    /** Where the options come from. Also a literal. */
    table: string;
    /** Column to show in the option. */
    labelColumn: string;
    /**
     * One level up, for narrowing the parent picker: a city's state is
     * chosen from a country first. Options come back grouped by it.
     */
    groupBy?: {
      /** Column on the parent table pointing at the group table. */
      column: string;
      table: string;
      labelColumn: string;
      label: string;
    };
  };
  /** Rows elsewhere that point at this one, for the in-use count. */
  dependents: MasterDependent[];
  /** What the unique index means, in words the user can act on. */
  conflict: string;
  /**
   * Sort, as a literal from this file. Inactive rows sink to the bottom
   * on every screen: a switched-off row is the exception and belongs out
   * of the way of the ones being worked on.
   */
  orderBy: string;
  createSchema: z.ZodTypeAny;
  updateSchema: z.ZodTypeAny;
  intro: string;
  /**
   * The audit columns every master table carries. Listed so the view
   * drawer can show them without the page guessing.
   */
  hasAudit: true;
  /**
   * When adding rows one at a time is the wrong shape. The create drawer
   * then takes many names in one box and posts them to `endpoint` as
   * `{ [parentKey]: id, names: string[] }`; the endpoint dedupes and
   * reports what it skipped. Cities: a state's cities arrive as a
   * pasted column, never one at a time.
   */
  bulkCreate?: { endpoint: string; label: string; hint: string; placeholder: string };
};

/** Fixed-width `char` columns pad on write. Trim and upper, or you store
 *  `"IN "` and every comparison against `"IN"` quietly fails. */
const code = (len: number, label: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .length(len, `${label} must be exactly ${len} characters`);

const name = (max: number) => z.string().trim().min(2).max(max);

/** An empty input means "not given", not "invalid". */
const optionalText = (max: number) =>
  z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.string().trim().max(max).optional(),
  );

const optionalNumber = (max: number) =>
  z.preprocess(
    (v) => (v === "" || v === null ? undefined : typeof v === "string" ? Number(v) : v),
    z.number().min(0).max(max).optional(),
  );

export const VEHICLE_CATEGORIES = [
  "THREE_WHEELER",
  "LCV",
  "MCV",
  "HCV",
  "TRAILER",
  "CONTAINER",
] as const;

/** Every update may also flip the row's availability. */
const withActive = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ ...shape, isActive: z.boolean().optional() });

// ── country ───────────────────────────────────────────────────────
const country: MasterResource = {
  slug: "countries",
  table: "country",
  label: "Countries",
  singular: "country",
  permission: "master.country",
  intro:
    "The root of every address in the system. States hang off this, and cities off those.",
  hasAudit: true,
  fields: [
    { key: "iso2", column: "iso2", label: "ISO2", type: "text", required: true, mono: true, width: 5 },
    { key: "iso3", column: "iso3", label: "ISO3", type: "text", required: true, mono: true, width: 5 },
    { key: "name", column: "name", label: "Name", type: "text", required: true },
    { key: "phoneCode", column: "phone_code", label: "Phone code", type: "text", mono: true, width: 7, hint: "with the +" },
    { key: "currencyCode", column: "currency_code", label: "Currency", type: "text", required: true, mono: true, width: 6 },
  ],
  dependents: [{ table: "state", column: "country_id", noun: "states" }],
  conflict: "A country with that ISO code already exists",
  orderBy: "name",
  createSchema: withActive({
    iso2: code(2, "ISO2"),
    iso3: code(3, "ISO3"),
    name: name(80),
    phoneCode: z.string().trim().max(6).default("+91"),
    currencyCode: code(3, "Currency code"),
  }),
  updateSchema: withActive({
    iso2: code(2, "ISO2").optional(),
    iso3: code(3, "ISO3").optional(),
    name: name(80).optional(),
    phoneCode: z.string().trim().max(6).optional(),
    currencyCode: code(3, "Currency code").optional(),
  }),
};

// ── state ─────────────────────────────────────────────────────────
const state: MasterResource = {
  slug: "states",
  table: "state",
  label: "States",
  singular: "state",
  permission: "master.state",
  intro:
    "The code is the GST state code, and it is what appears in a GSTIN — 27 is Maharashtra, 24 is Gujarat.",
  hasAudit: true,
  fields: [
    { key: "code", column: "code", label: "Code", type: "text", required: true, mono: true, width: 6 },
    { key: "name", column: "name", label: "Name", type: "text", required: true },
  ],
  parent: {
    key: "countryId",
    column: "country_id",
    label: "Country",
    table: "country",
    labelColumn: "name",
  },
  dependents: [{ table: "city", column: "state_id", noun: "cities" }],
  conflict: "That country already has a state with this code",
  orderBy: "name",
  createSchema: withActive({
    countryId: z.number().int().positive(),
    code: z.string().trim().toUpperCase().min(1).max(8),
    name: name(80),
  }),
  updateSchema: withActive({
    code: z.string().trim().toUpperCase().min(1).max(8).optional(),
    name: name(80).optional(),
  }),
};

// ── warehouse_type ────────────────────────────────────────────────
const warehouseType: MasterResource = {
  slug: "warehouse-types",
  table: "warehouse_type",
  label: "Warehouse types",
  singular: "warehouse type",
  permission: "master.warehouse_type",
  intro:
    "Bonded, CFS and FTWZ carry customs obligations a general warehouse does not, so the type is not cosmetic.",
  hasAudit: true,
  fields: [
    { key: "code", column: "code", label: "Code", type: "text", required: true, mono: true, width: 9 },
    { key: "name", column: "name", label: "Name", type: "text", required: true },
    { key: "description", column: "description", label: "Description", type: "text" },
  ],
  dependents: [{ table: "warehouse", column: "warehouse_type_id", noun: "warehouses" }],
  conflict: "A warehouse type with that code already exists",
  orderBy: "name",
  createSchema: withActive({
    code: z.string().trim().toUpperCase().min(2).max(24),
    name: name(80),
    description: optionalText(300),
  }),
  updateSchema: withActive({
    code: z.string().trim().toUpperCase().min(2).max(24).optional(),
    name: name(80).optional(),
    description: optionalText(300),
  }),
};

// ── vehicle_type ──────────────────────────────────────────────────
const vehicleType: MasterResource = {
  slug: "vehicle-types",
  table: "vehicle_type",
  label: "Vehicle types",
  singular: "vehicle type",
  permission: "master.vehicle_type",
  intro:
    "Capacity here is what a dispatch is planned against, so a wrong number becomes a vehicle that cannot take the load.",
  hasAudit: true,
  fields: [
    { key: "code", column: "code", label: "Code", type: "text", required: true, mono: true, width: 11 },
    { key: "name", column: "name", label: "Name", type: "text", required: true },
    {
      key: "category",
      column: "category",
      label: "Category",
      type: "select",
      // Exactly the six values in vehicle_type_category_check. A seventh
      // typed in a text box would be refused by the database.
      options: VEHICLE_CATEGORIES,
      required: true,
      width: 9,
      filterable: true,
    },
    { key: "axleCount", column: "axle_count", label: "Axles", type: "number", align: "right", width: 4 },
    { key: "capacityKg", column: "capacity_kg", label: "Kg", type: "number", align: "right", width: 6 },
    { key: "capacityCbm", column: "capacity_cbm", label: "Cbm", type: "number", align: "right", width: 5 },
    { key: "lengthFt", column: "length_ft", label: "L ft", type: "number", align: "right", width: 4 },
    { key: "widthFt", column: "width_ft", label: "W ft", type: "number", align: "right", width: 4 },
    { key: "heightFt", column: "height_ft", label: "H ft", type: "number", align: "right", width: 4 },
  ],
  dependents: [{ table: "vehicle", column: "vehicle_type_id", noun: "vehicles" }],
  conflict: "A vehicle type with that code already exists",
  orderBy: "capacity_kg nulls last, name",
  createSchema: withActive({
    code: z.string().trim().toUpperCase().min(2).max(24),
    name: name(80),
    category: z.enum(VEHICLE_CATEGORIES),
    axleCount: optionalNumber(12),
    capacityKg: optionalNumber(100_000),
    capacityCbm: optionalNumber(500),
    lengthFt: optionalNumber(80),
    widthFt: optionalNumber(20),
    heightFt: optionalNumber(20),
  }),
  updateSchema: withActive({
    code: z.string().trim().toUpperCase().min(2).max(24).optional(),
    name: name(80).optional(),
    category: z.enum(VEHICLE_CATEGORIES).optional(),
    axleCount: optionalNumber(12),
    capacityKg: optionalNumber(100_000),
    capacityCbm: optionalNumber(500),
    lengthFt: optionalNumber(80),
    widthFt: optionalNumber(20),
    heightFt: optionalNumber(20),
  }),
};


// ── city ──────────────────────────────────────────────────────────
/**
 * Cities used to have a screen of their own outside this registry, with
 * a bulk-paste form and its own route. The bulk paste is worth keeping
 * — a state's cities arrive as a pasted column, not one at a time — and
 * still lives at /api/v1/admin/cities. Everything else about the table
 * is the same shape as the other four, so it lives here now: one table
 * component, one route, one set of filters.
 *
 * Four tables point at a city, which is why deleting one is refused far
 * more often than for the others.
 */
const city: MasterResource = {
  slug: "cities",
  table: "city",
  label: "Cities",
  singular: "city",
  permission: "master.city",
  intro: "Addresses on importers, warehouses and transporters all resolve to this list.",
  hasAudit: true,
  bulkCreate: {
    endpoint: "/admin/cities",
    label: "Cities",
    hint: "One per line, or comma separated. Paste a whole column if you have one.",
    placeholder: "Mumbai\nThane\nNavi Mumbai\nPune",
  },
  fields: [{ key: "name", column: "name", label: "Name", type: "text", required: true }],
  parent: {
    key: "stateId",
    column: "state_id",
    label: "State",
    table: "state",
    labelColumn: "name",
    groupBy: { column: "country_id", table: "country", labelColumn: "name", label: "Country" },
  },
  dependents: [
    { table: "warehouse", column: "city_id", noun: "warehouses" },
    { table: "importer", column: "city_id", noun: "importers" },
    { table: "importer_client", column: "city_id", noun: "importer clients" },
    { table: "transporter", column: "city_id", noun: "transporters" },
  ],
  conflict: "That state already has a city with this name",
  orderBy: "name",
  createSchema: withActive({
    stateId: z.number().int().positive(),
    name: name(80),
  }),
  updateSchema: withActive({
    stateId: z.number().int().positive().optional(),
    name: name(80).optional(),
  }),
};

/**
 * The whitelist.
 *
 * `resolveResource` is the only way in, and it takes a string from the
 * URL. Anything not a key here never reaches a query.
 */
export const MASTER_RESOURCES = Object.freeze({
  countries: country,
  states: state,
  cities: city,
  "warehouse-types": warehouseType,
  "vehicle-types": vehicleType,
} as const);

export type MasterSlug = keyof typeof MASTER_RESOURCES;

export function resolveResource(slug: string): MasterResource | null {
  return Object.prototype.hasOwnProperty.call(MASTER_RESOURCES, slug)
    ? MASTER_RESOURCES[slug as MasterSlug]
    : null;
}

/**
 * What delete means here.
 *
 * Every foreign key into these tables is `NO ACTION`, so a row something
 * points at cannot be removed — the database refuses, and so does the
 * handler, before the database has to (409, naming what points at it).
 * A row nothing points at is deleted outright. Not soft-deleted: the
 * unique keys — `country.iso2`, `state (country_id, code)`,
 * `city (state_id, name)`, `*_type.code` — are plain, not partial on
 * `deleted_at`, so a soft-deleted row would keep its code for good and
 * re-adding it would fail against a row nobody can see. The audit row
 * carries the deleted values, which is where the history lives.
 *
 * Deactivation remains for the common case: a row that IS in use but
 * should not be offered any more. It leaves every picker; every existing
 * reference still resolves; and it can be switched back on.
 */
export const HARD_DELETE_WHEN_UNUSED = true;
