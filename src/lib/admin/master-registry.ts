import { formatPaise, inputToPaise, MAX_PAISE } from "@/lib/money";
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

/**
 * `textarea` is `text` in a taller box — same column, same validation,
 * for a field that holds sentences rather than a name.
 *
 * `date` is a calendar day with no time: the day a bill was paid, not
 * the instant a row was written. It reaches the browser as `YYYY-MM-DD`
 * so an `<input type="date">` can hold it without a timezone turning
 * the 1st into the 31st.
 *
 * `money` is an INTEGER number of paise in the database and rupees on
 * the screen. Both conversions live in `lib/money.ts`.
 */
export type MasterFieldType =
  | "text"
  | "number"
  | "select"
  | "textarea"
  | "date"
  | "money"
  /** A tick. `blacklisted` on a transporter — not the same question as
   *  the Active switch, which asks whether the row is in use at all. */
  | "boolean";

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
  /**
   * Edit it in the drawer, but keep it out of the list.
   *
   * Every field is a table column by default, which is right for a code
   * and a name and wrong for an FAQ answer: a few hundred words in a
   * cell wrecks the row height for every other row on the page. Such a
   * field is also not offered as a sort key — sorting a list by the
   * text of a paragraph is not a thing anyone wants.
   */
  hideInTable?: boolean;
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
    /**
     * The row can exist without one.
     *
     * Every parent was required until a transporter's city, which is
     * genuinely optional — plenty of carriers are added from a phone
     * call before anybody knows where their office is. The create route
     * used to look the parent up unconditionally, which turned a
     * missing city into `where id =` and a 500.
     */
    optional?: boolean;
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
  /**
   * A cache tag on the public site that this table feeds.
   *
   * Declared here rather than hard-coded in the route, so the route
   * stays the generic thing it is: it drops whatever tag the resource
   * names, and a resource that feeds nothing public names none. Without
   * it, an edited FAQ would sit behind the five-minute cache and the
   * person who saved it would reasonably conclude it had not worked.
   */
  publicTag?: string;
  /**
   * What to call the rows in running text — "3 warehouse types", "Search
   * warehouse types".
   *
   * Defaults to `label.toLowerCase()`, which is right for every ordinary
   * noun and wrong for an acronym: it turns "FAQs" into "faqs" and the
   * toolbar reads "1 faqs". Set it only where lowercasing the label
   * would be a mistake.
   */
  listNoun?: string;
  /**
   * A SECOND foreign key, which also decides who may see the row.
   *
   * `parent` is what the row is filed under — an expense's category. A
   * `scope` is where the row belongs, and it is the difference between
   * a list everybody shares and one narrowed per person: an expense's
   * warehouse. A caller holding the read permission at ALL sees every
   * row; anyone narrower sees only rows whose scope column is one of
   * their own assignments, and may only write rows there.
   *
   * Only resources that declare it pay for it. Generalising `parent`
   * into an array instead would have rewritten the query, the drawer
   * and the picker for all seven existing screens to serve one new one.
   */
  scope?: {
    key: string;
    /** The column on THIS table, when the link is direct. An expense
     *  carries its own `warehouse_id`. */
    column?: string;
    label: string;
    table: string;
    labelColumn: string;
    /** Shown in the picker beside the label — "WH-0001 · Bhiwandi". */
    codeColumn?: string;
    /**
     * When the link is NOT a column on this table.
     *
     * A transporter has no warehouse: it serves several, through
     * `warehouse_transporter`. A vehicle is one hop further still —
     * its site comes from its owner. So "mine" is an EXISTS against a
     * join table rather than a column comparison:
     *
     *   exists (select 1 from <table> j
     *            where j.<linkColumn> = m.<localColumn>
     *              and j.<scopeColumn> in (…the caller's own sites))
     *
     * `localColumn` is `id` for the owning table and the foreign key for
     * anything hanging off it.
     */
    via?: {
      table: string;
      linkColumn: string;
      localColumn: string;
      scopeColumn: string;
    };
    /** The scope is chosen through `pivot` rather than a single picker,
     *  so the drawer must not render a second one. */
    pickedByPivot?: boolean;
  };
  /**
   * Extra foreign keys that are neither the parent nor the scope.
   *
   * A vehicle needs three relations — its transporter (the parent, and
   * what scopes it), its type, and the site it reaches through the
   * transporter. `parent` and `scope` are only two.
   */
  links?: {
    key: string;
    column: string;
    label: string;
    table: string;
    labelColumn: string;
    required?: boolean;
    /** Offer it as a dropdown filter above the table. */
    filterable?: boolean;
  }[];
  /**
   * A many-to-many the drawer edits inline.
   *
   * Which warehouses a transporter serves. The ids arrive in the same
   * request body as the row (`key`), so a create writes the row and its
   * links in one go — a separate endpoint would leave a window where a
   * scoped user had made a carrier they could not yet see.
   */
  pivot?: {
    key: string;
    table: string;
    /** Column pointing back at this row. */
    localColumn: string;
    /** Column pointing at the option. */
    optionColumn: string;
    optionTable: string;
    optionLabelColumn: string;
    optionCodeColumn?: string;
    label: string;
    hint: string;
    /** The options are narrowed to the caller's own sites, like the
     *  list is. A scoped caller must pick at least one. */
    scopedByActor?: boolean;
  };
  /**
   * The Active switch, when the table has no `is_active` boolean.
   *
   * `transporter` and `vehicle` both carry the `record_status` enum
   * instead. Adding a boolean beside it would be two columns that can
   * disagree about whether a lorry is on the road; this maps the switch
   * onto the column that is already the truth, and which
   * `vehicle_active_idx` is already built on.
   */
  statusColumn?: {
    column: string;
    activeValue: string;
    inactiveValue: string;
  };
  /**
   * Never remove the row, whatever the delete button says.
   *
   * The master default is a hard delete once nothing points at a row,
   * because a country nobody references is a typo. A financial record
   * is not: it is soft-deleted, leaves every list and total, and is
   * still there at year end.
   */
  softDeleteOnly?: boolean;
  /**
   * Rows need a decision before they count.
   *
   * `autoApprovePermission` is the rule in one line: an author who
   * already holds it does not have to ask themselves. A super admin
   * records an approved expense; everybody else records a pending one.
   */
  approval?: {
    column: string;
    permission: string;
    autoApprovePermission: string;
  };
  /**
   * Files hanging off the row — receipts on an expense.
   *
   * Plain data, because the spec crosses from a server component to a
   * client one: an endpoint template and what the picker will accept,
   * never a function.
   */
  attachments?: {
    /** `{id}` is replaced with the row id. */
    endpoint: string;
    label: string;
    hint: string;
    accept: string;
  };
};

/**
 * English plural, for the two rules that actually come up here.
 *
 * `country` → `countries`, `category` → `categories`, everything else
 * takes an `s`. This replaces a hard-coded special case for "country"
 * that was doing the first rule for exactly one word — which is how
 * "All categorys" ended up on the FAQ screen the moment a second
 * `-y` parent existed.
 */
export function pluralise(word: string): string {
  return /[^aeiou]y$/i.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`;
}

/** Fixed-width `char` columns pad on write. Trim and upper, or you store
 *  `"IN "` and every comparison against `"IN"` quietly fails. */
const code = (len: number, label: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .length(len, `${label} must be exactly ${len} characters`)
    .regex(/^[A-Z0-9]+$/, `${label} may only use letters and digits`);

/** Free-length codes: letters, digits, _ and -, starting alphanumeric.
 *  "TEST @#$" is a typo, not a code. */
const codeText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .min(min)
    .max(max)
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/, "Codes may only use letters, digits, _ and -");

/** Human names of things: must start with a letter or digit, and only
 *  everyday punctuation after that. "#$@@ 56 kkj" is not a name. */
const NAME_CHARS = /^[A-Za-z0-9][A-Za-z0-9 ,.&()/'-]*$/;
const name = (max: number) =>
  z
    .string()
    .trim()
    .min(2)
    .max(max)
    .regex(NAME_CHARS, "Only letters, digits, spaces and , . & ( ) / ' - are allowed")
    .refine((v) => /[A-Za-z]/.test(v), "A name needs at least one letter");

/** An empty input means "not given", not "invalid". */
const optionalText = (max: number) =>
  z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z
      .string()
      .trim()
      .max(max)
      .regex(NAME_CHARS, "Only letters, digits, spaces and , . & ( ) / ' - are allowed")
      .optional(),
  );

/**
 * An untouched input posts `""`, which means "not given", not "invalid".
 *
 * `optionalText` and `optionalNumber` above each bake in their own
 * validator; this is the same preprocessing for any other schema, so a
 * blank Reference box does not come back as "Codes may only use letters
 * and digits" on a field the user deliberately left empty.
 */
const blankOptional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), schema.optional());

const optionalNumber = (max: number) =>
  z.preprocess(
    (v) => (v === "" || v === null ? undefined : typeof v === "string" ? Number(v) : v),
    z.number().min(0).max(max).optional(),
  );

/**
 * Sentences, as opposed to the name of a thing.
 *
 * `name()` above allows `, . & ( ) / ' -` and nothing else, which is
 * right for "Cold Storage" and fatal for an FAQ: it has no `?`, so
 * every question ending the way a question ends would have been
 * refused. This allows ordinary prose punctuation and refuses the
 * characters that only turn up when somebody is trying to smuggle
 * markup into a field that is rendered on a public page.
 *
 * The public page escapes everything and renders no HTML regardless —
 * this is the first of the two, not the only one.
 */
const prose = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => !/[<>]/.test(v), "Angle brackets are not allowed")
    .refine((v) => /[A-Za-z]/.test(v), "Needs at least one letter");

/** Mirrors `vehicle_fuel_type_check` exactly. */
export const FUEL_TYPES = ["DIESEL", "PETROL", "CNG", "LNG", "ELECTRIC", "HYBRID"] as const;

/**
 * A ten-digit Indian mobile, matching the `mobile_in` domain.
 *
 * The column is `char(10)`, which PADS on write — so a value that
 * reached it with a stray space would be stored as `"98765432 1"` and
 * every later comparison against the real number would quietly fail.
 */
const mobile = () =>
  z
    .string()
    .trim()
    .regex(/^[6-9][0-9]{9}$/, "Enter a 10-digit Indian mobile number");

/** Same shape the importer screens validate, so a GSTIN is refused here
 *  with a field message rather than by the database with a 500. */
const gstinValue = () =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
      "That does not look like a valid GSTIN",
    );

const panValue = () =>
  z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "That does not look like a valid PAN");

/** Mirrors the `pincode_in` domain: six digits, not starting with zero. */
const pincodeValue = () =>
  z.string().trim().regex(/^[1-9][0-9]{5}$/, "Pincode must be 6 digits and cannot start with 0");

/**
 * An Indian number plate, normalised.
 *
 * Spaces and dashes are stripped rather than refused — people read a
 * plate as "MH 04 AB 1234" and type it that way, and the column is
 * `varchar(13)` with a unique index, so "MH04AB1234" and "MH 04 AB 1234"
 * would otherwise be two different lorries.
 */
const registration = () =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.replace(/[\s-]/g, "").toUpperCase() : v),
    z
      .string()
      .min(6, "That is too short for a registration number")
      .max(13)
      .regex(/^[A-Z0-9]+$/, "Letters and digits only"),
  );

/** Mirrors the CHECK on `expense.payment_mode` exactly. */
export const PAYMENT_MODES = [
  "CASH",
  "UPI",
  "CARD",
  "BANK_TRANSFER",
  "CHEQUE",
] as const;

export const VEHICLE_CATEGORIES = [
  "THREE_WHEELER",
  "LCV",
  "MCV",
  "HCV",
  "TRAILER",
  "CONTAINER",
] as const;

/** Every update may also flip the row's availability. */
/**
 * Rupees in, paise out.
 *
 * The conversion is `inputToPaise`, shared with the drawer, so the two
 * sides cannot round differently. What arrives is whatever somebody
 * typed — "42300", "42,300.50", "₹42300" — and what is stored is an
 * integer. More than two decimals is refused rather than rounded: a
 * third decimal is a typo or a foreign currency, and quietly filing
 * ₹1,234.57 for ₹1,234.567 is the wrong kind of helpful.
 */
const money = (maxPaise: number) =>
  z.preprocess(
    (v) => {
      if (v === "" || v === null || v === undefined) return undefined;
      const paise = inputToPaise(v as string | number);
      // `null` rather than undefined, so a bad value fails the number
      // check with a message instead of vanishing as "not provided".
      return paise === null ? Number.NaN : paise;
    },
    z
      .number({ invalid_type_error: "Enter an amount like 4200 or 4200.50" })
      .int("Enter an amount like 4200 or 4200.50")
      .positive("An amount has to be more than zero")
      .max(maxPaise, `That is more than ${formatPaise(maxPaise)}`),
  );

/**
 * A calendar day, as `YYYY-MM-DD`.
 *
 * Not `z.coerce.date()`: that parses "2026-08-21" as UTC midnight, and
 * `toISOString()` on the way back out in Asia/Kolkata is still the 21st
 * — but the same round trip in a westward timezone is the 20th. A date
 * with no time attached should never touch a Date object at all.
 */
const isoDate = (opts: { notFuture?: boolean } = {}) => {
  const base = z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "That is not a real date");
  if (!opts.notFuture) return base;
  /**
   * Refused here as well as by `expense_spent_on_sane`, because the
   * CHECK's message is "violates check constraint" and the person who
   * mistyped 2062 for 2026 deserves better than a 500. Compared as
   * strings: `YYYY-MM-DD` sorts the same way it reads, and going via a
   * Date to compare two calendar days is how the 1st becomes the 31st.
   */
  return base.refine(
    (v) => v <= new Date().toISOString().slice(0, 10),
    "That is in the future",
  );
};

const withActive = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ ...shape, isActive: z.boolean().optional() });

/**
 * Blacklisting needs a reason, and the reason is the point.
 *
 * `transporter_check` says the same thing, and reaching it on its own
 * came back as "That value is not allowed here (transporter check)" —
 * true, unhelpful, and attached to no field. Here it lands under the box
 * the person has to fill in.
 */
const needsBlacklistReason = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((v: unknown, ctx: z.RefinementCtx) => {
    const value = v as { blacklisted?: boolean; blacklistReason?: string };
    if (value.blacklisted === true && !(value.blacklistReason ?? "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blacklistReason"],
        message: "Say why this carrier is being blacklisted",
      });
    }
  });

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
    code: codeText(1, 8),
    name: name(80),
  }),
  updateSchema: withActive({
    code: codeText(1, 8).optional(),
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
    code: codeText(2, 24),
    name: name(80),
    description: optionalText(300),
  }),
  updateSchema: withActive({
    code: codeText(2, 24).optional(),
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
    code: codeText(2, 24),
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
    code: codeText(2, 24).optional(),
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

// ── faq_category ──────────────────────────────────────────────────
const faqCategory: MasterResource = {
  slug: "faq-categories",
  table: "faq_category",
  label: "FAQ categories",
  singular: "FAQ category",
  listNoun: "FAQ categories",
  permission: "master.faq_category",
  intro:
    "The headings the public FAQ page is grouped under. A category with questions in it cannot be deleted — move them first.",
  hasAudit: true,
  fields: [
    { key: "code", column: "code", label: "Code", type: "text", required: true, mono: true, width: 9 },
    { key: "name", column: "name", label: "Name", type: "text", required: true },
    { key: "description", column: "description", label: "Description", type: "text" },
    {
      key: "sortOrder",
      column: "sort_order",
      label: "Order",
      type: "number",
      align: "right",
      width: 5,
      hint: "Lowest first on the public page.",
    },
  ],
  dependents: [{ table: "faq", column: "faq_category_id", noun: "FAQs" }],
  conflict: "A FAQ category with that code already exists",
  publicTag: "public-faqs",
  orderBy: "sort_order, name",
  createSchema: withActive({
    code: codeText(2, 24),
    name: name(80),
    description: optionalText(300),
    sortOrder: optionalNumber(9999),
  }),
  updateSchema: withActive({
    code: codeText(2, 24).optional(),
    name: name(80).optional(),
    description: optionalText(300),
    sortOrder: optionalNumber(9999),
  }),
};

// ── faq ───────────────────────────────────────────────────────────
/**
 * Not `master.faq` — plain `faq`.
 *
 * The seed grants `master.%.read` to every role, because anybody
 * filling in an address needs the city list. An FAQ is not that, and
 * naming the resource `master.*` would have quietly handed every role
 * in the system read access the day the permission rows were created.
 */
const faq: MasterResource = {
  slug: "faqs",
  table: "faq",
  label: "FAQs",
  singular: "FAQ",
  listNoun: "FAQs",
  permission: "faq",
  intro:
    "What appears on the public FAQ page, grouped by category. Answers are shown as plain text — blank lines become paragraphs, and nothing is rendered as markup.",
  hasAudit: true,
  fields: [
    { key: "question", column: "question", label: "Question", type: "text", required: true },
    {
      key: "answer",
      column: "answer",
      label: "Answer",
      type: "textarea",
      required: true,
      // In the drawer, never as a column: a few hundred words in a
      // table cell ruins the row height for every other row.
      hideInTable: true,
      hint: "Plain text. Leave a blank line between paragraphs.",
    },
    {
      key: "sortOrder",
      column: "sort_order",
      label: "Order",
      type: "number",
      align: "right",
      width: 5,
      hint: "Lowest first within the category.",
    },
  ],
  parent: {
    key: "faqCategoryId",
    column: "faq_category_id",
    label: "Category",
    table: "faq_category",
    labelColumn: "name",
  },
  dependents: [],
  conflict: "That category already has this question",
  publicTag: "public-faqs",
  orderBy: "sort_order, id",
  createSchema: withActive({
    faqCategoryId: z.number().int().positive(),
    question: prose(5, 300),
    answer: prose(5, 4000),
    sortOrder: optionalNumber(9999),
  }),
  updateSchema: withActive({
    faqCategoryId: z.number().int().positive().optional(),
    question: prose(5, 300).optional(),
    answer: prose(5, 4000).optional(),
    sortOrder: optionalNumber(9999),
  }),
};

// ── transporter ───────────────────────────────────────────────────
/**
 * The carrier register. Not users — nobody signs in as a transporter;
 * these are reference records about the companies that move goods.
 *
 * Three things make it the most demanding entry here, and all three are
 * properties the table already had before this screen existed:
 *
 *   1. No `is_active` — `status` is the `record_status` enum, so the
 *      Active switch maps onto it (`statusColumn`).
 *   2. No `warehouse_id` — a carrier serves several sites through
 *      `warehouse_transporter`, so "mine" is an EXISTS (`scope.via`)
 *      and the sites are chosen as a set (`pivot`).
 *   3. `blacklisted` is its own fact, with a CHECK insisting on a
 *      reason. A blacklisted carrier is not merely inactive; it is one
 *      somebody decided not to use again, and the reason is the point.
 */
const transporter: MasterResource = {
  slug: "transporters",
  table: "transporter",
  label: "Transporters",
  singular: "transporter",
  listNoun: "transporters",
  permission: "transporter",
  intro:
    "The companies that move goods for you. Reference records only — a transporter is not a login. Each one is linked to the warehouses it serves, and that link is what decides who can see it.",
  hasAudit: true,
  fields: [
    { key: "code", column: "code", label: "Code", type: "text", required: true, mono: true, width: 9 },
    { key: "name", column: "name", label: "Name", type: "text", required: true },
    { key: "legalName", column: "legal_name", label: "Legal name", type: "text", hideInTable: true },
    { key: "contactPerson", column: "contact_person", label: "Contact", type: "text", required: true },
    { key: "contactMobile", column: "contact_mobile", label: "Mobile", type: "text", required: true, mono: true, width: 9 },
    { key: "alternateMobile", column: "alternate_mobile", label: "Alternate mobile", type: "text", mono: true, hideInTable: true },
    { key: "contactEmail", column: "contact_email", label: "Email", type: "text", hideInTable: true },
    { key: "officePhone", column: "office_phone", label: "Office phone", type: "text", hideInTable: true },
    { key: "gstin", column: "gstin", label: "GSTIN", type: "text", mono: true, width: 13 },
    { key: "pan", column: "pan", label: "PAN", type: "text", mono: true, hideInTable: true },
    { key: "website", column: "website", label: "Website", type: "text", hideInTable: true },
    { key: "address", column: "address", label: "Address", type: "textarea", hideInTable: true },
    { key: "pincode", column: "pincode", label: "Pincode", type: "text", mono: true, hideInTable: true },
    {
      key: "blacklisted",
      column: "blacklisted",
      label: "Blacklisted",
      type: "boolean",
      width: 7,
      hint: "Stop using this carrier. A reason is required.",
    },
    {
      key: "blacklistReason",
      column: "blacklist_reason",
      label: "Why blacklisted",
      type: "textarea",
      hideInTable: true,
      hint: "Required whenever the tick above is on — the table refuses the row otherwise.",
    },
    { key: "notes", column: "notes", label: "Notes", type: "textarea", hideInTable: true },
  ],
  parent: {
    key: "cityId",
    column: "city_id",
    label: "City",
    optional: true,
    table: "city",
    labelColumn: "name",
    groupBy: { column: "state_id", table: "state", labelColumn: "name", label: "State" },
  },
  scope: {
    key: "warehouseIds",
    label: "Warehouse",
    table: "warehouse",
    labelColumn: "name",
    codeColumn: "code",
    via: {
      table: "warehouse_transporter",
      linkColumn: "transporter_id",
      localColumn: "id",
      scopeColumn: "warehouse_id",
    },
    pickedByPivot: true,
  },
  pivot: {
    key: "warehouseIds",
    table: "warehouse_transporter",
    localColumn: "transporter_id",
    optionColumn: "warehouse_id",
    optionTable: "warehouse",
    optionLabelColumn: "name",
    optionCodeColumn: "code",
    label: "Serves",
    hint: "Which sites this carrier works for. It is also who can see the record.",
    scopedByActor: true,
  },
  statusColumn: { column: "status", activeValue: "ACTIVE", inactiveValue: "SUSPENDED" },
  softDeleteOnly: true,
  dependents: [{ table: "vehicle", column: "transporter_id", noun: "vehicles" }],
  conflict: "A transporter with that code or GSTIN already exists",
  orderBy: "name",
  createSchema: needsBlacklistReason(withActive({
    cityId: blankOptional(z.number().int().positive()),
    code: codeText(2, 24),
    name: name(120),
    legalName: optionalText(160),
    contactPerson: name(120),
    contactMobile: mobile(),
    alternateMobile: blankOptional(mobile()),
    contactEmail: blankOptional(z.string().trim().toLowerCase().email("Enter a valid email address").max(160)),
    officePhone: blankOptional(z.string().trim().regex(/^[0-9+\-\s()]{6,15}$/, "That does not look like a phone number")),
    gstin: blankOptional(gstinValue()),
    pan: blankOptional(panValue()),
    website: blankOptional(z.string().trim().url("Enter a full address, starting http:// or https://").max(200)),
    address: blankOptional(prose(4, 400)),
    pincode: blankOptional(pincodeValue()),
    blacklisted: z.boolean().optional(),
    blacklistReason: blankOptional(prose(5, 300)),
    notes: blankOptional(prose(2, 1000)),
    warehouseIds: z.array(z.number().int().positive()).max(200).optional(),
  })),
  updateSchema: needsBlacklistReason(withActive({
    cityId: blankOptional(z.number().int().positive()),
    code: codeText(2, 24).optional(),
    name: name(120).optional(),
    legalName: optionalText(160),
    contactPerson: name(120).optional(),
    contactMobile: mobile().optional(),
    alternateMobile: blankOptional(mobile()),
    contactEmail: blankOptional(z.string().trim().toLowerCase().email("Enter a valid email address").max(160)),
    officePhone: blankOptional(z.string().trim().regex(/^[0-9+\-\s()]{6,15}$/, "That does not look like a phone number")),
    gstin: blankOptional(gstinValue()),
    pan: blankOptional(panValue()),
    website: blankOptional(z.string().trim().url("Enter a full address, starting http:// or https://").max(200)),
    address: blankOptional(prose(4, 400)),
    pincode: blankOptional(pincodeValue()),
    blacklisted: z.boolean().optional(),
    blacklistReason: blankOptional(prose(5, 300)),
    notes: blankOptional(prose(2, 1000)),
    warehouseIds: z.array(z.number().int().positive()).max(200).optional(),
  })),
};

// ── vehicle ───────────────────────────────────────────────────────
/**
 * One row per lorry. Its site comes from its owner, which is why the
 * scope is two hops rather than one and why there is no warehouse
 * picker on the form: choosing the transporter chooses the sites.
 *
 * The capacity columns are the vehicle's OWN, not the type's — two
 * lorries of the same type are not always loaded the same, and a
 * dispatch is planned against the actual vehicle.
 */
const vehicle: MasterResource = {
  slug: "vehicles",
  table: "vehicle",
  label: "Vehicles",
  singular: "vehicle",
  listNoun: "vehicles",
  permission: "vehicle",
  intro:
    "Every lorry on the register, and who owns it. A vehicle is visible to whoever can see its transporter.",
  hasAudit: true,
  fields: [
    {
      key: "registrationNumber",
      column: "registration_number",
      label: "Registration",
      type: "text",
      required: true,
      mono: true,
      width: 12,
      hint: "MH04AB1234 — no spaces.",
    },
    { key: "model", column: "model", label: "Model", type: "text" },
    {
      key: "fuelType",
      column: "fuel_type",
      label: "Fuel",
      type: "select",
      options: FUEL_TYPES,
      filterable: true,
      width: 8,
    },
    { key: "capacityKg", column: "capacity_kg", label: "Kg", type: "number", align: "right", width: 6 },
    { key: "capacityCbm", column: "capacity_cbm", label: "Cbm", type: "number", align: "right", width: 5 },
    { key: "axleCount", column: "axle_count", label: "Axles", type: "number", align: "right", width: 4 },
    { key: "lengthFt", column: "length_ft", label: "L ft", type: "number", align: "right", hideInTable: true },
    { key: "widthFt", column: "width_ft", label: "W ft", type: "number", align: "right", hideInTable: true },
    { key: "heightFt", column: "height_ft", label: "H ft", type: "number", align: "right", hideInTable: true },
    { key: "chassisNumber", column: "chassis_number", label: "Chassis", type: "text", mono: true, hideInTable: true },
    { key: "engineNumber", column: "engine_number", label: "Engine", type: "text", mono: true, hideInTable: true },
    { key: "notes", column: "notes", label: "Notes", type: "textarea", hideInTable: true },
  ],
  parent: {
    key: "transporterId",
    column: "transporter_id",
    label: "Transporter",
    table: "transporter",
    labelColumn: "name",
  },
  links: [
    {
      key: "vehicleTypeId",
      column: "vehicle_type_id",
      label: "Type",
      table: "vehicle_type",
      labelColumn: "name",
      required: true,
      filterable: true,
    },
  ],
  scope: {
    key: "warehouseIds",
    label: "Warehouse",
    table: "warehouse",
    labelColumn: "name",
    codeColumn: "code",
    // Two hops: vehicle → its transporter → the sites that transporter
    // serves. `localColumn` is the foreign key rather than `id`.
    via: {
      table: "warehouse_transporter",
      linkColumn: "transporter_id",
      localColumn: "transporter_id",
      scopeColumn: "warehouse_id",
    },
    pickedByPivot: true,
  },
  statusColumn: { column: "status", activeValue: "ACTIVE", inactiveValue: "SUSPENDED" },
  softDeleteOnly: true,
  dependents: [],
  conflict: "A vehicle with that registration number already exists",
  orderBy: "registration_number",
  createSchema: withActive({
    transporterId: z.number().int().positive(),
    vehicleTypeId: z.number().int().positive(),
    registrationNumber: registration(),
    model: optionalText(80),
    fuelType: blankOptional(z.enum(FUEL_TYPES)),
    capacityKg: optionalNumber(100_000),
    capacityCbm: optionalNumber(500),
    axleCount: optionalNumber(12),
    lengthFt: optionalNumber(80),
    widthFt: optionalNumber(20),
    heightFt: optionalNumber(20),
    chassisNumber: blankOptional(codeText(5, 25)),
    engineNumber: blankOptional(codeText(5, 25)),
    notes: blankOptional(prose(2, 1000)),
  }),
  updateSchema: withActive({
    transporterId: z.number().int().positive().optional(),
    vehicleTypeId: z.number().int().positive().optional(),
    registrationNumber: registration().optional(),
    model: optionalText(80),
    fuelType: blankOptional(z.enum(FUEL_TYPES)),
    capacityKg: optionalNumber(100_000),
    capacityCbm: optionalNumber(500),
    axleCount: optionalNumber(12),
    lengthFt: optionalNumber(80),
    widthFt: optionalNumber(20),
    heightFt: optionalNumber(20),
    chassisNumber: blankOptional(codeText(5, 25)),
    engineNumber: blankOptional(codeText(5, 25)),
    notes: blankOptional(prose(2, 1000)),
  }),
};

// ── expense category ──────────────────────────────────────────────
/**
 * A twin of `faqCategory`, and named `master.expense_category` for the
 * same reason the FAQ one is: it belongs under the Master menu, and
 * only a super admin may change it. Its `.read` IS granted to the three
 * roles that record expenses, because they need it as a picker.
 */
const expenseCategory: MasterResource = {
  slug: "expense-categories",
  table: "expense_category",
  label: "Expense categories",
  singular: "expense category",
  listNoun: "expense categories",
  permission: "master.expense_category",
  intro:
    "What money is spent on — rent, power, fuel, wages. Deactivating one keeps every expense already filed under it and takes it out of the picker.",
  hasAudit: true,
  fields: [
    { key: "code", column: "code", label: "Code", type: "text", required: true, mono: true, width: 8 },
    { key: "name", column: "name", label: "Name", type: "text", required: true },
    { key: "description", column: "description", label: "Description", type: "text" },
    {
      key: "sortOrder",
      column: "sort_order",
      label: "Order",
      type: "number",
      align: "right",
      width: 5,
      hint: "Lowest first in the picker.",
    },
  ],
  dependents: [{ table: "expense", column: "expense_category_id", noun: "expenses" }],
  conflict: "An expense category with that code already exists",
  orderBy: "sort_order, name",
  createSchema: withActive({
    code: codeText(2, 24),
    name: name(80),
    description: optionalText(300),
    sortOrder: optionalNumber(9999),
  }),
  updateSchema: withActive({
    code: codeText(2, 24).optional(),
    name: name(80).optional(),
    description: optionalText(300),
    sortOrder: optionalNumber(9999),
  }),
};

// ── expense ───────────────────────────────────────────────────────
/**
 * Money spent at a site. The first resource here that is a transaction
 * rather than a list of things, which is why it is the first to use
 * `scope`, `softDeleteOnly`, `approval` and `attachments` — every one
 * of them opt-in, and every other resource takes the old path.
 *
 * Plain `expense`, not `master.expense`: the seed grants `master.%.read`
 * to every role so that anyone filling in an address can read the city
 * list, and naming this `master.*` would hand the whole floor read
 * access to the company's spending.
 */
const expense: MasterResource = {
  slug: "expenses",
  table: "expense",
  label: "Expenses",
  singular: "expense",
  listNoun: "expenses",
  permission: "expense",
  intro:
    "What each site spends. A super admin's entry is approved as it is recorded; everybody else's waits for a decision. Nothing here is ever deleted outright — cancelling keeps the row for the year end.",
  hasAudit: true,
  fields: [
    {
      key: "spentOn",
      column: "spent_on",
      label: "Date",
      type: "date",
      required: true,
      width: 8,
      hint: "The day the money went out.",
    },
    { key: "paidTo", column: "paid_to", label: "Paid to", type: "text", required: true },
    {
      key: "paymentMode",
      column: "payment_mode",
      label: "Mode",
      type: "select",
      required: true,
      filterable: true,
      width: 8,
      options: PAYMENT_MODES,
    },
    {
      key: "amount",
      column: "amount_paise",
      label: "Amount",
      type: "money",
      required: true,
      align: "right",
      width: 9,
      hint: "In rupees — 4200 or 4200.50.",
    },
    {
      key: "referenceNo",
      column: "reference_no",
      label: "Reference",
      type: "text",
      mono: true,
      width: 10,
      hint: "Bill number, UTR or cheque number.",
    },
    {
      key: "notes",
      column: "notes",
      label: "Notes",
      type: "textarea",
      hideInTable: true,
      hint: "Anything the bill does not say for itself.",
    },
  ],
  parent: {
    key: "expenseCategoryId",
    column: "expense_category_id",
    label: "Category",
    table: "expense_category",
    labelColumn: "name",
  },
  scope: {
    key: "warehouseId",
    column: "warehouse_id",
    label: "Warehouse",
    table: "warehouse",
    labelColumn: "name",
    codeColumn: "code",
  },
  softDeleteOnly: true,
  approval: {
    column: "approval_status",
    permission: "expense.approve",
    autoApprovePermission: "expense.approve",
  },
  attachments: {
    endpoint: "/admin/expenses/{id}/receipts",
    label: "Receipts",
    hint: "The bill itself — a photo or a PDF, up to 5 MB.",
    accept: "image/*,application/pdf",
  },
  dependents: [],
  conflict: "That expense has already been recorded",
  orderBy: "spent_on desc, id desc",
  createSchema: withActive({
    expenseCategoryId: z.number().int().positive(),
    warehouseId: z.number().int().positive(),
    spentOn: isoDate({ notFuture: true }),
    paidTo: name(120),
    paymentMode: z.enum(PAYMENT_MODES),
    amount: money(MAX_PAISE),
    referenceNo: blankOptional(codeText(1, 40)),
    notes: blankOptional(prose(2, 1000)),
  }),
  updateSchema: withActive({
    expenseCategoryId: z.number().int().positive().optional(),
    warehouseId: z.number().int().positive().optional(),
    spentOn: isoDate({ notFuture: true }).optional(),
    paidTo: name(120).optional(),
    paymentMode: z.enum(PAYMENT_MODES).optional(),
    amount: money(MAX_PAISE).optional(),
    referenceNo: blankOptional(codeText(1, 40)),
    notes: blankOptional(prose(2, 1000)),
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
  "faq-categories": faqCategory,
  faqs: faq,
  "expense-categories": expenseCategory,
  expenses: expense,
  transporters: transporter,
  vehicles: vehicle,
} as const);

export type MasterSlug = keyof typeof MASTER_RESOURCES;

/**
 * How a given TABLE says it is active.
 *
 * The parent and link pickers filter on "active", and until now every
 * table they pointed at had a boolean `is_active`. `transporter` does
 * not — it carries the `record_status` enum — so a vehicle's transporter
 * picker asked for a column that is not there and came back as a 500.
 *
 * Answered from the registry rather than from a second list: a table
 * that is itself a resource already says which column holds the answer.
 */
export function activeColumnFor(table: string): { column: string; activeValue: string } | null {
  for (const resource of Object.values(MASTER_RESOURCES)) {
    if (resource.table === table && resource.statusColumn) {
      return {
        column: resource.statusColumn.column,
        activeValue: resource.statusColumn.activeValue,
      };
    }
  }
  return null;
}

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
