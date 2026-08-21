import { z } from "@/lib/openapi/zod";

import { addressText, ENTITY_TYPES, gstin, optional, pan, pincode } from "./api-admin";

/**
 * The importer's own profile, and sales agents.
 *
 * Two shapes for the profile on purpose: PATCH accepts any subset (people
 * save half-finished forms), SUBMIT insists on the five the database
 * insists on before a row may leave PENDING — legal name, entity type,
 * address, city, pincode — plus GSTIN and PAN, because a warehouse
 * cannot invoice a company it cannot identify.
 */

const mobile = z
  .string()
  .trim()
  .regex(/^[6-9][0-9]{9}$/, "Enter a 10-digit Indian mobile number")
  .openapi({ example: "9876543210" });

export const importerProfilePatchSchema = z
  .object({
    companyName: z.string().trim().min(2).max(160).optional(),
    legalName: z.string().trim().min(2).max(160).optional(),
    tradeName: optional(z.string().trim().max(160)),
    entityType: z.enum(ENTITY_TYPES).optional(),
    address: addressText(6, 400).optional(),
    landmark: optional(addressText(2, 160)),
    area: optional(addressText(2, 160)),
    cityId: z.number().int().positive().optional(),
    pincode: pincode.optional(),
    gstin: optional(gstin),
    pan: optional(pan),
    contactPerson: z.string().trim().min(2).max(120).optional(),
    contactEmail: z.string().trim().email().max(160).optional(),
    contactMobile: mobile.optional(),
    alternateMobile: optional(mobile),
  })
  .openapi("ImporterProfilePatch");

export const importerProfileResponseSchema = z
  .object({
    id: z.number().int(),
    code: z.string(),
    status: z.string(),
    kycStatus: z.string(),
    rejectionReason: z.string().nullable(),
    profile: importerProfilePatchSchema,
    cityLabel: z.string().nullable(),
    stateId: z.number().int().nullable(),
    countryId: z.number().int().nullable(),
    complete: z.boolean(),
    missing: z.array(z.string()),
  })
  .openapi("ImporterProfileResponse");

/** What "complete" means, in one place. Mirrors the DB check plus the
 *  two identifiers a warehouse needs to bill. */
export const PROFILE_REQUIRED = [
  "legalName",
  "entityType",
  "address",
  "cityId",
  "pincode",
  "gstin",
  "pan",
] as const;

/**
 * The five `importer_complete_before_active` actually demands — no more.
 *
 * GSTIN and PAN are this portal's rule for submitting a profile, not the
 * database's rule for a row being ACTIVE, and a company verified before
 * that rule existed may carry neither. Anything that edits an existing
 * row measures against THIS list: check the seven instead and correcting
 * a company's landmark starts demanding a PAN it has never had.
 */
export const ACTIVE_REQUIRED = ["legalName", "entityType", "address", "cityId", "pincode"] as const;

// ── Sales agents ──────────────────────────────────────────────────

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(s)), "Not a real date");

/**
 * One territory: a state, a city in it, and the areas of that city the
 * agent covers — because one city is split between several agents by
 * locality. Names are stored beside the ids so the JSON reads on its own
 * (reports, the mobile app) without a join; the ids keep it tied to the
 * master.
 */
export const salesAreaSchema = z
  .object({
    stateId: z.number().int().positive(),
    stateName: z.string().trim().min(1).max(120),
    cityId: z.number().int().positive(),
    cityName: z.string().trim().min(1).max(120),
    areas: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  })
  .openapi("SalesArea", {
    example: { stateId: 26, stateName: "Maharashtra", cityId: 88, cityName: "Mumbai", areas: ["Andheri East", "Bandra West"] },
  });

const salesAgentCore = {
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: optional(z.string().trim().email().max(160)),
  mobile,
  birthDate: optional(isoDate),
  joiningDate: isoDate,
  pan: optional(pan),
  address: optional(addressText(2, 400)),
  landmark: optional(addressText(2, 160)),
  area: optional(addressText(2, 160)),
  cityId: z.number().int().positive().nullable().optional(),
  pincode: optional(pincode),
  salesAreas: z.array(salesAreaSchema).max(100).default([]),
  notes: optional(z.string().trim().max(1000)),
};

export const salesAgentCreateSchema = z
  .object({
    ...salesAgentCore,
    /** Required on create: the email IS the login, and the one-time
     *  password goes there. */
    email: z.string().trim().email().max(160),
    /** Super admin only: which importer. An importer's own request is
     *  pinned to their importer regardless of what is sent. */
    importerId: z.number().int().positive().optional(),
    /** Create a login for the agent (mobile app). Needs an email. */
    createLogin: z.boolean().default(true),
  })
  .openapi("SalesAgentCreate");

export const salesAgentUpdateSchema = z
  .object({
    ...Object.fromEntries(
      Object.entries(salesAgentCore).map(([k, v]) => [k, v.optional()]),
    ),
    isActive: z.boolean().optional(),
    status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]).optional(),
  })
  .openapi("SalesAgentUpdate");

export const salesAgentSchema = z
  .object({
    id: z.number().int(),
    code: z.string(),
    importerId: z.number().int(),
    importerName: z.string(),
    userId: z.number().int().nullable(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().nullable(),
    mobile: z.string(),
    birthDate: z.string().nullable(),
    joiningDate: z.string(),
    pan: z.string().nullable(),
    address: z.string().nullable(),
    landmark: z.string().nullable(),
    area: z.string().nullable(),
    cityId: z.number().int().nullable(),
    cityLabel: z.string().nullable(),
    pincode: z.string().nullable(),
    salesAreas: z.array(salesAreaSchema),
    status: z.string(),
    isActive: z.boolean(),
    notes: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("SalesAgent");
