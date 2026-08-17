import { customType } from "drizzle-orm/pg-core";

/**
 * Postgres types drizzle-kit cannot introspect.
 *
 * Three groups, and none of them are worth giving up:
 *
 *   citext          case-insensitive email. Dropping it means every lookup
 *                   needs lower(email) and a functional index, and the one
 *                   place someone forgets becomes a duplicate account.
 *   ltree           the user hierarchy path. Replacing it with text loses
 *                   the @> and <@ operators that make "notify everyone
 *                   above this user" a single index scan.
 *   domains         gstin / pan_no / mobile_in / pincode_in / vehicle_reg.
 *                   The regex lives in the database, so a malformed GSTIN
 *                   cannot arrive from ANY code path — including psql and
 *                   a data import.
 *
 * `customType` tells Drizzle the SQL name and how to carry the value in
 * TypeScript. Nothing is validated here: the database does that, and
 * duplicating the regex in TypeScript would create two sources of truth
 * that drift.
 */

const stringType = (sqlName: string) =>
  customType<{ data: string; driverData: string }>({
    dataType: () => sqlName,
  });

/** Case-insensitive text. Compared and unique-indexed without lower(). */
export const citext = stringType("citext");

/** Hierarchy path, e.g. u1.u4.u9. Supports @> (ancestor) and <@. */
export const ltree = stringType("ltree");

/** Exactly 10 digits, first digit 6-9. */
export const mobileIn = stringType("wms.mobile_in");

/** 15-character GSTIN, checked against the statutory pattern. */
export const gstin = stringType("wms.gstin");

/** 10-character PAN. */
export const panNo = stringType("wms.pan_no");

/** 6-digit Indian pincode, first digit 1-9. */
export const pincodeIn = stringType("wms.pincode_in");

/** Vehicle registration without separators, e.g. MH12AB1234. */
export const vehicleReg = stringType("wms.vehicle_reg");

/**
 * Enum arrays. Drizzle models an enum column but not an enum ARRAY, which
 * `audit_log.actor_roles` and `notification_rule.channels` both are.
 * Typed as a string array here; the database enforces the membership.
 */
const enumArray = <T extends string>(sqlName: string) =>
  customType<{ data: T[]; driverData: string }>({
    dataType: () => sqlName,
  });

export const roleKeyArray = enumArray<
  | "SUPER_ADMIN"
  | "WAREHOUSE_ADMIN"
  | "TRANSPORTER_MANAGER"
  | "INWARD_MANAGER"
  | "STORAGE_MANAGER"
  | "PACKAGE_MANAGER"
  | "DISPATCH_MANAGER"
  | "IMPORTER"
  | "SALES_AGENT"
>("wms.role_key[]");

export const notifChannelArray = enumArray<
  "IN_APP" | "EMAIL" | "SMS" | "PUSH" | "WHATSAPP"
>("wms.notif_channel[]");
